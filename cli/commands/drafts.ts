import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/cli";

import { assertOwnServer, getAuth, resolveApiUrl } from "../auth.ts";
import { CMD, envToken, USER_AGENT, VERSION } from "../env.ts";
import { attempt, CliError, cliError, EXIT_CODES, kindForStatus, NetworkError, reason } from "../errors.ts";
import { apiUrlFlag, jsonFlag, numberFlag, stringFlag, switchFlag } from "../flags.ts";
import { formatBytes, formatIssue, type Issue } from "../../src/html-policy.ts";
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
import { api, httpError, rejectedEnvToken, requestJson } from "../http.ts";
import { resolveWorkspace } from "./workspace.ts";
import { collectCiMetadata, collectGitMetadata } from "../metadata.ts";
import { readUploadSource, type UploadSource } from "../source.ts";
import { findDraftMapping, removeDraftMappings, saveDraftMapping, sha256, type Json } from "../state.ts";

const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;

// An artifact URL, or a bare artifact ID (as `list` and `upload` print it).
const parseUrl = (value: string, apiUrl: string) =>
  DRAFT_ID_PATTERN.test(value)
    ? Effect.succeed(new URL(`/d/${value}`, apiUrl))
    : Effect.try({ try: () => new URL(value), catch: () => cliError(`Not an artifact URL or ID: ${value}`, "usage") });

