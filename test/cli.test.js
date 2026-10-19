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

  // Switching back to Acme: the Design Crit artifact is not visible there.
  await cli(["workspace", "switch", "Acme"]);
  assert.equal((await json(["whoami"])).workspace.name, "Acme");
  await assert.rejects(cli(["read", receipt.url]), /HTTP 404/);
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
  assert.equal(failed.code, 1);
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
    cli(["list"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "empty-home") }),
    /Not signed in\. Run: htmlartifact login/
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
