import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { CI_KEY, callApi, page, refreshInto, signInTokens, startStack, writeHtml } from "./helpers.js";

// The whole agent workflow through the built CLI (dist/htmlartifact.js), against a local
// Worker and the WorkOS emulator. Every command is what an agent would run.
const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;
let stack;
let home;

before(async () => {
  stack = await startStack({ enterpriseConnections: true });
  home = path.join(stack.tmp, "cli-home");
});

after(async () => {
  await stack?.stop();
});

function cli(args, env = {}) {
  return run(process.execPath, [CLI, ...args], {
    env: {
      ...process.env,
      HTMLARTIFACT_HOME: home,
      HTMLARTIFACT_TOKEN: "",
      HTMLARTIFACT_API_URL: stack.baseUrl,
      // Tests run in CI too: only the CI test says it is in CI.
      CI: "",
      GITHUB_ACTIONS: "",
      ...env
    },
    timeout: 60_000
  });
}

const json = async (args, env) => JSON.parse((await cli([...args, "--json"], env)).stdout);

test("sign in → create workspace → invite → teammate joins → publish → teammate reads", async () => {
  // The emulator approves device sign-in as its first seeded user (alice).
  const login = await cli(["login"]);
  assert.match(login.stdout, /Signed in as alice@acme\.test/);
  assert.equal(fs.statSync(path.join(home, "credentials.json")).mode & 0o777, 0o600);

  const created = await json(["workspace", "create", "Design Crit"]);
  assert.equal(created.workspace.role, "admin");
  assert.equal((await json(["whoami"])).workspace.name, "Design Crit");

  const invite = await json(["workspace", "invite"]);
  assert.match(invite.code, /^HA-/);

  // A teammate (as their own agent would): sign in, join with the code.
  let sam = await signInTokens(stack, "sam@new.test");
  const joined = await callApi(stack, sam.accessToken, "POST", "/api/workspaces/join", { code: invite.code });
  assert.equal(joined.status, 200);
  sam = await refreshInto(stack, sam, created.workspace.id);

  const members = await json(["workspace", "members"]);
  assert.deepEqual(members.map((m) => m.email).sort(), ["alice@acme.test", "sam@new.test"]);

  const file = writeHtml(stack.tmp, "crit.html", page("Crit notes"));
  const receipt = await json(["upload", file]);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.workspace, "Design Crit");
  const again = await json(["upload", file]);
  assert.equal(again.draftId, receipt.draftId, "same path updates the same artifact");
  assert.equal(again.action, "unchanged");

  // The teammate can open it; the CLI's own read works too.
  const opened = await fetch(receipt.url, { headers: { Authorization: `Bearer ${sam.accessToken}` } });
  assert.equal(opened.status, 200);
  const read = await cli(["read", receipt.url]);
  assert.match(fs.readFileSync(read.stdout.match(/File: (.+)/)[1], "utf8"), /Crit notes/);
  // A bare artifact ID (as list and upload print it) works too.
  const byId = await cli(["read", receipt.draftId]);
  assert.match(fs.readFileSync(byId.stdout.match(/File: (.+)/)[1], "utf8"), /Crit notes/);
  assert.match((await cli(["list", "--all"])).stdout, /Crit notes/);

  // Admin Portal links for the IT admin.
  const domains = await json(["workspace", "domains"]);
  assert.match(domains.url, new RegExp(`/portal/domain_verification/${created.workspace.id}$`));
  assert.match((await cli(["workspace", "sso"])).stdout, /WorkOS Admin Portal: .*\/portal\/sso\//);

  // Delete an artifact: gone for the teammate too.
  const scratch = await json(["upload", writeHtml(stack.tmp, "scratch.html", page("Scratch")), "--new"]);
  const deleted = await json(["delete", scratch.draftId]);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.draftId, scratch.draftId);
  const gone = await fetch(scratch.url, { headers: { Authorization: `Bearer ${sam.accessToken}` }, redirect: "manual" });
  assert.equal(gone.status, 404);

  // Switching back to Acme: the Design Crit artifact is not listed there, but
  // `read` still opens it (alice is a member of both, as in the browser).
  await cli(["workspace", "switch", "Acme"]);
  assert.equal((await json(["whoami"])).workspace.name, "Acme");
  assert.ok(!(await json(["list", "--all"])).drafts.some((d) => d.draftId === receipt.draftId));
  assert.match((await cli(["read", receipt.url])).stdout, /File: /);
  const listed = await json(["workspace", "list"]);
  assert.deepEqual(listed.map((w) => w.name).sort(), ["Acme", "Design Crit"]);
});

