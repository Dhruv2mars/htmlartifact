import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { CI_KEY, page, startStack, writeHtml } from "./helpers.js";

const run = promisify(execFile);
const CLI = new URL("../bin/htmlartifact.js", import.meta.url).pathname;
let stack;
let home;

before(async () => {
  stack = await startStack();
  home = path.join(stack.tmp, "cli-home");
});

after(async () => {
  await stack?.stop();
});

function cli(args, env = {}) {
  return run(process.execPath, [CLI, ...args], {
    env: { ...process.env, HTMLARTIFACT_HOME: home, HTMLARTIFACT_TOKEN: "", HTMLARTIFACT_API_URL: "", ...env },
    timeout: 60_000
  });
}

test("login → upload → read → list, all as one team member", async () => {
  // The emulator approves device sign-in as its first seeded user (alice).
  const login = await cli(["login", "--api-url", stack.baseUrl]);
  assert.match(login.stdout, /Signed in as alice@acme\.test in team "Acme"/);
  const saved = JSON.parse(fs.readFileSync(path.join(home, "credentials.json"), "utf8"));
  assert.ok(saved.refreshToken);
  assert.equal(fs.statSync(path.join(home, "credentials.json")).mode & 0o777, 0o600);

  const file = writeHtml(stack.tmp, "plan.html", page("CLI plan"));
  const upload = JSON.parse((await cli(["upload", file, "--json"])).stdout);
  assert.equal(upload.ok, true);
  assert.equal(upload.team, "Acme");

  const again = JSON.parse((await cli(["upload", file, "--json"])).stdout);
  assert.equal(again.draftId, upload.draftId, "same path updates the same artifact");
  assert.equal(again.action, "unchanged");

  const read = await cli(["read", upload.url]);
  const out = read.stdout.match(/File: (.+)/)[1];
  assert.match(fs.readFileSync(out, "utf8"), /CLI plan/);

  const list = await cli(["list", "--all"]);
  assert.match(list.stdout, /CLI plan/);

  const whoami = await cli(["whoami"]);
  assert.match(whoami.stdout, /Team: Acme/);
});

test("read refuses to send the token to another host", async () => {
  await assert.rejects(cli(["read", "https://evil.example/d/abc"]), /not your htmlartifact server/);
});

test("an expired access token is refreshed and the rotated pair saved", async () => {
  const file = path.join(home, "credentials.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const [h, , s] = saved.accessToken.split(".");
  const expired = Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url");
  fs.writeFileSync(file, JSON.stringify({ ...saved, accessToken: `${h}.${expired}.${s}` }));
  const whoami = await cli(["whoami"]);
  assert.match(whoami.stdout, /Team: Acme/);
  const rotated = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.notEqual(rotated.refreshToken, saved.refreshToken);
});

test("CI publishes with HTMLARTIFACT_TOKEN and no saved sign-in", async () => {
  const file = writeHtml(stack.tmp, "ci.html", page("CI build"));
  const result = await cli(["upload", file, "--json", "--new"], {
    HTMLARTIFACT_HOME: path.join(stack.tmp, "ci-home"),
    HTMLARTIFACT_TOKEN: CI_KEY,
    HTMLARTIFACT_API_URL: stack.baseUrl
  });
  assert.equal(JSON.parse(result.stdout).team, "Acme");
});

test("signed out, every command says how to sign in", async () => {
  await assert.rejects(
    cli(["list"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "empty-home"), HTMLARTIFACT_API_URL: stack.baseUrl }),
    /Not signed in\. Run: htmlartifact login/
  );
});
