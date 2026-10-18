import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { CI_KEY, callApi, page, refreshInto, signInTokens, startStack, writeHtml } from "./helpers.js";

// The whole agent workflow through the real CLI binary, against a local
// Worker and the WorkOS emulator. Every command is what an agent would run.
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

test("signed out, commands say how to sign in", async () => {
  await assert.rejects(
    cli(["list"], { HTMLARTIFACT_HOME: path.join(stack.tmp, "empty-home") }),
    /Not signed in\. Run: htmlartifact login/
  );
});