test("read refuses to send the token to another host", async () => {
  await assert.rejects(cli(["read", "https://evil.example/d/abcdefghijkl"]), /not your htmlartifact server/);
});

test("delete refuses a URL from another host, before any sign-in", async () => {
  await assert.rejects(
    cli(["delete", "https://evil.example/d/abcdefghijkl"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "no-home") }),
    /https:\/\/evil\.example is not your htmlartifact server/
  );
});

test("an expired access token is refreshed and the rotated pair saved", async () => {
  const file = path.join(home, "credentials.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const [h, , s] = saved.accessToken.split(".");
  const expired = Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url");
  fs.writeFileSync(file, JSON.stringify({ ...saved, accessToken: `${h}.${expired}.${s}` }));
  assert.match((await cli(["whoami"])).stdout, /Workspace: Acme/);
  assert.notEqual(JSON.parse(fs.readFileSync(file, "utf8")).refreshToken, saved.refreshToken);
});

test("CI publishes with HTMLARTIFACT_TOKEN and no saved sign-in", async () => {
  const file = writeHtml(stack.tmp, "ci.html", page("CI build"));
  const receipt = await json(["upload", file, "--new"], {
    HTMLARTIFACT_HOME: path.join(stack.tmp, "ci-home"),
    HTMLARTIFACT_TOKEN: CI_KEY
  });
  assert.equal(receipt.workspace, "Acme");
});

test("prune keeps the latest versions; check and list show the workspace's storage; list says who updated", async () => {
  const ci = await json(["upload", writeHtml(stack.tmp, "nightly.html", page("Nightly v1")), "--new"], {
    HTMLARTIFACT_HOME: path.join(stack.tmp, "ci-home"),
    HTMLARTIFACT_TOKEN: CI_KEY
  });
  // An admin publishing over someone else's artifact is told so.
  const file = path.join(stack.tmp, "nightly-fix.html");
  for (const n of [2, 3, 4]) {
    fs.writeFileSync(file, page(`Nightly v${n}`));
    const { stderr } = await cli(["upload", file, "--draft", ci.draftId]);
    assert.match(stderr, /Warning: This artifact is Acme CI \(API key\)'s: you published version \d over their work/);
  }
  assert.match((await cli(["list", "--all"])).stdout, /Nightly v4 {2}· Acme CI \(API key\)\n.* · v4 · 4 versions · updated just now by Alice/);

  await assert.rejects(cli(["prune", ci.draftId]), (error) => error.code === 2 && /--keep 5/.test(error.stderr));
  const pruned = await json(["prune", ci.draftId, "--keep", "1"]);
  assert.equal(pruned.deleted, 3);
  assert.equal(pruned.versionCount, 1);
  assert.equal(pruned.usage.remainingBytes, pruned.usage.limitBytes - pruned.usage.storedBytes);
  assert.match((await cli(["prune", ci.draftId, "--keep", "1"])).stdout, /Nothing to prune: \w+ has 1 version\.\nStorage: .* of 50 MiB used \(.* left\)/);

  const listed = await json(["list", "--all"]);
  assert.ok(listed.drafts.some((d) => d.draftId === ci.draftId && d.updatedBy === "Alice" && d.versionCount === 1));
  assert.deepEqual(listed.usage, pruned.usage);
  assert.deepEqual((await json(["check"])).usage, pruned.usage);
  assert.match((await cli(["check"])).stdout, /Storage: .* of 50 MiB used/);
  assert.match((await cli(["list"])).stdout, /Storage: .* of 50 MiB used/);
});

test("upload checks the markup locally first: errors with line and column, nothing sent", async () => {
  const file = writeHtml(stack.tmp, "bad.html", `<!doctype html><title>Bad</title>\n<p>ok</p>\n<iframe src="https://x.test"></iframe>`);
  // An API URL nothing listens on: the local check must fail before any request.
  const env = { HTMLARTIFACT_HOME: path.join(stack.tmp, "ci-home"), HTMLARTIFACT_TOKEN: CI_KEY, HTMLARTIFACT_API_URL: "http://127.0.0.1:9" };
  await assert.rejects(cli(["upload", file], env), (error) => {
    assert.match(error.stderr, /Not uploaded: the HTML failed htmlartifact validation \(checked locally\)/);
    assert.match(error.stderr, /line 3:1: Blocked <iframe> tag\./);
    return true;
  });
  const failed = await cli(["upload", file, "--json"], env).catch((error) => error);
  assert.equal(failed.code, 5, "validation exit code");
  const body = JSON.parse(failed.stdout);
  assert.equal(body.checkedLocally, true);
  assert.deepEqual(
    body.issues.map(({ code, line, column }) => ({ code, line, column })),
    [{ code: "blocked-tag", line: 3, column: 1 }]
  );
});

test("workspace delete needs the exact name, then erases the workspace", async () => {
  await cli(["workspace", "switch", "Design Crit"]);
  await assert.rejects(cli(["workspace", "delete"]), /htmlartifact workspace delete --confirm 'Design Crit'/);
  await assert.rejects(cli(["workspace", "delete", "--confirm", "Design"]), /exact name/);
  const result = await json(["workspace", "delete", "--confirm", "Design Crit"]);
  assert.equal(result.ok, true);
  assert.equal(result.workspace.name, "Design Crit");
  const listed = await json(["workspace", "list"]);
  assert.deepEqual(listed.map((w) => w.name), ["Acme"]);
});

test("signed out, commands say how to sign in", async () => {
  await assert.rejects(
    cli(["list"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "empty-home"), npm_command: "" }),
    /Not signed in\. Run: htmlartifact login/
  );
  // Run through npx (not installed): every hint says `npx htmlartifact`, so pasting it works.
  await assert.rejects(
    cli(["list"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "empty-home"), npm_command: "exec" }),
    /Not signed in\. Run: npx htmlartifact login/
  );
});

