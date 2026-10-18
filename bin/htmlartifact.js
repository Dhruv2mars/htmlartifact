#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { formatBytes, formatIssue, validateUpload } from "../src/html-policy.js";

// Single source of truth for the version: package.json. CI bumps it on every
// merge to main, so a hardcoded copy here would immediately drift.
const { version: VERSION } = createRequire(import.meta.url)("../package.json");
// A server's /install.sh replaces this placeholder with its own URL, so an
// installed CLI already knows where its workspace lives.
const BAKED_API_URL = "__HTMLARTIFACT_API_URL__";
const DEFAULT_API_URL = BAKED_API_URL.startsWith("__") ? null : BAKED_API_URL;
const HTMLARTIFACT_DIR = process.env.HTMLARTIFACT_HOME || path.join(os.homedir(), ".htmlartifact");
const CONFIG_PATH = path.join(HTMLARTIFACT_DIR, "config.json");
const CREDENTIALS_PATH = path.join(HTMLARTIFACT_DIR, "credentials.json");
const DRAFT_BINDINGS_DIR = path.join(HTMLARTIFACT_DIR, "drafts");

class CliError extends Error {}
// htmlartifact could not be reached at all: DNS, TLS, timeouts, refused sockets.
class NetworkError extends CliError {}

const program = new Command();

program
  .name("htmlartifact")
  .description("Publish HTML artifacts that only your team can read.")
  .version(VERSION);

program
  .command("login")
  .description("Sign in through your browser (works over SSH: open the link on any device).")
  .option("--api-url <url>", "The htmlartifact server, e.g. https://artifacts.acme.com")
  .option("--team <name>", "If you are in several teams, sign in to this one")
  .action(async (options) => {
    const apiUrl = resolveApiUrl(options.apiUrl);
    const start = await postJson(`${apiUrl}/api/cli/device`, {});
    if (!start.ok || !start.body.device_code) {
      throw new CliError(`Could not start sign-in at ${apiUrl}: ${start.body.error || `HTTP ${start.status}`}`);
    }
    const device = start.body;

    console.log("Open this link and confirm the code:\n");
    console.log(`  ${device.verification_uri_complete || device.verification_uri}\n`);
    console.log(`  Code: ${device.user_code}\n`);
    console.log("Waiting for you to finish in the browser...");

    let interval = Number(device.interval || 5) * 1000;
    const deadline = Date.now() + Number(device.expires_in || 300) * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      let poll = await postJson(`${apiUrl}/api/cli/token`, { device_code: device.device_code });
      if (poll.body.code === "organization_selection_required") {
        poll = await selectTeam(apiUrl, poll.body, options.team);
      }
      if (poll.ok) {
        const session = saveSession({ apiUrl, tokens: poll.body });
        if (!session.organizationId) {
          throw new CliError(`Signed in, but you are not in a team yet. Create or join one at ${apiUrl}/onboarding, then run htmlartifact login again.`);
        }
        const me = await requestJson(`${apiUrl}/api/me`, { apiKey: session.accessToken });
        if (!me.ok) throw new CliError(serverErrorMessage(me.body));
        console.log(`\nSigned in as ${me.body.email || me.body.name} in team "${me.body.organizationName}".`);
        return;
      }
      const error = poll.body.error || poll.body.code;
      if (error === "authorization_pending") continue;
      if (error === "slow_down") {
        interval += 5000;
        continue;
      }
      throw new CliError(`Sign-in ${error === "access_denied" ? "was denied" : `failed: ${error || poll.status}`}.`);
    }
    throw new CliError("Sign-in timed out. Run htmlartifact login again.");
  });

program
  .command("logout")
  .description("Forget the saved sign-in on this machine.")
  .action(() => {
    fs.rmSync(CREDENTIALS_PATH, { force: true });
    console.log("Signed out.");
  });

program
  .command("whoami")
  .description("Show who you are signed in as, and in which team.")
  .option("--api-url <url>", "The htmlartifact server")
  .action(async (options) => {
    const { apiUrl, apiKey } = await getAuth(options.apiUrl);
    const { ok, body } = await requestJson(`${apiUrl}/api/me`, { apiKey });
    if (!ok) throw new CliError(serverErrorMessage(body));
    console.log(`User: ${body.name}${body.email ? ` <${body.email}>` : ""}`);
    console.log(`Team: ${body.organizationName} (${body.organizationId})`);
    console.log(`Server: ${apiUrl}`);
  });

