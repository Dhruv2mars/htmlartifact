#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer } from "effect";
import { CliConfig, CliError as ParseError, Command, Flag, GlobalFlag } from "effect/cli";

import { login, logout, whoami } from "./commands/account.ts";
import { check, deleteDraft, list, read, upload } from "./commands/drafts.ts";
import { workspace } from "./commands/workspace.ts";
import { VERSION, withCmd } from "./env.ts";
import { isHtmlArtifactError, reason } from "./errors.ts";

const htmlartifact = Command.make("htmlartifact").pipe(
  Command.withDescription("Publish HTML artifacts that only your workspace can open."),
  Command.withSubcommands([login, logout, whoami, workspace, read, upload, check, list, deleteDraft])
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

// Every failure prints one message to stderr and exits 1. Usage errors were
// already printed with the help text by the parser.
const report = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    if (Cause.hasInterruptsOnly(cause)) {
      process.exitCode = 130;
      return;
    }
    process.exitCode = 1;
    const error = Cause.squash(cause);
    if (ParseError.isCliError(error)) return;
    yield* Console.error(withCmd(isHtmlArtifactError(error) ? error.message : reason(error)));
  });

const program = Command.run(htmlartifact, { version: VERSION }).pipe(
  Effect.catchCause(report),
  Effect.provide(Layer.mergeAll(NodeServices.layer, Config))
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