// ---- sign-in under load: rate limits, concurrent runs, logout --------------

// A token with the same header and signature but `exp` in the past: the CLI
// reads exp to decide when to refresh.
function expired(token) {
  const [h, , s] = token.split(".");
  return `${h}.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.${s}`;
}

// Saves a sign-in for alice in a fresh home: { home, file, tokens }.
async function signedInHome(name, { apiUrl = stack.baseUrl, expire = true } = {}) {
  const dir = path.join(stack.tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const tokens = await signInTokens(stack, "alice@acme.test", "Acme");
  const file = path.join(dir, "credentials.json");
  writeCredentials(file, apiUrl, tokens, { expire });
  return { home: dir, file, tokens };
}

function writeCredentials(file, apiUrl, tokens, { expire = true } = {}) {
  const session = {
    apiUrl,
    accessToken: expire ? expired(tokens.accessToken) : tokens.accessToken,
    refreshToken: tokens.refreshToken,
    organizationId: null,
    email: "alice@acme.test",
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(session), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

// An HTTP proxy in front of the Worker. `intercept(pathname, body)` may answer
// a request itself ({ status, headers, body }); anything else is forwarded.
async function proxy(intercept) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    let body = null;
    try {
      body = JSON.parse(raw.toString() || "null");
    } catch {
      // not JSON
    }
    try {
      const answer = await intercept(new URL(req.url, "http://proxy").pathname, body);
      if (answer) {
        res.writeHead(answer.status, { "Content-Type": "application/json", ...answer.headers });
        res.end(JSON.stringify(answer.body));
        return;
      }
      const headers = {};
      for (const name of ["authorization", "content-type", "accept", "user-agent"]) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      const upstream = await fetch(`${stack.baseUrl}${req.url}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : raw
      });
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const isRefresh = (pathname, body) => pathname === "/api/cli/token" && typeof body?.refresh_token === "string";
const RATE_LIMITED = { ok: false, error: "Rate limit exceeded. Slow down." };

test("login with no current workspace, but already in some: uses --workspace, or the only one", async () => {
  // As after joining in the browser, then signing in here with that browser
  // session: the first /api/me has no workspace.
  let fresh = 0;
  const p = await proxy((pathname) => {
    if (pathname === "/api/me" && fresh < 2) {
      fresh += 1;
      return { status: 200, body: { ok: true, name: "Alice", email: "alice@acme.test", workspace: null } };
    }
    return null;
  });
  try {
    const picked = await cli(["login", "--workspace", "Acme"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "pick-home"), HTMLARTIFACT_API_URL: p.url });
    assert.match(picked.stdout, /Workspace: Acme\n.*upload/);
    // Alice is only in Acme by now: that one becomes current.
    const home = path.join(stack.tmp, "only-home");
    const only = await cli(["login"], { HTMLARTIFACT_HOME: home, HTMLARTIFACT_API_URL: p.url, npm_command: "exec" });
    assert.match(only.stdout, /Workspace: Acme\nNext, publish a page: npx htmlartifact upload/);
    assert.equal(JSON.parse((await cli(["whoami", "--json"], { HTMLARTIFACT_HOME: home, HTMLARTIFACT_API_URL: p.url })).stdout).workspace.name, "Acme");
  } finally {
    await p.close();
  }
});

test("login keeps polling through a 429, backing off like slow_down", async () => {
  let limited = 0;
  const p = await proxy((pathname, body) => {
    if (pathname === "/api/cli/token" && body?.device_code && limited < 1) {
      limited += 1;
      return { status: 429, headers: { "Retry-After": "1" }, body: RATE_LIMITED };
    }
    return null;
  });
  try {
    const dir = path.join(stack.tmp, "poll-429-home");
    const login = await cli(["login"], { HTMLARTIFACT_HOME: dir, HTMLARTIFACT_API_URL: p.url });
    assert.equal(limited, 1);
    assert.match(login.stdout, /Signed in as alice@acme\.test/);
  } finally {
    await p.close();
  }
});

test("a rate-limited refresh is retried, honoring Retry-After", async () => {
  let limited = 0;
  const p = await proxy((pathname, body) => {
    if (isRefresh(pathname, body) && limited < 2) {
      limited += 1;
      return { status: 429, headers: { "Retry-After": "1" }, body: RATE_LIMITED };
    }
    return null;
  });
  try {
    const { home: dir } = await signedInHome("refresh-429-home", { apiUrl: p.url });
    const started = Date.now();
    const out = await cli(["whoami"], { HTMLARTIFACT_HOME: dir, HTMLARTIFACT_API_URL: p.url });
    assert.match(out.stdout, /User: Alice/);
    assert.equal(limited, 2);
    assert.ok(Date.now() - started >= 2000, "waited Retry-After between tries");
  } finally {
    await p.close();
  }
});

test("a refresh still rate-limited after retries says so, not that the sign-in expired", async () => {
  const p = await proxy((pathname, body) =>
    isRefresh(pathname, body) ? { status: 429, headers: { "Retry-After": "0" }, body: RATE_LIMITED } : null
  );
  try {
    const { home: dir, file, tokens } = await signedInHome("refresh-429-fail-home", { apiUrl: p.url });
    await assert.rejects(
      cli(["whoami"], { HTMLARTIFACT_HOME: dir, HTMLARTIFACT_API_URL: p.url }),
      (error) => /rate-limiting/.test(error.stderr) && !/expired/.test(error.stderr)
    );
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).refreshToken, tokens.refreshToken, "sign-in kept");
  } finally {
    await p.close();
  }
});

test("a refresh token another run already rotated: re-read the saved pair and retry once", async () => {
  let file;
  let rotated;
  let refused = 0;
  const p = await proxy(async (pathname, body) => {
    if (isRefresh(pathname, body) && body.refresh_token === "rt_spent_by_another_run") {
      // Meanwhile another CLI run refreshed and saved its new pair.
      refused += 1;
      rotated = await signInTokens(stack, "alice@acme.test", "Acme");
      writeCredentials(file, p.url, rotated);
      return { status: 400, body: { error: "invalid_grant", error_description: "Refresh token already exchanged." } };
    }
    return null;
  });
  try {
    const signedIn = await signedInHome("rotated-home", { apiUrl: p.url });
    file = signedIn.file;
    writeCredentials(file, p.url, { ...signedIn.tokens, refreshToken: "rt_spent_by_another_run" });
    const out = await cli(["whoami"], { HTMLARTIFACT_HOME: signedIn.home, HTMLARTIFACT_API_URL: p.url });
    assert.match(out.stdout, /User: Alice/);
    assert.equal(refused, 1);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.notEqual(saved.refreshToken, rotated.refreshToken, "the newer token was used and rotated");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    await p.close();
  }
});

test("a run waiting on the refresh lock uses the pair the lock holder saved", async () => {
  const { home: dir, file } = await signedInHome("lock-home");
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, "another-run");
  const running = cli(["whoami"], { HTMLARTIFACT_HOME: dir });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  // The holder refreshes, saves a fresh pair, and releases the lock.
  const fresh = await signInTokens(stack, "alice@acme.test", "Acme");
  writeCredentials(file, stack.baseUrl, fresh, { expire: false });
  fs.rmSync(lock);
  assert.match((await running).stdout, /User: Alice/);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).refreshToken, fresh.refreshToken, "no second refresh");
  assert.ok(!fs.existsSync(lock));
});

test("parallel runs with an expired token all succeed and leave a working sign-in", async () => {
  const { home: dir, file } = await signedInHome("parallel-home");
  const runs = await Promise.all(Array.from({ length: 4 }, () => cli(["whoami"], { HTMLARTIFACT_HOME: dir })));
  for (const run of runs) assert.match(run.stdout, /User: Alice/);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  writeCredentials(file, stack.baseUrl, saved);
  assert.match((await cli(["whoami"], { HTMLARTIFACT_HOME: dir })).stdout, /User: Alice/);
});

test("logout ends the session at the server, then forgets it", async () => {
  const { home: dir, file, tokens } = await signedInHome("logout-home", { expire: false });
  const out = await cli(["logout"], { HTMLARTIFACT_HOME: dir });
  assert.match(out.stdout, /Signed out\./);
  assert.equal(out.stderr, "");
  assert.ok(!fs.existsSync(file));
  assert.equal((await callApi(stack, tokens.accessToken, "GET", "/api/me")).status, 401);
  const refreshed = await fetch(`${stack.baseUrl}/api/cli/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refreshToken })
  });
  assert.equal(refreshed.status, 400);
});

