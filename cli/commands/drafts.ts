import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/cli";

import { assertOwnServer, getAuth, resolveApiUrl } from "../auth.ts";
import { CMD, USER_AGENT, VERSION } from "../env.ts";
import { attempt, CliError, cliError, NetworkError, reason } from "../errors.ts";
import { apiUrlFlag, jsonFlag, numberFlag, stringFlag, switchFlag } from "../flags.ts";
import { formatBytes, formatIssue } from "../../src/html-policy.ts";
import {
  formatUsage,
  offlineReport,
  printCheckReport,
  printJson,
  printReceipt,
  shellQuote,
  timeAgo,
  validateLocally,
  type Receipt
} from "../format.ts";
import { api, requestJson, serverErrorMessage } from "../http.ts";
import { collectCiMetadata, collectGitMetadata } from "../metadata.ts";
import { readUploadSource } from "../source.ts";
import { findDraftMapping, removeDraftMappings, saveDraftMapping, sha256, type Json } from "../state.ts";

const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;

const setFailureExitCode = Effect.sync(() => {
  process.exitCode = 1;
});

// An artifact URL, or a bare artifact ID (as `list` and `upload` print it).
const parseUrl = (value: string, apiUrl: string) =>
  DRAFT_ID_PATTERN.test(value)
    ? Effect.succeed(new URL(`/d/${value}`, apiUrl))
    : Effect.try({ try: () => new URL(value), catch: () => cliError(`Not an artifact URL or ID: ${value}`) });