const orgCommand = program.command("org").description("List or switch teams.");

orgCommand
  .command("list")
  .description("List the teams you belong to.")
  .action(async () => {
    const { apiUrl, apiKey } = await getAuth();
    const { ok, body } = await requestJson(`${apiUrl}/api/orgs`, { apiKey });
    if (!ok) throw new CliError(serverErrorMessage(body));
    for (const org of body.organizations) {
      console.log(`${org.current ? "*" : " "} ${org.name}  (${org.id})`);
    }
  });

orgCommand
  .command("switch")
  .argument("<team>", "Team name or ID")
  .description("Publish to and read from another of your teams.")
  .action(async (team) => {
    const { apiUrl, apiKey } = await getAuth();
    const { ok, body } = await requestJson(`${apiUrl}/api/orgs`, { apiKey });
    if (!ok) throw new CliError(serverErrorMessage(body));
    const wanted = team.toLowerCase();
    const org = body.organizations.find((o) => o.id === team || o.name.toLowerCase() === wanted);
    if (!org) throw new CliError(`You are not in a team named "${team}". See: htmlartifact org list`);
    await refreshSession(readJson(CREDENTIALS_PATH, {}), { organizationId: org.id });
    console.log(`Switched to team "${org.name}".`);
  });

program
  .command("read")
  .argument("<url>", "An artifact URL from this server")
  .option("--out <file>", "Write the HTML here instead of a new temp file")
  .description("Download an artifact's HTML (for agents; uses your sign-in).")
  .action(async (url, options) => {
    const { apiUrl, apiKey } = await getAuth();
    let target;
    try {
      target = new URL(url);
    } catch {
      throw new CliError(`Not a URL: ${url}`);
    }
    target.hash = "";
    // Never send the token anywhere but this server (or its artifact subdomains).
    const api = new URL(apiUrl);
    if (target.protocol !== api.protocol || !(target.host === api.host || target.host.endsWith(`.${api.host}`))) {
      throw new CliError(`${target.origin} is not your htmlartifact server (${api.origin}).`);
    }

    let response;
    try {
      response = await fetch(target, {
        headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": `htmlartifact/${VERSION}`, Accept: "*/*" },
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      throw new NetworkError(`Could not reach ${target.origin}: ${error.cause?.message || error.message}`);
    }
    const html = await response.text();
    if (!response.ok) {
      const hint = response.status === 404 ? " Not found in your current team (see: htmlartifact org list)." : "";
      throw new CliError(`HTTP ${response.status} for ${target}.${hint}`);
    }
    const out = options.out
      ? path.resolve(options.out)
      : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "htmlartifact-")), "artifact.html");
    fs.writeFileSync(out, html);
    console.log(`URL: ${response.url}`);
    console.log(`Version: ${response.headers.get("x-htmlartifact-draft-version") || "unknown"}`);
    console.log(`File: ${out}`);
  });

program
  .command("upload")
  .argument("<path>", "HTML file, or a folder of .html pages with an index.html")
  .option("--slug <name>", "Publish at a custom URL; the same slug always updates the same draft. With --draft, renames that draft")
  .option("--draft <draft-id>", "Update a specific draft")
  .option("--new", "Always create a new draft")
  .option("--description <text>", "Set a short description for the draft")
  .option("--json", "Print the publication receipt as JSON")
  .option("--api-url <url>", "The htmlartifact server")
  .description("Publish an artifact, or a new version of one.")
  .action(async (target, options) => {
    if (options.new && (options.draft || options.slug !== undefined)) {
      throw new CliError(
        "--new cannot be combined with --draft or --slug: those name an existing draft. Use an unused slug to create a new draft at a custom URL."
      );
    }
    const { apiUrl, apiKey } = await getAuth(options.apiUrl);
    const source = readUploadSource(target);
    // A slug names the draft by itself, so the saved mapping for this path is
    // only used without one. `--draft <id> --slug <name>` renames a draft.
    const mappedDraftId =
      options.new || options.draft || options.slug !== undefined
        ? null
        : findDraftMapping(apiUrl, source.resolved)?.draftId || null;
    const draftId = options.draft || mappedDraftId;

    const payload = {
      ...source.body,
      filename: source.filename,
      draftId,
      slug: options.slug,
      description: options.description,
      metadata: {
        ...collectGitMetadata(source.dir),
        ...collectCiMetadata(),
        cliVersion: VERSION,
        ...(source.body.html ? { fileSha256: sha256(source.body.html) } : {})
      }
    };

    const { ok, status, body } = await requestJson(`${apiUrl}/api/uploads`, {
      apiKey,
      body: payload,
      timeoutMs: 300_000
    });

    if (!ok) {
      const staleMapping = status === 404 && mappedDraftId;
      const hint = staleMapping
        ? "\nThe saved artifact for this path is in another team or was deleted. Re-run with --new to publish a new one."
        : "";
      if (options.json) {
        printJson({ ok: false, status, error: body.error || null, errors: body.errors || [], issues: body.issues || [] });
        process.exitCode = 1;
        return;
      }
      throw new CliError(`Upload rejected (HTTP ${status}): ${serverErrorMessage(body)}${hint}`);
    }

    const receipt = {
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
      team: body.organization?.name || null,
      pages: body.pages || null,
      // The draft ID never moves; a slug can be renamed and reused by
      // another draft, so it would not reliably name this one.
      updateCommand: [
        "htmlartifact upload",
        shellQuote(source.resolved),
        `--draft ${body.draftId}`,
      ]
        .filter(Boolean)
        .join(" "),
      warnings: body.warnings || []
    };

    // Print the receipt before touching local state: the page is already
    // published, and a failed map write must not hide where it went.
    if (options.json) {
      printJson(receipt);
    } else {
      printReceipt(receipt);
    }

    try {
      saveDraftMapping(apiUrl, source.resolved, {
        draftId: receipt.draftId,
        slug: receipt.slug,
        publicUrl: receipt.url,
        rawUrl: receipt.rawUrl,
        latestVersionNumber: receipt.versionNumber
      });
    } catch (error) {
      console.error(`Warning: published, but could not save the local draft mapping: ${error.message}`);
    }
  });

program
  .command("check")
  .argument("[path]", "HTML file or folder to validate; omit for a readiness check only")
  .option("--slug <name>", "Also check whether a custom URL is available to you")
  .option("--json", "Print the report as JSON")
  .option("--api-url <url>", "The htmlartifact server")
  .description("Check account, limits, and capabilities, and validate a page. Never publishes.")
  .action(async (target, options) => {
    const { apiUrl, apiKey } = await getAuth(options.apiUrl);
    const source = target ? readUploadSource(target) : null;

    let report;
    try {
      const { ok, status, body } = await requestJson(`${apiUrl}/api/check`, {
        apiKey,
        body: { ...source?.body, slug: options.slug },
        timeoutMs: 60_000
      });
      report = ok
        ? { ...body, offline: false }
        : { ok: false, offline: false, status, errors: body.errors || [body.error] };
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      report = offlineReport(source, error);
    }

    report = { cliVersion: VERSION, apiUrl, path: source?.resolved || null, ...report };
    if (options.json) {
      printJson(report);
    } else {
      printCheckReport(report);
    }
    if (!report.ok) process.exitCode = 1;
  });

program
  .command("list")
  .description("List your artifacts in the current team (--all: everyone's).")
  .option("--all", "List every artifact published in your team")
  .option("--api-url <url>", "The htmlartifact server")
  .option("--json", "Print the raw JSON response")
  .action(async (options) => {
    const { apiUrl, apiKey } = await getAuth(options.apiUrl);
    const scope = options.all ? "?scope=workspace" : "";
    const { ok, body } = await requestJson(`${apiUrl}/api/drafts${scope}`, { apiKey });
    if (!ok) {
      throw new CliError(body.error || "Failed to list drafts.");
    }

    const drafts = body.drafts || [];

    if (options.json) {
      console.log(JSON.stringify(drafts, null, 2));
      return;
    }

    if (!drafts.length) {
      console.log(options.all ? "Nothing published in this team yet." : "Nothing yet. Publish with: htmlartifact upload <file>");
      return;
    }

    console.log(`Drafts (${drafts.length})\n`);
    for (const draft of drafts) {
      const repo = draft.repoOrg && draft.repoName ? `${draft.repoOrg}/${draft.repoName}` : "no repo";
      const version = draft.latestVersionNumber ? `v${draft.latestVersionNumber}` : "no versions";
      const count = `${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"}`;
      const disabled = draft.disabled ? " · disabled" : "";

      console.log(`${draft.title || "Untitled"}${options.all && draft.author ? `  · ${draft.author}` : ""}`);
      console.log(`  ${repo} · ${version} · ${count} · updated ${timeAgo(draft.updatedAt)}${disabled}`);
      console.log(`  ${draft.publicUrl}`);
      if (draft.description) {
        console.log(`  ${draft.description}`);
      }
      console.log("");
    }
  });

program.exitOverride();

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(1);
  }

  if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
    process.exit(0);
  }

  console.error(error.message || error);
  process.exit(1);
});

function resolveApiUrl(override) {
  const config = readJson(CONFIG_PATH, {});
  const credentials = readJson(CREDENTIALS_PATH, {});
  const apiUrl = override || process.env.HTMLARTIFACT_API_URL || credentials.apiUrl || config.apiUrl || DEFAULT_API_URL;
  if (!apiUrl) {
    throw new CliError("No htmlartifact server configured. Run: htmlartifact login --api-url https://<your-server>");
  }
  return apiUrl.replace(/\/+$/, "");
}

// The bearer credential for every request: HTMLARTIFACT_TOKEN (CI: a WorkOS
// organization API key) or the saved sign-in, refreshed when it expires.
async function getAuth(apiUrlOverride) {
  const apiUrl = resolveApiUrl(apiUrlOverride);
  if (process.env.HTMLARTIFACT_TOKEN) return { apiUrl, apiKey: process.env.HTMLARTIFACT_TOKEN };

  const session = readJson(CREDENTIALS_PATH, null);
  if (!session?.refreshToken) throw new CliError("Not signed in. Run: htmlartifact login");
  if (session.apiUrl !== apiUrl) {
    throw new CliError(`Signed in to ${session.apiUrl}, not ${apiUrl}. Run: htmlartifact login --api-url ${apiUrl}`);
  }
  const fresh = tokenExpiresAt(session.accessToken) > Date.now() + 30_000
    ? session
    : await refreshSession(session);
  return { apiUrl, apiKey: fresh.accessToken };
}

// WorkOS rotates refresh tokens on every use: persist the new pair at once.
async function refreshSession(session, { organizationId } = {}) {
  const result = await postJson(`${session.apiUrl}/api/cli/token`, {
    refresh_token: session.refreshToken,
    ...(organizationId ? { organization_id: organizationId } : {})
  });
  if (!result.ok) {
    const reason = result.body.error_description || result.body.message || result.body.error || result.status;
    if (organizationId) throw new CliError(`Could not switch team: ${reason}`);
    throw new CliError(`Your sign-in expired (${reason}). Run: htmlartifact login`);
  }
  return saveSession({ apiUrl: session.apiUrl, tokens: result.body });
}

// Several teams and no --team: list them and stop, rather than guess.
async function selectTeam(apiUrl, pending, team) {
  const teams = pending.organizations || [];
  const wanted = team?.toLowerCase();
  const org = wanted && teams.find((o) => o.id === team || o.name.toLowerCase() === wanted);
  if (!org) {
    const names = teams.map((o) => `  ${o.name}`).join("\n");
    throw new CliError(`You are in several teams. Run again with --team <name>:\n${names}`);
  }
  return postJson(`${apiUrl}/api/cli/token`, {
    pending_authentication_token: pending.pending_authentication_token,
    organization_id: org.id
  });
}

function saveSession({ apiUrl, tokens }) {
  const session = {
    apiUrl,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    organizationId: tokens.organization_id || null,
    email: tokens.user?.email || null,
    updatedAt: new Date().toISOString()
  };
  ensureStateDir();
  writeJson(CREDENTIALS_PATH, session, 0o600);
  return session;
}

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": `htmlartifact/${VERSION}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    throw new NetworkError(`Could not reach ${new URL(url).origin}: ${error.cause?.message || error.message}`);
  }
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: json };
}

function tokenExpiresAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

function ensureStateDir() {
  fs.mkdirSync(HTMLARTIFACT_DIR, { recursive: true, mode: 0o700 });
}

// Each (API URL, path) binding is its own file, so concurrent uploads and
// uploads to different APIs never rewrite each other's mappings.
function draftBindingPath(apiUrl, file) {
  return path.join(DRAFT_BINDINGS_DIR, `${sha256(`${apiUrl}\n${file}`)}.json`);
}

// Finds the draft a path was last published to on this API.
function findDraftMapping(apiUrl, file) {
  return readStateJson(draftBindingPath(apiUrl, file));
}

function saveDraftMapping(apiUrl, file, entry) {
  writeJson(draftBindingPath(apiUrl, file), {
    ...entry,
    apiUrl,
    file,
    updatedAt: new Date().toISOString()
  });
}

// Reads a JSON state file, or null when it does not exist. A corrupt file is
// moved aside, not silently reset, so it can still be recovered by hand.
function readStateJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Warning: could not read ${file}: ${error.message}`);
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const aside = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, aside);
    console.error(`Warning: ${file} was not valid JSON. Moved it to ${aside}.`);
    return null;
  }
}

// Reads an upload target: one HTML file, or every .html file under a folder
// (skipping dotfiles and node_modules) as pages keyed by relative path.
function readUploadSource(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    throw new CliError(`Path does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return {
      resolved,
      dir: path.dirname(resolved),
      filename: path.basename(resolved),
      body: { html: fs.readFileSync(resolved, "utf8") }
    };
  }

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push({
          path: path.relative(resolved, full).split(path.sep).join("/"),
          html: fs.readFileSync(full, "utf8")
        });
      }
    }
  };
  walk(resolved);
  if (!files.length) {
    throw new CliError(`No .html files found in ${resolved}`);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { resolved, dir: resolved, filename: path.basename(resolved), body: { files } };
}

// POSTs `body` as JSON (GET when absent) and returns { ok, status, body }.
// Unreachable servers throw NetworkError, so callers can tell "could not
// reach the server" apart from "the server rejected this".
async function requestJson(url, { apiKey, body, timeoutMs = 30_000 } = {}) {
  const headers = { "User-Agent": `htmlartifact/${VERSION}` };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const reason =
      error.name === "TimeoutError"
        ? `timed out after ${timeoutMs / 1000}s`
        : error.cause?.message || error.message;
    throw new NetworkError(`Could not reach ${new URL(url).origin}: ${reason}`);
  }

  // The connection can also drop or time out while the body streams in.
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new NetworkError(`Lost the connection to ${new URL(url).origin}: ${error.cause?.message || error.message}`);
  }
  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: response.status,
      body: { error: `htmlartifact returned HTTP ${response.status}: ${text.slice(0, 200)}` }
    };
  }
}

function serverErrorMessage(body) {
  const details = body.errors?.length ? `\n- ${body.errors.join("\n- ")}` : "";
  return `${body.error || "HTML failed htmlartifact validation."}${details}`;
}

// Offline fallback for `check`: the bundled validator knows the markup rules,
// but not the account, its limits, or whether scripts are allowed.
function offlineReport(source, error) {
  const validation = source
    ? validateUpload(source.body.files || [{ path: "index.html", html: source.body.html }])
    : null;
  return {
    ok: false,
    offline: true,
    networkError: error.message,
    ...(validation && {
      markupOk: validation.ok,
      totalBytes: validation.totalBytes,
      pages: validation.pages.map((page) => ({ path: page.path, bytes: page.bytes, title: page.title, hasScripts: page.hasScripts })),
      issues: validation.issues,
      errors: validation.errors,
      warnings: validation.warnings
    })
  };
}

function printReceipt(receipt) {
  const headline = {
    created: "Uploaded draft",
    updated: "Updated draft",
    unchanged: `Unchanged: this content is already version ${receipt.versionNumber}`
  }[receipt.action];
  console.log(headline);
  console.log(`URL: ${receipt.url}`);
  console.log(`Raw HTML: ${receipt.rawUrl}`);
  if (receipt.versionUrl) console.log(`Version URL: ${receipt.versionUrl}`);
  console.log(`Draft ID: ${receipt.draftId}`);
  console.log(`Version: ${receipt.versionNumber}`);
  if (receipt.pages) console.log(`Pages: ${receipt.pages.map((page) => page.path).join(", ")}`);
  console.log(`Team: ${receipt.team} (visible to its members only)`);
  console.log(`Update: ${receipt.updateCommand}`);
  for (const warning of receipt.warnings) {
    console.warn(`Warning: ${warning}`);
  }
}

function printCheckReport(report) {
  console.log(`htmlartifact ${report.cliVersion} -> ${report.apiUrl}`);
  if (report.offline) {
    console.log(`Offline: ${report.networkError}`);
    console.log("Checked markup locally. Account and limits were not checked.");
  } else if (report.limits) {
    console.log(`Account: ${report.account?.name}`);
    console.log(`Team: ${report.organization?.name}`);
    console.log(`Limit: ${formatBytes(report.limits.maxBytes)} per upload, ${report.limits.maxPages} page(s)`);
  }
  if (report.slug) {
    console.log(`Custom URL "${report.slug.slug}": ${report.slug.status}${report.slug.message ? `. ${report.slug.message}` : ""}`);
  }
  if (report.path && report.pages) {
    const count = `${report.pages.length} page${report.pages.length === 1 ? "" : "s"}`;
    console.log(`\n${report.path} (${count}, ${formatBytes(report.totalBytes)})`);
  }
  for (const issue of report.issues || []) {
    console.log(`${issue.level === "error" ? "Error" : "Warning"}: ${formatIssue(issue)}`);
  }
  if (!report.issues) {
    for (const error of report.errors || []) console.log(`Error: ${error}`);
  }
  console.log(report.ok ? "\nReady." : "\nNot ready.");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function shellQuote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Writes through a temp file and rename, so a crash or a concurrent CLI run
// never leaves half-written JSON behind.
function writeJson(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, file);
}

function collectGitMetadata(cwd) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const parsedRemote = parseRemote(remote);
  const status = git(["status", "--porcelain"], cwd);

  return {
    repoOrg: parsedRemote.org || inferOrgFromRoot(repoRoot),
    repoName: parsedRemote.name || (repoRoot ? path.basename(repoRoot) : null),
    repoHost: parsedRemote.host || null,
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitCommitSha: git(["rev-parse", "HEAD"], cwd),
    gitCommitSubject: git(["log", "-1", "--format=%s"], cwd),
    // null when not a git repo; true/false when a working tree is present.
    gitDirty: status === null ? null : status.length > 0
  };
}

// Best-effort CI provenance. GitHub Actions is detected precisely (with a run
// URL); other CI systems are flagged generically. Nothing here is trusted for
// authorization — it is metadata for the dashboard and audit trail only.
function collectCiMetadata() {
  const env = process.env;
  if (env.GITHUB_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      ciProvider: "github_actions",
      ciRunUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
      ciActor: env.GITHUB_ACTOR || null
    };
  }
  if (env.CI) {
    return { ciProvider: "unknown" };
  }
  return {};
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function parseRemote(remote) {
  if (!remote) return {};

  const cleaned = remote.replace(/\.git$/, "");
  const sshMatch = cleaned.match(/^[^@]+@([^:]+):([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { host: sshMatch[1], org: sshMatch[2], name: path.basename(sshMatch[3]) };
  }

  try {
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { host: url.hostname, org: parts[0], name: parts.at(-1) };
    }
  } catch {
    // Fall through to path parsing.
  }

  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { org: parts.at(-2), name: parts.at(-1) };
  }

  return {};
}

function inferOrgFromRoot(repoRoot) {
  if (!repoRoot) return null;
  return path.basename(path.dirname(repoRoot));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function timeAgo(value) {
  if (!value) return "unknown";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [name, secs] of units) {
    const amount = Math.floor(seconds / secs);
    if (amount >= 1) return `${amount} ${name}${amount === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