test("logout still forgets the sign-in when the server cannot be reached", async () => {
  const offline = "http://127.0.0.1:9";
  const { home: dir, file } = await signedInHome("logout-offline-home", { apiUrl: offline, expire: false });
  const out = await cli(["logout"], { HTMLARTIFACT_HOME: dir, HTMLARTIFACT_API_URL: offline });
  assert.match(out.stdout, /Signed out\./);
  assert.match(out.stderr, /could not end the session/);
  assert.ok(!fs.existsSync(file));
});

// ---- run 3 fixes: slugs, bytes, exit codes, CI, check, sign-in errors -------

// A fresh home publishing with the CI key (Acme): its own path mappings.
function ciEnv(name, env = {}) {
  return { HTMLARTIFACT_HOME: path.join(stack.tmp, name), HTMLARTIFACT_TOKEN: CI_KEY, ...env };
}

const failure = (promise) => promise.then(() => assert.fail("expected the command to fail"), (error) => error);

test("--slug naming another artifact than the path's needs --force, and never rebinds the path", async () => {
  const env = ciEnv("slug-home");
  const bench = await json(["upload", writeHtml(stack.tmp, "bench.html", page("Bench")), "--slug", "bench-dash"], env);
  const changelogFile = writeHtml(stack.tmp, "changelog.html", page("Changelog"));
  const changelog = await json(["upload", changelogFile, "--slug", "changelog"], env);
  assert.notEqual(bench.draftId, changelog.draftId);

  const refused = await failure(cli(["upload", changelogFile, "--slug", "bench-dash"], env));
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, new RegExp(`--slug bench-dash names artifact ${bench.draftId} \\("Bench"\\), but .*changelog\\.html was published to ${changelog.draftId}`));
  assert.match(refused.stderr, /--force/);

  const forced = await json(["upload", changelogFile, "--slug", "bench-dash", "--force"], env);
  assert.equal(forced.draftId, bench.draftId);
  assert.match(forced.warnings.join("\n"), new RegExp(`still updates artifact ${changelog.draftId}`));
  // A plain upload of the path still goes to the artifact it was bound to.
  writeHtml(stack.tmp, "changelog.html", page("Changelog v2"));
  const plain = await json(["upload", changelogFile], env);
  assert.equal(plain.draftId, changelog.draftId);
  assert.equal(plain.action, "updated");
});