// The path as the user would type it: relative when it's under the current directory.
const displayPath = (resolved: string) => {
  const relative = path.relative(process.cwd(), resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : resolved;
};

export const read = Command.make(
  "read",
  {
    url: Argument.String("url").pipe(Argument.withDescription("An artifact URL from this server, or its artifact ID")),
    out: stringFlag("out", "file", "Write the HTML here instead of a new temp file")
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    const target = yield* parseUrl(options.url, apiUrl);
    target.hash = "";
    yield* assertOwnServer(target, apiUrl);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(target, {
          headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": USER_AGENT, Accept: "*/*" },
          signal: AbortSignal.timeout(60_000)
        }),
      catch: (error) => new NetworkError({ message: `Could not reach ${target.origin}: ${reason(error)}` })
    });
    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new NetworkError({ message: `Lost the connection to ${target.origin}: ${reason(error)}` })
    });
    if (!response.ok) {
      const hint = response.status === 404 ? " Not found in your current workspace (see: htmlartifact workspace list)." : "";
      return yield* new CliError({ message: `HTTP ${response.status} for ${target}.${hint}` });
    }
    const out = yield* attempt(() => {
      const file = Option.isSome(options.out)
        ? path.resolve(options.out.value)
        : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "htmlartifact-")), "artifact.html");
      fs.writeFileSync(file, html);
      return file;
    });
    yield* Console.log(`URL: ${response.url}`);
    yield* Console.log(`Version: ${response.headers.get("x-htmlartifact-draft-version") || "unknown"}`);
    yield* Console.log(`File: ${out}`);
  })
).pipe(Command.withDescription("Download an artifact's HTML (for agents; uses your sign-in)."));

export const upload = Command.make(
  "upload",
  {
    target: Argument.String("path").pipe(
      Argument.withDescription("HTML file, or a folder of .html pages with an index.html")
    ),
    slug: stringFlag(
      "slug",
      "name",
      "Publish at a custom URL; the same slug always updates the same draft. With --draft, renames that draft"
    ),
    draft: stringFlag("draft", "draft-id", "Update a specific artifact (by ID)"),
    new: switchFlag("new", "Always create a new artifact"),
    description: stringFlag("description", "text", "Set a short description for the artifact"),
    json: jsonFlag("Print the publication receipt as JSON"),
    apiUrl: apiUrlFlag()
  },
  Effect.fn(function* (options) {
    const slug = Option.getOrUndefined(options.slug);
    const draft = Option.getOrUndefined(options.draft);
    if (options.new && (draft || slug !== undefined)) {
      return yield* new CliError({
        message:
          "--new cannot be combined with --draft or --slug: those name an existing draft. Use an unused slug to create a new draft at a custom URL."
      });
    }
    const { apiUrl, apiKey } = yield* getAuth(Option.getOrUndefined(options.apiUrl));
    const source = yield* readUploadSource(options.target);
    // Check the markup locally first: parse5 reports each problem with its
    // line and column (the server reports none), and a page that fails here
    // would fail on the server too. Nothing is sent.
    const local = validateLocally(source);
    if (!local.ok) {
      const errors = local.issues.filter((issue) => issue.level === "error");
      if (options.json) {
        yield* printJson({
          ok: false,
          status: null,
          checkedLocally: true,
          error: "HTML failed htmlartifact validation. Nothing was uploaded.",
          errors: errors.map(formatIssue),
          issues: local.issues
        });
        return yield* setFailureExitCode;
      }
      return yield* new CliError({
        message: `Not uploaded: the HTML failed htmlartifact validation (checked locally).\n- ${errors.map(formatIssue).join("\n- ")}`
      });
    }
    // A slug names the draft by itself, so the saved mapping for this path is
    // only used without one. `--draft <id> --slug <name>` renames a draft.
    const mappedDraftId =
      options.new || draft || slug !== undefined
        ? null
        : (yield* findDraftMapping(apiUrl, source.resolved))?.draftId || null;
    const draftId = draft || mappedDraftId;

    const payload = {
      ...source.body,
      filename: source.filename,
      draftId,
      slug,
      description: Option.getOrUndefined(options.description),
      metadata: {
        ...collectGitMetadata(source.dir),
        ...collectCiMetadata(),
        cliVersion: VERSION,
        ...(source.body.html ? { fileSha256: sha256(source.body.html) } : {})
      }
    };

    // On Cloudflare's free plan a burst of heavy uploads can run the server
    // out of CPU; Cloudflare then answers 503 with its own error page (not our
    // JSON). The allowance refills within seconds, so retry, and an upload is
    // safe to repeat: identical content to the same artifact is a no-op.
    let attempt = 0;
    let result = yield* requestJson(`${apiUrl}/api/uploads`, { apiKey, body: payload, timeoutMs: 300_000 });
    while (result.status === 503 && !result.body.ok && typeof result.body.error === "string" && result.body.error.startsWith("htmlartifact returned HTTP 503") && attempt < 3) {
      const wait = result.retryAfter ?? [5, 15, 30][attempt]!;
      attempt += 1;
      yield* Console.error(`The server is busy (HTTP 503). Retrying in ${wait}s...`);
      yield* Effect.sleep(`${wait} seconds`);
      result = yield* requestJson(`${apiUrl}/api/uploads`, { apiKey, body: payload, timeoutMs: 300_000 });
    }
    const { ok, status, body } = result;

    if (!ok) {
      const staleMapping = status === 404 && mappedDraftId;
      const hint = staleMapping
        ? "\nThe saved artifact for this path is in another workspace or was deleted. Re-run with --new to publish a new one."
        : "";
      if (options.json) {
        yield* printJson({ ok: false, status, error: body.error || null, errors: body.errors || [], issues: body.issues || [] });
        return yield* setFailureExitCode;
      }
      return yield* new CliError({ message: `Upload rejected (HTTP ${status}): ${serverErrorMessage(body)}${hint}` });
    }

    const receipt: Receipt = {
      ok: true,
      // Servers before receipts sent no `created`; fall back to what was asked.
      action: (body.created ?? !draftId) ? "created" : body.unchanged ? "unchanged" : "updated",
      draftId: body.draftId,
      slug: body.slug || null,
      versionNumber: body.versionNumber,
      url: body.publicUrl,
      rawUrl: body.rawUrl,
      versionUrl: body.versionUrl,
      contentHash: body.contentHash,
      totalBytes: body.totalBytes,
      account: body.account?.name || null,
      workspace: body.workspace?.name || null,
      pages: body.pages || null,
      // The draft ID never moves; a slug can be renamed and reused by
      // another draft, so it would not reliably name this one.
      updateCommand: [`${CMD} upload`, shellQuote(displayPath(source.resolved)), `--draft ${body.draftId}`].join(" "),
      warnings: body.warnings || []
    };

    // Print the receipt before touching local state: the page is already
    // published, and a failed map write must not hide where it went.
    yield* options.json ? printJson(receipt) : printReceipt(receipt);

    yield* saveDraftMapping(apiUrl, source.resolved, {
      draftId: receipt.draftId,
      slug: receipt.slug,
      publicUrl: receipt.url,
      rawUrl: receipt.rawUrl,
      latestVersionNumber: receipt.versionNumber
    }).pipe(
      Effect.catch((error) =>
        Console.error(`Warning: published, but could not save the local path mapping: ${error.message}`)
      )
    );
  })
).pipe(Command.withDescription("Publish an artifact, or a new version of one."));

export const check = Command.make(
  "check",
  {
    target: Argument.String("path").pipe(
      Argument.withDescription("HTML file or folder to validate; omit for a readiness check only"),
      Argument.optional
    ),
    slug: stringFlag("slug", "name", "Also check whether a custom URL is available to you"),
    json: jsonFlag("Print the report as JSON"),
    apiUrl: apiUrlFlag()
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth(Option.getOrUndefined(options.apiUrl));
    const source = Option.isSome(options.target) ? yield* readUploadSource(options.target.value) : null;

    const checked: Json = yield* requestJson(`${apiUrl}/api/check`, {
      apiKey,
      body: { ...source?.body, slug: Option.getOrUndefined(options.slug) },
      timeoutMs: 60_000
    }).pipe(
      Effect.map(({ ok, status, body }) =>
        ok ? { ...body, offline: false } : { ok: false, offline: false, status, errors: body.errors || [body.error] }
      ),
      Effect.catchTag("NetworkError", (error) => Effect.succeed(offlineReport(source, error.message)))
    );

    const report: Json = { cliVersion: VERSION, apiUrl, path: source?.resolved || null, ...checked };
    yield* options.json ? printJson(report) : printCheckReport(report);
    if (!report.ok) yield* setFailureExitCode;
  })
).pipe(Command.withDescription("Check account, limits, and capabilities, and validate a page. Never publishes."));

export const list = Command.make(
  "list",
  {
    all: switchFlag("all", "List everything published in your workspace"),
    apiUrl: apiUrlFlag(),
    json: jsonFlag("Print the raw JSON response")
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth(Option.getOrUndefined(options.apiUrl));
    const scope = options.all ? "?scope=workspace" : "";
    const { ok, body } = yield* requestJson(`${apiUrl}/api/drafts${scope}`, { apiKey });
    if (!ok) {
      return yield* new CliError({ message: body.error || "Failed to list artifacts." });
    }

    const drafts: Json[] = body.drafts || [];
    const usage = formatUsage(body.usage);

    if (options.json) return yield* printJson({ drafts, usage: body.usage ?? null });

    if (!drafts.length) {
      yield* Console.log(
        options.all ? "Nothing published in this workspace yet." : `Nothing yet. Publish with: ${CMD} upload <file.html>`
      );
      if (usage) yield* Console.log(usage);
      return;
    }

    yield* Console.log(`Artifacts (${drafts.length})\n`);
    for (const draft of drafts) {
      const repo = draft.repoOrg && draft.repoName ? `${draft.repoOrg}/${draft.repoName}` : "no repo";
      const version = draft.latestVersionNumber ? `v${draft.latestVersionNumber}` : "no versions";
      const count = `${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"}`;
      const disabled = draft.disabled ? " · disabled" : "";

      // Someone other than the author (an admin, a CI key) published the current version.
      const updatedBy = draft.updatedBy && draft.updatedBy !== draft.author ? ` by ${draft.updatedBy}` : "";
      yield* Console.log(`${draft.title || "Untitled"}${options.all && draft.author ? `  · ${draft.author}` : ""}`);
      yield* Console.log(`  ${repo} · ${version} · ${count} · updated ${timeAgo(draft.updatedAt)}${updatedBy}${disabled}`);
      yield* Console.log(`  ${draft.publicUrl}`);
      if (draft.description) {
        yield* Console.log(`  ${draft.description}`);
      }
      yield* Console.log("");
    }
    if (usage) yield* Console.log(usage);
  })
).pipe(Command.withDescription("List your artifacts in the current workspace (--all: everyone's)."));


type DraftTarget = { draftId: string } | { slugPath: string };

const trimSlashes = (pathname: string) => pathname.replace(/\/+$/, "");

// A draft ID, a /d/<id> URL, or a /w/<handle>/<slug> URL. URLs must be on
// this server; this runs before sign-in, so it never needs a token.
const parseDraftTarget = (input: string, apiUrl: string) =>
  Effect.gen(function* () {
    if (DRAFT_ID_PATTERN.test(input)) return { draftId: input } satisfies DraftTarget;
    const target = yield* Effect.try({
      try: () => new URL(input),
      catch: () => cliError(`Not an artifact ID or URL: ${input}`)
    });
    yield* assertOwnServer(target, apiUrl);
    const [kind, first, second] = target.pathname.split("/").filter(Boolean);
    if (kind === "d" && first && DRAFT_ID_PATTERN.test(first)) return { draftId: first } satisfies DraftTarget;
    if (kind === "w" && first && second) return { slugPath: `/w/${first}/${second}` } satisfies DraftTarget;
    return yield* new CliError({ message: `Not an artifact URL: ${input}` });
  });

// Custom URLs are looked up in the current workspace's list by publicUrl.
const findDraftBySlugPath = (apiUrl: string, apiKey: string, slugPath: string, input: string) =>
  Effect.gen(function* () {
    const { drafts } = (yield* api(apiUrl, "/api/drafts?scope=workspace", { apiKey })) as { drafts?: Json[] };
    const match = (drafts || []).find((draft) => {
      try {
        return trimSlashes(new URL(draft.publicUrl).pathname) === slugPath;
      } catch {
        return false;
      }
    });
    if (!match) {
      return yield* new CliError({ message: `No artifact at ${input} in your current workspace (see: htmlartifact list --all).` });
    }
    return match.draftId as string;
  });

export const deleteDraft = Command.make(
  "delete",
  {
    target: Argument.String("draft-id-or-url").pipe(
      Argument.withDescription("Artifact ID, or its /d/<id> or /w/<workspace>/<slug> URL")
    ),
    json: jsonFlag(),
    apiUrl: apiUrlFlag()
  },
  Effect.fn(function* (options) {
    const apiUrlOverride = Option.getOrUndefined(options.apiUrl);
    const parsed: DraftTarget = yield* parseDraftTarget(options.target, yield* resolveApiUrl(apiUrlOverride));
    const { apiUrl, apiKey } = yield* getAuth(apiUrlOverride);
    const draftId =
      "draftId" in parsed ? parsed.draftId : yield* findDraftBySlugPath(apiUrl, apiKey, parsed.slugPath, options.target);

    yield* api(apiUrl, `/api/drafts/${draftId}`, { apiKey, method: "DELETE" });
    const removedMappings = yield* removeDraftMappings(apiUrl, draftId).pipe(
      Effect.catch((error) =>
        Console.error(`Warning: deleted, but could not remove the local path mapping: ${error.message}`).pipe(Effect.as(0))
      )
    );

    if (options.json) return yield* printJson({ ok: true, draftId, removedMappings });
    yield* Console.log(`Deleted ${draftId}. Its HTML (every version) is erased.`);
  })
).pipe(Command.withDescription("Delete an artifact and every version of its HTML."));

export const prune = Command.make(
  "prune",
  {
    target: Argument.String("draft-id-or-url").pipe(
      Argument.withDescription("Artifact ID, or its /d/<id> or /w/<workspace>/<slug> URL")
    ),
    keep: numberFlag("keep", "How many of the latest versions to keep (at least 1)"),
    json: jsonFlag(),
    apiUrl: apiUrlFlag()
  },
  Effect.fn(function* (options) {
    const keep = Option.getOrUndefined(options.keep);
    if (keep === undefined || !Number.isInteger(keep) || keep < 1) {
      return yield* new CliError({
        message: `Say how many of the latest versions to keep, e.g.: ${CMD} prune ${options.target} --keep 5`
      });
    }
    const apiUrlOverride = Option.getOrUndefined(options.apiUrl);
    const parsed: DraftTarget = yield* parseDraftTarget(options.target, yield* resolveApiUrl(apiUrlOverride));
    const { apiUrl, apiKey } = yield* getAuth(apiUrlOverride);
    const draftId =
      "draftId" in parsed ? parsed.draftId : yield* findDraftBySlugPath(apiUrl, apiKey, parsed.slugPath, options.target);

    // The server prunes a long history in steps.
    let deleted = 0;
    let freedBytes = 0;
    let result: Json;
    do {
      result = yield* api(apiUrl, `/api/drafts/${draftId}/versions?keepLatest=${keep}`, { apiKey, method: "DELETE" });
      deleted += result.deleted;
      freedBytes += result.freedBytes;
    } while (result.more && result.deleted > 0);

    const summary = { ok: true, draftId, deleted, freedBytes, versionCount: result.versionCount, usage: result.usage ?? null };
    if (options.json) return yield* printJson(summary);
    yield* Console.log(
      deleted
        ? `Pruned ${deleted} old version${deleted === 1 ? "" : "s"} of ${draftId} (freed ${formatBytes(freedBytes)}); ${result.versionCount} left.`
        : `Nothing to prune: ${draftId} has ${result.versionCount} version${result.versionCount === 1 ? "" : "s"}.`
    );
    const usage = formatUsage(result.usage);
    if (usage) yield* Console.log(usage);
  })
).pipe(Command.withDescription("Delete an artifact's old versions to free storage, keeping the latest --keep <n>."));
