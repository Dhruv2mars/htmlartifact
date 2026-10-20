import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import {
  accessToken,
  callApi,
  findOrganization,
  findUser,
  page,
  refreshInto,
  signInTokens,
  startStack,
  workosApi,
  writeHtml
} from "./helpers.js";

// Workspace CI keys (`workspace api-key`): an admin creates one, CI uses it as
// HTMLARTIFACT_TOKEN, and it stops working when revoked, when its creator
// leaves the workspace, or when the workspace is deleted.
const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;
let stack;
let acme;
let alice;
let bob;

before(async () => {
  // Membership is re-checked with WorkOS on every request, so role changes
  // made in the emulator apply at once.
  stack = await startStack({ vars: { HTMLARTIFACT_MEMBERSHIP_CACHE_SECONDS: "0" } });
  acme = await findOrganization(stack.emulator, "Acme");
  alice = await accessToken(stack, "alice@acme.test", "Acme");
  bob = await accessToken(stack, "bob@acme.test", "Acme");
});

after(async () => {
  await stack?.stop();
});

const createKey = (token, body = {}) => callApi(stack, token, "POST", "/api/workspaces/api-keys", body);
const listKeys = (token) => callApi(stack, token, "GET", "/api/workspaces/api-keys");
const revokeKey = (token, id) => callApi(stack, token, "DELETE", `/api/workspaces/api-keys/${id}`);