test("a path whose artifact was renamed cannot overwrite the artifact that took its old slug", async () => {
  const env = ciEnv("stale-slug-home");
  const aFile = writeHtml(stack.tmp, "stale-a.html", page("A"));
  const a = await json(["upload", aFile, "--slug", "stale-report"], env);
  // From another file, A is renamed; then a new artifact B takes the old slug.
  await json(["upload", writeHtml(stack.tmp, "stale-c.html", page("A renamed")), "--draft", a.draftId, "--slug", "stale-renamed"], env);
  const b = await json(["upload", writeHtml(stack.tmp, "stale-b.html", page("B")), "--slug", "stale-report"], env);
  assert.notEqual(b.draftId, a.draftId);

  // a.html's saved mapping still says A is "stale-report": refused, B untouched.
  writeHtml(stack.tmp, "stale-a.html", page("A v2"));
  const refused = await failure(cli(["upload", aFile, "--slug", "stale-report"], env));
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, new RegExp(`--slug stale-report names artifact ${b.draftId} \\("B"\\)`));
  const bNow = await callApi(stack, CI_KEY, "GET", "/api/drafts?scope=workspace&slug=stale-report");
  assert.equal(bNow.body.drafts.length, 1);
  assert.equal(bNow.body.drafts[0].draftId, b.draftId);
  assert.equal(bNow.body.drafts[0].latestVersionNumber, 1);

  // --force replaces B on purpose.
  const forced = await json(["upload", aFile, "--slug", "stale-report", "--force"], env);
  assert.equal(forced.draftId, b.draftId);
  assert.equal(forced.versionNumber, 2);
});