// The path as the user would type it: relative when it's under the current directory.
const displayPath = (resolved: string) => {
  const relative = path.relative(process.cwd(), resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : resolved;
};

export const read = Command.make(
  "read",
  {
    url: Argument.String("url").pipe(
      Argument.withDescription("An artifact URL from this server, its artifact ID, or with --workspace its custom URL name")
    ),
    out: stringFlag("out", "file", "Write the HTML here instead of a new temp file"),
    workspace: stringFlag("workspace", "name", "Look up a custom URL name in this workspace (any you are in)"),
    json: jsonFlag("Print where the HTML was written as JSON")
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    const workspace = Option.isSome(options.workspace) ? yield* resolveWorkspace(apiUrl, apiKey, options.workspace.value) : null;
    const slug = workspace && !DRAFT_ID_PATTERN.test(options.url) && !/^https?:/i.test(options.url) ? options.url : null;
    const target = workspace && slug
      ? new URL(`/w/${encodeURIComponent(workspace.handle)}/${encodeURIComponent(slug.toLowerCase())}`, apiUrl)
      : yield* parseUrl(options.url, apiUrl);
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
    // The bytes as stored: a byte order mark or any other byte is kept.
    const bytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer().then((buffer) => Buffer.from(buffer)),
      catch: (error) => new NetworkError({ message: `Lost the connection to ${target.origin}: ${reason(error)}` })
    });
    if (!response.ok) {
      if (response.status === 401 && envToken()) return yield* rejectedEnvToken();
      const hint =
        response.status === 404 ? " Not found in any workspace you are in (see: htmlartifact workspace list)." : "";
      return yield* new CliError({ message: `HTTP ${response.status} for ${target}.${hint}`, kind: kindForStatus(response.status) });
    }
    const out = yield* attempt(() => {
      const file = Option.isSome(options.out)
        ? path.resolve(options.out.value)
        : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "htmlartifact-")), "artifact.html");
      fs.writeFileSync(file, bytes);
      return file;
    });
    const version = Number(response.headers.get("x-htmlartifact-draft-version")) || null;
    if (options.json) {
      return yield* printJson({ ok: true, url: response.url, version, file: out, bytes: bytes.length });
    }
    yield* Console.log(`URL: ${response.url}`);
    yield* Console.log(`Version: ${version ?? "unknown"}`);
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
    force: switchFlag("force", "With --slug: update the artifact it names even if this path was published to another"),
    description: stringFlag("description", "text", "Set a short description for the artifact"),
    json: jsonFlag("Print the publication receipt as JSON"),
    apiUrl: apiUrlFlag()
  },
  Effect.fn(function* (options) {
    const slug = Option.getOrUndefined(options.slug);
    const draft = Option.getOrUndefined(options.draft);
    if (options.new && (draft || slug !== undefined)) {
      return yield* new CliError({
        kind: "usage",
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
      const errors = local.issues.filter((issue) => issue.level === "error").map(formatIssue);
      return yield* new CliError({
        kind: "validation",
        message: `Not uploaded: the HTML failed htmlartifact validation (checked locally).\n- ${errors.join("\n- ")}`,
        details: {
          status: null,
          checkedLocally: true,
          error: "HTML failed htmlartifact validation. Nothing was uploaded.",
          errors,
          issues: local.issues
        }
      });
    }
    // A slug names the draft by itself, so the saved mapping for this path is
    // only used without one. `--draft <id> --slug <name>` renames a draft.
    const mapping = options.new || draft ? null : yield* findDraftMapping(apiUrl, source.resolved);
    const mappedDraftId = slug === undefined ? mapping?.draftId || null : null;
    const draftId = draft || mappedDraftId;
    if (slug !== undefined && mapping?.draftId && mapping.slug !== slug.trim().toLowerCase() && !options.force) {
      yield* refuseSlugOfAnotherArtifact(apiUrl, apiKey, slug, mapping.draftId, displayPath(source.resolved));
    }

    const ci = collectCiMetadata();
    const payload = {
      ...source.body,
      filename: source.filename,
      draftId,
      slug,
      description: Option.getOrUndefined(options.description),
      metadata: {
        ...collectGitMetadata(source.dir),
        ...ci,
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
      const error = httpError(result, `Upload rejected (HTTP ${status}): `);
      return yield* new CliError({
        kind: error.kind,
        message: `${error.message}${hint}`,
        // The server's own message, unless it was about HTMLARTIFACT_TOKEN.
        details: {
          status,
          error: status === 401 && envToken() ? error.message : body.error || null,
          errors: body.errors || [],
          issues: body.issues || []
        }
      });
    }

    const warnings: string[] = body.warnings || [];
    // An explicit slug never moves this path's mapping: a plain upload of it
    // keeps updating the artifact it was bound to.
    const keepMapping = slug !== undefined && !!mapping?.draftId && mapping.draftId !== body.draftId;
    if (keepMapping) {
      warnings.push(
        `${displayPath(source.resolved)} still updates artifact ${mapping!.draftId} when uploaded without --slug; --slug ${slug} published to ${body.draftId}.`
      );
    }
    if (ci.ciProvider && slug === undefined && !draft && !mappedDraftId && !options.new) {
      warnings.push(
        "In CI without --slug or --draft, every run publishes a new artifact at a new URL (the path's mapping lives in ~/.htmlartifact, which CI does not keep). Pass --slug <name> to update one stable URL."
      );
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
      warnings
    };

    // Print the receipt before touching local state: the page is already
    // published, and a failed map write must not hide where it went.
    yield* options.json ? printJson(receipt) : printReceipt(receipt);
    if (keepMapping) return;

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

// `--slug` updates whichever artifact the slug names. When that is not the one
// this path was published to (and that one still exists), stop: the upload
// would silently replace another artifact's content. `--force` goes ahead.
const refuseSlugOfAnotherArtifact = (apiUrl: string, apiKey: string, slug: string, mappedDraftId: string, shownPath: string) =>
  Effect.gen(function* () {
    const wanted = slug.trim().toLowerCase();
    const { drafts = [] } = (yield* api(apiUrl, "/api/drafts?scope=workspace", { apiKey })) as { drafts?: Json[] };
    const named = drafts.find((d) => d.slug === wanted);
    if (!named || named.draftId === mappedDraftId || !drafts.some((d) => d.draftId === mappedDraftId)) return;
    return yield* new CliError({
      kind: "usage",
      message: [
        `--slug ${wanted} names artifact ${named.draftId} ("${named.title || "Untitled"}"), but ${shownPath} was published to ${mappedDraftId}.`,
        `Uploading would replace ${named.draftId}'s content with this file. Pick another slug, or re-run with --force to replace it.`
      ].join("\n")
    });
  });

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
    const apiUrlOverride = Option.getOrUndefined(options.apiUrl);
    const source = Option.isSome(options.target) ? yield* readUploadSource(options.target.value) : null;
    // Signed out, a page is still checked: locally, like when offline.
    const auth = yield* getAuth(apiUrlOverride).pipe(
      Effect.catchTag("CliError", (error) => (source && error.kind === "auth" ? Effect.succeed(error) : Effect.fail(error)))
    );

    const checked: Json =
      auth instanceof CliError
        ? offlineReport(source, { signedOut: auth.message })
        : yield* requestJson(`${auth.apiUrl}/api/check`, {
            apiKey: auth.apiKey,
            body: { ...source?.body, slug: Option.getOrUndefined(options.slug) },
            timeoutMs: 60_000
          }).pipe(
            Effect.map(({ ok, status, body }) =>
              ok
                ? withLocalPositions({ ...body, offline: false }, source)
                : { ok: false, offline: false, status, errors: body.errors || [body.error] }
            ),
            Effect.catchTag("NetworkError", (error) => Effect.succeed(offlineReport(source, { networkError: error.message })))
          );

    const apiUrl = auth instanceof CliError ? yield* resolveApiUrl(apiUrlOverride) : auth.apiUrl;
    const report: Json = { cliVersion: VERSION, apiUrl, path: source?.resolved || null, ...checked };
    yield* options.json ? printJson(report) : printCheckReport(report);
    if (!report.ok) {
      const kind = report.markupOk === false || report.issues?.length ? "validation"
        : report.signedOut ? "auth"
        : report.networkError ? "network"
        : report.status ? kindForStatus(report.status)
        : "validation";
      yield* Effect.sync(() => {
        process.exitCode = EXIT_CODES[kind];
      });
    }
  })
).pipe(Command.withDescription("Check account, limits, and capabilities, and validate a page. Never publishes."));

// The server's issues carry no line or column (it streams the HTML); the
// local parse5 check has them. Each server issue takes the position of the
// next local issue with the same code on the same page.
function withLocalPositions(report: Json, source: UploadSource | null): Json {
  if (!source || !Array.isArray(report.issues)) return report;
  const local = validateLocally(source).issues.filter((issue) => issue.line);
  const issues = (report.issues as Issue[]).map((issue) => {
    if (issue.line) return issue;
    const index = local.findIndex((l) => l.code === issue.code && l.path === issue.path);
    if (index < 0) return issue;
    const [match] = local.splice(index, 1);
    return { ...issue, line: match!.line, column: match!.column };
  });
  const formatted = (level: string) => issues.filter((issue) => issue.level === level).map(formatIssue);
  return { ...report, issues, errors: formatted("error"), warnings: formatted("warning") };
}

export const list = Command.make(
  "list",
  {
    all: switchFlag("all", "List everything published in your workspace"),
    workspace: stringFlag("workspace", "name", "List another of your workspaces instead of the current one"),
    apiUrl: apiUrlFlag(),
    json: jsonFlag("Print the raw JSON response")
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth(Option.getOrUndefined(options.apiUrl));
    const workspace = Option.isSome(options.workspace) ? yield* resolveWorkspace(apiUrl, apiKey, options.workspace.value) : null;
    const query = new URLSearchParams({ ...(options.all ? { scope: "workspace" } : {}), ...(workspace ? { workspace: workspace.id } : {}) });
    const body = yield* api(apiUrl, `/api/drafts${query.size ? `?${query}` : ""}`, { apiKey });
    const drafts: Json[] = body.drafts || [];
    const usage = formatUsage(body.usage);

    if (options.json) return yield* printJson({ drafts, usage: body.usage ?? null });

    if (!drafts.length) {
      yield* Console.log(
        options.all ? `Nothing published in ${workspace ? `"${workspace.name}"` : "this workspace"} yet.` : `Nothing yet. Publish with: ${CMD} upload <file.html>`
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
      const author = draft.author && `${draft.author}${draft.authorFormer ? " (former member)" : ""}`;
      yield* Console.log(`${draft.title || "Untitled"}${options.all && author ? `  · ${author}` : ""}`);
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
      catch: () => cliError(`Not an artifact ID or URL: ${input}`, "usage")
    });
    yield* assertOwnServer(target, apiUrl);
    const [kind, first, second] = target.pathname.split("/").filter(Boolean);
    if (kind === "d" && first && DRAFT_ID_PATTERN.test(first)) return { draftId: first } satisfies DraftTarget;
    if (kind === "w" && first && second) return { slugPath: `/w/${first}/${second}` } satisfies DraftTarget;
    return yield* new CliError({ kind: "usage", message: `Not an artifact URL: ${input}` });
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
      return yield* new CliError({ kind: "notFound", message: `No artifact at ${input} in your current workspace (see: htmlartifact list --all).` });
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
        message: `Say how many of the latest versions to keep, e.g.: ${CMD} prune ${options.target} --keep 5`,
        kind: "usage"
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
