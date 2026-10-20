#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer } from "effect";
import { CliConfig, CliError as ParseError, Command, Flag, GlobalFlag } from "effect/cli";

import { login, logout, whoami } from "./commands/account.ts";
import { check, deleteDraft, list, prune, read, upload } from "./commands/drafts.ts";
import { workspace } from "./commands/workspace.ts";
import { VERSION, withCmd } from "./env.ts";
import { errorKind, EXIT_CODES, isHtmlArtifactError, reason, type ErrorKind } from "./errors.ts";
import { printJson } from "./format.ts";

const htmlartifact = Command.make("htmlartifact").pipe(
  Command.withDescription("Publish HTML artifacts that only your workspace can open."),
  Command.withSubcommands([login, logout, whoami, workspace, read, upload, check, list, deleteDraft, prune])
);

// `--version` / `-V` print the bare version, as the CLI always has.
const Version = GlobalFlag.Action({
  flag: Flag.Boolean("version").pipe(
    Flag.withAlias("V"),
    Flag.withDescription("Output the version number"),
    Flag.withDefault(false)
  ),
  run: () => Console.log(VERSION)
});

// Only --help and --version: no wizard, completions or log-level flags.
const Config = CliConfig.layer({ builtIns: [GlobalFlag.Help, Version] });

// Every failure prints one message to stderr (a JSON object on stdout under
// --json) and exits with the code for its kind (README → Exit codes). Usage
// errors were already printed with the help text by the parser.
const wantsJson = process.argv.slice(2).includes("--json");

const report = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    if (Cause.hasInterruptsOnly(cause)) {
      process.exitCode = 130;
      return;
    }
    const error = Cause.squash(cause);
    const parseError = ParseError.isCliError(error);
    const known = isHtmlArtifactError(error);
    const kind: ErrorKind = parseError ? "usage" : known ? errorKind(error) : "failure";
    process.exitCode = EXIT_CODES[kind];
    const message = parseError
      ? usageMessage(error)
      : withCmd(known ? error.message : reason(error));
    if (wantsJson) {
      const details = known && error._tag === "CliError" ? error.details : undefined;
      return yield* printJson({ ok: false, error: message, kind, exitCode: EXIT_CODES[kind], ...rewriteHints(details) });
    }
    if (parseError) return;
    yield* Console.error(message);
  });

// The hints in --json error details say `npx htmlartifact` too, when run that way.
const rewriteHints = (details: Record<string, unknown> = {}) =>
  Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? withCmd(value) : Array.isArray(value) ? value.map((v) => (typeof v === "string" ? withCmd(v) : v)) : value
    ])
  );

function usageMessage(error: ParseError.CliError): string {
  const errors = error._tag === "ShowHelp" ? error.errors : [error];
  return errors.map((e) => e.message).join("\n") || "Missing a command. See: htmlartifact --help";
}

// Under --json, stdout carries the JSON alone (printJson writes it there):
// help text, progress and notes go to stderr.
const jsonConsole: Console.Console = { ...globalThis.console, log: globalThis.console.error, info: globalThis.console.error };

const program = Command.run(htmlartifact, { version: VERSION }).pipe(
  Effect.catchCause(report),
  (effect) => (wantsJson ? Effect.provideService(effect, Console.Console, jsonConsole) : effect),
  Effect.provide(Layer.mergeAll(NodeServices.layer, Config))
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