test("the server refuses an upload whose slug no longer names the expected artifact", async () => {
  const one = await callApi(stack, CI_KEY, "POST", "/api/uploads", { html: page("One"), slug: "expect-one" });
  const two = await callApi(stack, CI_KEY, "POST", "/api/uploads", { html: page("Two"), slug: "expect-two" });
  const refused = await callApi(stack, CI_KEY, "POST", "/api/uploads", { html: page("Over"), slug: "expect-two", expectedDraftId: one.body.draftId });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "slug_names_another_artifact");
  assert.equal(refused.body.draftId, two.body.draftId);
  // The expected artifact deleted: the slug still names another one, still refused.
  assert.equal((await callApi(stack, CI_KEY, "DELETE", `/api/drafts/${one.body.draftId}`)).status, 200);
  const again = await callApi(stack, CI_KEY, "POST", "/api/uploads", { html: page("Over"), slug: "expect-two", expectedDraftId: one.body.draftId });
  assert.equal(again.status, 409);
  // Without an expected artifact (the CLI's --force), the slug's artifact updates.
  const forced = await callApi(stack, CI_KEY, "POST", "/api/uploads", { html: page("Over"), slug: "expect-two" });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(forced.body.draftId, two.body.draftId);
});

test("read --out writes the stored bytes exactly; a non-UTF-8 file is refused, not altered", async () => {
  const env = ciEnv("bytes-home");
  const bytes = Buffer.from(`\ufeff${page("BOM").replace(/></g, ">\r\n<")}`, "utf8");
  const file = path.join(stack.tmp, "bom.html");
  fs.writeFileSync(file, bytes);
  const receipt = await json(["upload", file, "--new"], env);
  const out = path.join(stack.tmp, "bom-out.html");
  const read = await json(["read", receipt.url, "--out", out], env);
  assert.equal(read.file, out);
  assert.equal(read.bytes, bytes.length);
  assert.ok(fs.readFileSync(out).equals(bytes), "byte-identical, BOM and CRLF kept");

  const latin1 = path.join(stack.tmp, "latin1.html");
  fs.writeFileSync(latin1, Buffer.concat([Buffer.from("<!doctype html><title>caf"), Buffer.from([0xe9]), Buffer.from("</title>")]));
  const refused = await failure(cli(["upload", latin1, "--json"], { ...env, HTMLARTIFACT_API_URL: "http://127.0.0.1:9" }));
  assert.equal(refused.code, 5);
  assert.match(JSON.parse(refused.stdout).error, /latin1\.html is not valid UTF-8/);
});