test("an admin creates a key, CI publishes and reads with it, and revoking it ends access", async () => {
  const created = await createKey(alice, { name: "GitHub Actions" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { key, token } = created.body;
  assert.match(token, /^htmlartifact_ci_[A-Za-z0-9_-]{43}$/);
  assert.equal(key.name, "GitHub Actions");
  assert.equal(created.body.workspace.id, acme.id);

  // Listed without the secret.
  const listed = await listKeys(alice);
  assert.equal(listed.status, 200);
  const entry = listed.body.keys.find((k) => k.id === key.id);
  assert.ok(entry, "the new key is listed");
  assert.equal(entry.lastUsedAt, null);
  assert.ok(!JSON.stringify(listed.body).includes(token), "the secret is never listed");

  // Used as HTMLARTIFACT_TOKEN: it acts for the workspace, with no role.
  const me = await callApi(stack, token, "GET", "/api/me");
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.workspace.id, acme.id);
  assert.equal(me.body.workspace.role ?? null, null);
  const upload = await callApi(stack, token, "POST", "/api/uploads", { html: page("CI report"), slug: "ci-report" });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  const read = await fetch(upload.body.publicUrl, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(read.status, 200);
  assert.match(await read.text(), /CI report/);
  // Members see it; the key is named as its author.
  const feed = await callApi(stack, bob, "GET", "/api/drafts?scope=workspace");
  assert.ok(feed.body.drafts.some((d) => d.draftId === upload.body.draftId));
  assert.ok((await listKeys(alice)).body.keys.find((k) => k.id === key.id).lastUsedAt, "last use is recorded");

  // A rotated key keeps updating the same artifact.
  const next = (await createKey(alice, { name: "GitHub Actions 2" })).body.token;
  const again = await callApi(stack, next, "POST", "/api/uploads", { html: page("CI report v2"), slug: "ci-report" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.draftId, upload.body.draftId);

  // A key cannot manage the workspace or mint more keys.
  assert.equal((await createKey(token)).status, 403);
  assert.equal((await listKeys(token)).status, 403);
  assert.equal((await callApi(stack, token, "POST", "/api/workspaces/invites", {})).status, 403);

  const revoked = await revokeKey(alice, key.id);
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal((await callApi(stack, token, "GET", "/api/me")).status, 401);
  assert.equal((await callApi(stack, token, "POST", "/api/uploads", { html: page("late") })).status, 401);
  assert.ok(!(await listKeys(alice)).body.keys.some((k) => k.id === key.id), "revoked keys are not listed");
  assert.equal((await revokeKey(alice, key.id)).status, 404, "revoking twice says so");
  assert.equal((await callApi(stack, next, "GET", "/api/me")).status, 200, "other keys keep working");
});

test("members cannot create, list or revoke keys", async () => {
  const created = await createKey(bob, { name: "sneaky" });
  assert.equal(created.status, 403);
  assert.equal(created.body.error, "Only workspace admins can do that.");
  assert.equal((await listKeys(bob)).status, 403);
  const id = (await createKey(alice, { name: "kept" })).body.key.id;
  assert.equal((await revokeKey(bob, id)).status, 403);
  assert.ok((await listKeys(alice)).body.keys.some((k) => k.id === id));
  assert.equal((await callApi(stack, null, "POST", "/api/workspaces/api-keys", {})).status, 401);
});

test("an admin of another workspace can neither see nor revoke the key", async () => {
  const { key, token } = (await createKey(alice, { name: "isolated" })).body;
  const nora = await signInTokens(stack, "nora@new.test");
  const made = await callApi(stack, nora.accessToken, "POST", "/api/workspaces", { name: "Nora Keys" });
  assert.equal(made.status, 201);
  const noraToken = (await refreshInto(stack, nora, made.body.workspace.id)).accessToken;
  assert.equal((await revokeKey(noraToken, key.id)).status, 404);
  const theirs = await listKeys(noraToken);
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.body.keys, []);
  assert.equal((await callApi(stack, token, "GET", "/api/me")).status, 200);
  // A forged or unknown key of the right shape is simply not signed in.
  assert.equal((await callApi(stack, null, "GET", "/api/me")).status, 401);
  const forged = `htmlartifact_ci_${"A".repeat(43)}`;
  assert.equal((await callApi(stack, forged, "GET", "/api/me")).status, 401);
});

test("removing the admin who created a key revokes it", async () => {
  const bobUser = await findUser(stack.emulator, "bob@acme.test");
  const memberships = await workosApi(
    stack.emulator,
    "GET",
    `/user_management/organization_memberships?user_id=${bobUser.id}&organization_id=${acme.id}`
  );
  await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${memberships.data[0].id}`, { role_slug: "admin" });
  const created = await createKey(bob, { name: "Bob's CI" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const { key, token } = created.body;
  assert.equal((await callApi(stack, token, "GET", "/api/me")).status, 200);

  const removed = await callApi(stack, alice, "DELETE", `/api/workspaces/members/${bobUser.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal((await callApi(stack, token, "GET", "/api/me")).status, 401);
  assert.ok(!(await listKeys(alice)).body.keys.some((k) => k.id === key.id), "listed as revoked at once");
});

test("deleting the workspace revokes its keys", async () => {
  const sam = await signInTokens(stack, "sam@new.test");
  const made = await callApi(stack, sam.accessToken, "POST", "/api/workspaces", { name: "Short Lived" });
  assert.equal(made.status, 201);
  const samToken = (await refreshInto(stack, sam, made.body.workspace.id)).accessToken;
  const { token } = (await createKey(samToken)).body;
  assert.equal((await callApi(stack, token, "GET", "/api/me")).status, 200);
  const deleted = await callApi(stack, samToken, "DELETE", "/api/workspaces/current", { confirm: "Short Lived" });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal((await callApi(stack, token, "GET", "/api/me")).status, 401);
});

test("CLI: workspace api-key create / list / revoke, and the key as HTMLARTIFACT_TOKEN", async () => {
  const home = path.join(stack.tmp, "cli-home");
  const cli = (args, env = {}) =>
    run(process.execPath, [CLI, ...args], {
      env: { ...process.env, HTMLARTIFACT_HOME: home, HTMLARTIFACT_TOKEN: "", HTMLARTIFACT_API_URL: stack.baseUrl, ...env },
      timeout: 60_000
    });
  // The emulator approves device sign-in as alice, admin of Acme.
  await cli(["login"]);

  const created = await cli(["workspace", "api-key", "create", "--name", "Nightly"]);
  const token = created.stdout.match(/htmlartifact_ci_[A-Za-z0-9_-]+/)?.[0];
  assert.ok(token, created.stdout);
  assert.match(created.stdout, /only time it is shown/);
  const id = created.stdout.match(/\((api_key_ci_\w+)\)/)?.[1];
  assert.ok(id, created.stdout);

  const listed = JSON.parse((await cli(["workspace", "api-key", "list", "--json"])).stdout);
  assert.ok(listed.some((k) => k.id === id && k.name === "Nightly"));

  const ci = { HTMLARTIFACT_TOKEN: token, HTMLARTIFACT_HOME: path.join(stack.tmp, "ci-home") };
  const file = writeHtml(stack.tmp, "nightly.html", page("Nightly"));
  const published = JSON.parse((await cli(["upload", file, "--slug", "nightly", "--json"], ci)).stdout);
  assert.equal(published.action, "created", JSON.stringify(published));
  assert.equal(published.slug, "nightly");
  await assert.rejects(cli(["workspace", "api-key", "create"], ci), /Only workspace admins/);

  assert.match((await cli(["workspace", "api-key", "revoke", id])).stdout, /Revoked/);
  await assert.rejects(cli(["upload", file, "--slug", "nightly"], ci), /Not signed in|401/);
});