test("exit codes tell failures apart, and --json errors are JSON on stdout", async () => {
  const empty = { HTMLARTIFACT_HOME: path.join(stack.tmp, "codes-home") };
  const usage = await failure(cli(["upload", "--json"], empty));
  assert.equal(usage.code, 2);
  assert.deepEqual(JSON.parse(usage.stdout), { ok: false, error: "Missing required argument: path", kind: "usage", exitCode: 2 });

  const auth = await failure(cli(["read", "abcdefghijkl", "--json"], empty));
  assert.equal(auth.code, 3);
  assert.equal(JSON.parse(auth.stdout).kind, "auth");

  const notFound = await failure(cli(["read", "abcdefghijkl", "--json"], ciEnv("codes-ci")));
  assert.equal(notFound.code, 4);
  assert.match(JSON.parse(notFound.stdout).error, /HTTP 404/);

  const network = await failure(cli(["list", "--json"], ciEnv("codes-ci", { HTMLARTIFACT_API_URL: "http://127.0.0.1:9" })));
  assert.equal(network.code, 6);
  assert.match(JSON.parse(network.stdout).error, /Could not reach http:\/\/127\.0\.0\.1:9/);

  const p = await proxy((pathname) =>
    pathname === "/api/drafts" ? { status: 429, headers: { "Retry-After": "0" }, body: RATE_LIMITED } : null
  );
  try {
    const limited = await failure(cli(["list", "--json"], ciEnv("codes-ci", { HTMLARTIFACT_API_URL: p.url })));
    assert.equal(limited.code, 7);
    assert.equal(JSON.parse(limited.stdout).kind, "rateLimit");
  } finally {
    await p.close();
  }
});

test("a 429 is retried once after its Retry-After", async () => {
  let limited = 0;
  const p = await proxy((pathname) => {
    if (pathname === "/api/drafts" && limited < 1) {
      limited += 1;
      return { status: 429, headers: { "Retry-After": "1" }, body: RATE_LIMITED };
    }
    return null;
  });
  try {
    const started = Date.now();
    const out = await cli(["list", "--json"], ciEnv("retry-home", { HTMLARTIFACT_API_URL: p.url }));
    assert.ok(Array.isArray(JSON.parse(out.stdout).drafts));
    assert.equal(limited, 1);
    assert.match(out.stderr, /Retrying in 1s/);
    assert.ok(Date.now() - started >= 1000, "waited Retry-After");
  } finally {
    await p.close();
  }
});

test("login, logout and read take --json", async () => {
  const dir = path.join(stack.tmp, "json-login-home");
  const login = await cli(["login", "--json"], { HTMLARTIFACT_HOME: dir });
  const result = JSON.parse(login.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.email, "alice@acme.test");
  assert.match(login.stderr, /Open this link/);
  const logout = JSON.parse((await cli(["logout", "--json"], { HTMLARTIFACT_HOME: dir })).stdout);
  assert.deepEqual(logout, { ok: true, wasSignedIn: true, sessionEnded: true });
});

test("in CI, an upload with neither --slug nor --draft warns that it makes a new URL every run", async () => {
  const file = writeHtml(stack.tmp, "ci-report.html", page("CI report"));
  const warned = await json(["upload", file], ciEnv("ci-warn-home", { CI: "true" }));
  assert.match(warned.warnings.join("\n"), /In CI without --slug or --draft, every run publishes a new artifact/);
  const human = await cli(["upload", file, "--slug", "ci-report"], ciEnv("ci-warn-home-2", { CI: "true" }));
  assert.doesNotMatch(human.stderr, /In CI without/);
});

test("a rejected HTMLARTIFACT_TOKEN says so, with the npx hint under --json too", async () => {
  const env = { HTMLARTIFACT_HOME: path.join(stack.tmp, "bad-token-home"), HTMLARTIFACT_TOKEN: "sk_test_not_a_key" };
  const human = await failure(cli(["list"], env));
  assert.equal(human.code, 3);
  assert.match(human.stderr, /HTMLARTIFACT_TOKEN was rejected/);
  const viaNpx = await failure(cli(["upload", writeHtml(stack.tmp, "t.html", page("T")), "--json"], { ...env, npm_command: "exec" }));
  const body = JSON.parse(viaNpx.stdout);
  assert.match(body.error, /HTMLARTIFACT_TOKEN was rejected.*\(npx htmlartifact login\)/);
  assert.equal(body.status, 401);
});

test("check works signed out, and reports line:col from the local parse", async () => {
  const bad = writeHtml(stack.tmp, "check-bad.html", `<!doctype html><title>Bad</title>\n<p>ok</p>\n<iframe src="https://x.test"></iframe>`);
  const good = writeHtml(stack.tmp, "check-good.html", page("Good"));
  const signedOut = { HTMLARTIFACT_HOME: path.join(stack.tmp, "check-out-home") };

  const ready = await json(["check", good], signedOut);
  assert.equal(ready.ok, true);
  assert.match(ready.signedOut, /Not signed in/);
  const notReady = await failure(cli(["check", bad, "--json"], signedOut));
  assert.equal(notReady.code, 5);
  assert.deepEqual(JSON.parse(notReady.stdout).issues.map(({ line, column }) => [line, column]), [[3, 1]]);

  const online = await failure(cli(["check", bad, "--json"], ciEnv("check-ci")));
  assert.equal(online.code, 5);
  const report = JSON.parse(online.stdout);
  assert.equal(report.offline, false);
  assert.deepEqual(report.issues.map(({ code, line, column }) => ({ code, line, column })), [{ code: "blocked-tag", line: 3, column: 1 }]);
  assert.match(report.errors[0], /^line 3:1: Blocked <iframe> tag\./);
});

test("an expired sign-in link says to run login again", async () => {
  const p = await proxy((pathname, body) =>
    pathname === "/api/cli/token" && body?.device_code ? { status: 400, body: { error: "expired_token" } } : null
  );
  try {
    const expiredLink = await failure(
      cli(["login"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "expired-home"), HTMLARTIFACT_API_URL: p.url, npm_command: "exec" })
    );
    assert.equal(expiredLink.code, 3);
    assert.match(expiredLink.stderr, /^The sign-in link expired\. Run: npx htmlartifact login$/m);
  } finally {
    await p.close();
  }
});
