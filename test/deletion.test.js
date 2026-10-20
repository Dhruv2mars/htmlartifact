import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getPlatformProxy, unstable_dev } from "wrangler";
import {
  Browser,
  CI_KEY,
  STORAGE,
  accessToken,
  breakWorkos,
  callApi,
  findOrganization,
  findUser,
  page,
  refreshInto,
  sendWebhook,
  signInTokens,
  startStack,
  testConfigPath,
  workosApi
} from "./helpers.js";

// Real deletion, retention and offboarding, checked against the stores
// themselves: the local R2 bucket and D1 database the Worker uses (opened
// here through wrangler's getPlatformProxy on the same persisted state), and
// the WorkOS emulator. The ops Worker (src/ops.ts) runs too, on the same
// state, and its cron is triggered for real.

let stack;
let proxy; // getPlatformProxy: env.ARTIFACTS / env.DB on the Worker's local state
let ops; // the ops Worker (deploy/ops/wrangler.toml), with test-triggerable cron

before(async () => {
  stack = await startStack({ directoryProvisioning: true });
  const state = path.join(stack.tmp, "state");
  proxy = await getPlatformProxy({
    configPath: testConfigPath(),
    persist: { path: path.join(state, "v3") }
  });
  // The deploy config names the production D1 database; local state is keyed
  // by database id, so point the ops Worker at the app's (root config) id.
  const appDatabaseId = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").match(/database_id = "([^"]+)"/)[1];
  const opsConfig = path.join(stack.tmp, "ops.wrangler.toml");
  fs.writeFileSync(
    opsConfig,
    fs
      .readFileSync(new URL("../deploy/ops/wrangler.toml", import.meta.url), "utf8")
      .replace(/^main = .*$/m, `main = ${JSON.stringify(new URL("../src/ops.ts", import.meta.url).pathname)}`)
      .replace(/database_id = "[^"]+"/g, `database_id = "${appDatabaseId}"`)
      // The deploy config leaves R2 unbound (production starts on D1); this
      // run's storage decides: the same bucket as the app for R2, none for D1.
      .replace(/^\[\[r2_buckets\]\][^[]*/gm, "") +
      (STORAGE === "r2" ? '\n[[r2_buckets]]\nbinding = "ARTIFACTS"\nbucket_name = "htmlartifact-artifacts"\n' : "")
  );
  ops = await unstable_dev(new URL("../src/ops.ts", import.meta.url).pathname, {
    config: opsConfig,
    ip: "127.0.0.1",
    persistTo: state,
    logLevel: "warn",
    testScheduled: true,
    vars: { WORKOS_API_URL: stack.emulator.url, WORKOS_API_KEY: stack.emulator.apiKey || "sk_test_default" },
    experimental: { disableExperimentalWarning: true }
  });
});

after(async () => {
  await ops?.stop();
  await proxy?.dispose();
  await stack?.stop();
});

const upload = (token, body) => callApi(stack, token, "POST", "/api/uploads", body);
// The stored objects, whichever backend this run uses (src/storage.ts).
const r2Keys = async (prefix) =>
  STORAGE === "r2"
    ? (await proxy.env.ARTIFACTS.list({ prefix })).objects.map((o) => o.key).sort()
    : (await rows("SELECT DISTINCT key FROM blobs WHERE key >= ? AND key < ? ORDER BY key", prefix, `${prefix}~`)).map((r) => r.key);
const putObject = (key, html) =>
  STORAGE === "r2"
    ? proxy.env.ARTIFACTS.put(key, html)
    : exec("INSERT INTO blobs (key, chunk, data) VALUES (?, 0, ?)", key, html);
const deleteObject = (key) =>
  STORAGE === "r2" ? proxy.env.ARTIFACTS.delete(key) : exec("DELETE FROM blobs WHERE key = ?", key);
// The app, the ops Worker and this proxy share one local SQLite file; a read
// racing a writer occasionally loses the lock. Retry only that transient error.
async function rows(sql, ...binds) {
  return retryLocked(async () => (await proxy.env.DB.prepare(sql).bind(...binds).all()).results);
}
// Direct writes from the test, retried the same way.
const exec = (sql, ...binds) => retryLocked(() => proxy.env.DB.prepare(sql).bind(...binds).run());
async function retryLocked(run) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const message = String(error?.message);
      if (attempt >= 8 || !(message.includes("session commit token") || message.includes("SQLITE_BUSY"))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
const count = async (sql, ...binds) => Object.values((await rows(sql, ...binds))[0])[0];

// Multi-page artifacts are served under a trailing slash.
const viewUrl = (receipt) => (receipt.pages ? `${receipt.publicUrl}/` : receipt.publicUrl);

async function read(url, token) {
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual" });
  return { status: response.status, text: await response.text() };
}

// What the cron does every 15 minutes, now.
async function runCron() {
  const response = await fetch(`http://127.0.0.1:${ops.port}/__scheduled?cron=${encodeURIComponent("*/15 * * * *")}`);
  assert.equal(response.status, 200, await response.text());
}

// Waits for `check`. `retrigger` (e.g. runCron) runs again every second
// meanwhile: locally a cron run can abort on the shared SQLite file's lock.
async function eventually(check, message, retrigger) {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return;
    if (retrigger && i % 10 === 9) await retrigger();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

async function draftRows(draftId) {
  return {
    drafts: await count("SELECT COUNT(*) FROM drafts WHERE id = ?", draftId),
    versions: await count("SELECT COUNT(*) FROM draft_versions WHERE draft_id = ?", draftId),
    pages: await count(
      "SELECT COUNT(*) FROM draft_pages WHERE draft_version_id IN (SELECT id FROM draft_versions WHERE draft_id = ?)",
      draftId
    )
  };
}

const multiPage = (title) => ({
  slug: "deck",
  files: [
    { path: "index.html", html: page(title, '<a href="notes.html">notes</a>') },
    { path: "notes.html", html: page(`${title} notes`) },
    { path: "deep/more.html", html: page(`${title} more`) }
  ]
});

describe("artifact deletion", () => {
  test("uploads live under orgs/<org>/drafts/<draft>/; deleting removes every version and page", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const org = await findOrganization(stack.emulator, "Acme");
    const first = await upload(alice, multiPage("Deck v1"));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await upload(alice, multiPage("Deck v2"));
    assert.equal(second.body.versionNumber, 2);
    const { draftId, publicUrl } = first.body;
    const prefix = `orgs/${org.id}/drafts/${draftId}/`;

    const keys = await r2Keys(prefix);
    assert.equal(keys.length, 6, `2 versions x 3 pages: ${keys}`);
    for (const versionId of [first.body.versionId, second.body.versionId]) {
      assert.ok(keys.includes(`${prefix}versions/${versionId}.html`));
      assert.ok(keys.includes(`${prefix}versions/${versionId}/notes.html`));
      assert.ok(keys.includes(`${prefix}versions/${versionId}/deep/more.html`));
    }
    const stored = await rows("SELECT object_key FROM draft_versions WHERE draft_id = ?", draftId);
    assert.ok(stored.every((r) => r.object_key.startsWith(prefix)));

    const deleted = await callApi(stack, alice, "DELETE", `/api/drafts/${draftId}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepEqual(deleted.body, { ok: true, draftId });

    // Gone from R2 in the same request, every row gone from D1, nothing left queued.
    assert.deepEqual(await r2Keys(prefix), []);
    assert.deepEqual(await draftRows(draftId), { drafts: 0, versions: 0, pages: 0 });
    assert.equal(await count("SELECT COUNT(*) FROM pending_deletions"), 0);
    assert.equal((await read(publicUrl, alice)).status, 404);
    assert.equal((await read(`${stack.baseUrl}/d/${draftId}/v/1/notes`, alice)).status, 404);

    // The custom URL is free again: the same slug makes a new artifact.
    const again = await upload(alice, multiPage("Deck again"));
    assert.equal(again.status, 201);
    assert.equal(again.body.created, true);
    assert.notEqual(again.body.draftId, draftId);
    assert.equal(again.body.slug, "deck");

    // Deleting twice: 404.
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${draftId}`)).status, 404);
  });

  test("a plain member cannot delete a teammate's artifact (403, says why); an admin can", async () => {
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const max = await accessToken(stack, "max@both.test", "Acme");
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const org = await findOrganization(stack.emulator, "Acme");
    const bobs = await upload(bob, { html: page("Bob's notes") });
    assert.equal(bobs.status, 201);
    const prefix = `orgs/${org.id}/drafts/${bobs.body.draftId}/`;

    const denied = await callApi(stack, max, "DELETE", `/api/drafts/${bobs.body.draftId}`);
    // They see it in the workspace list anyway, so say why instead of "not found".
    assert.equal(denied.status, 403);
    assert.match(denied.body.error, /belongs to a teammate/);
    assert.equal((await callApi(stack, max, "DELETE", "/api/drafts/zzzzzzzzzzzz")).status, 404);
    assert.equal((await r2Keys(prefix)).length, 1, "still there");

    // Another workspace cannot reach it either.
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    assert.equal((await callApi(stack, olivia, "DELETE", `/api/drafts/${bobs.body.draftId}`)).status, 404);

    const byAdmin = await callApi(stack, alice, "DELETE", `/api/drafts/${bobs.body.draftId}`);
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
    assert.deepEqual(await r2Keys(prefix), []);
    assert.deepEqual(await draftRows(bobs.body.draftId), { drafts: 0, versions: 0, pages: 0 });
  });

  test("a member can delete their own artifact", async () => {
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const mine = await upload(bob, { html: page("Bob's own") });
    assert.equal((await callApi(stack, bob, "DELETE", `/api/drafts/${mine.body.draftId}`)).status, 200);
    assert.equal(await count("SELECT COUNT(*) FROM drafts WHERE id = ?", mine.body.draftId), 0);
  });

  test("pruning keeps the latest versions, frees the rest (rows, objects, quota); same rights as delete", async () => {
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const max = await accessToken(stack, "max@both.test", "Acme");
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const org = await findOrganization(stack.emulator, "Acme");
    const usage = async () => (await callApi(stack, bob, "POST", "/api/check", {})).body.usage.storedBytes;
    const before = await usage();
    const version = (n) => ({
      slug: "prune-deck",
      files: [
        { path: "index.html", html: page(`Prune v${n}`, '<a href="notes.html">notes</a>') },
        { path: "notes.html", html: page(`Prune v${n} notes`) }
      ]
    });
    const receipts = [];
    for (let n = 1; n <= 4; n += 1) receipts.push((await upload(bob, version(n))).body);
    const { draftId } = receipts[0];
    const added = receipts.reduce((sum, r) => sum + r.totalBytes, 0);
    assert.equal(await usage(), before + added, "a version counts its pages once");
    const prefix = `orgs/${org.id}/drafts/${draftId}/versions/`;

    const prune = (token, query) => callApi(stack, token, "DELETE", `/api/drafts/${draftId}/versions${query}`);
    assert.equal((await prune(max, "?keepLatest=1")).status, 403, "a plain member can't prune a teammate's");
    for (const query of ["", "?keepLatest=0", "?keepLatest=-2", "?keepLatest=1.5", "?keepLatest=all"]) {
      assert.equal((await prune(bob, query)).status, 422, query);
    }
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    assert.equal((await prune(olivia, "?keepLatest=1")).status, 404);
    assert.equal((await callApi(stack, bob, "DELETE", "/api/drafts/zzzzzzzzzzzz/versions?keepLatest=1")).status, 404);

    const pruned = await prune(bob, "?keepLatest=2");
    assert.equal(pruned.status, 200, JSON.stringify(pruned.body));
    const freed = receipts[0].totalBytes + receipts[1].totalBytes;
    assert.equal(pruned.body.deleted, 2);
    assert.equal(pruned.body.freedBytes, freed);
    assert.equal(pruned.body.more, false);
    assert.equal(pruned.body.versionCount, 2);
    assert.equal(pruned.body.usage.storedBytes, before + added - freed);
    assert.equal(await usage(), before + added - freed);

    // The old versions' objects and rows are gone; the newer two stay whole.
    const keys = await r2Keys(prefix);
    assert.deepEqual(keys, [2, 3].flatMap((i) => [`${prefix}${receipts[i].versionId}.html`, `${prefix}${receipts[i].versionId}/notes.html`]).sort());
    assert.equal(await count("SELECT COUNT(*) FROM draft_pages WHERE draft_version_id IN (?, ?)", receipts[0].versionId, receipts[1].versionId), 0);
    assert.equal(await count("SELECT COUNT(*) FROM pending_deletions"), 0);
    assert.equal((await read(`${stack.baseUrl}/d/${draftId}/v/1/`, bob)).status, 404);
    assert.equal((await read(`${stack.baseUrl}/d/${draftId}/v/3/notes`, bob)).status, 200);
    assert.equal((await read(`${receipts[3].publicUrl}/`, bob)).status, 200);

    // Nothing more to prune; numbering carries on; an admin may prune too.
    assert.equal((await prune(bob, "?keepLatest=2")).body.deleted, 0);
    assert.equal((await upload(bob, version(5))).body.versionNumber, 5);
    const byAdmin = await prune(alice, "?keepLatest=1");
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
    assert.equal(byAdmin.body.deleted, 2);
    assert.equal(byAdmin.body.versionCount, 1);

    // Deleting the artifact gives back exactly what is left of it.
    assert.equal((await callApi(stack, bob, "DELETE", `/api/drafts/${draftId}`)).status, 200);
    assert.equal(await usage(), before);
  });
});

describe("ops Worker cron", () => {
  test("queued deletions are retried until they succeed", async () => {
    // A queued R2 prefix, as left behind when R2 failed mid-request.
    const prefix = "orgs/org_cron_test/drafts/abcdefabcdef/";
    await putObject(`${prefix}versions/v1.html`, "<p>1</p>");
    await putObject(`${prefix}versions/v1/page.html`, "<p>2</p>");
    const outside = "orgs/org_cron_test/drafts/zzzzzzzzzzzz/versions/v1.html";
    await putObject(outside, "<p>keep</p>");
    await exec("INSERT INTO pending_deletions (kind, target) VALUES ('r2_prefix', ?)", prefix);

    // A queued WorkOS organization deletion while WorkOS is down.
    const org = await workosApi(stack.emulator, "POST", "/organizations", { name: "Cron Doomed" });
    await exec("INSERT INTO pending_deletions (kind, target) VALUES ('workos_org', ?)", org.id);
    const restore = await breakWorkos(stack.emulator, "DELETE", `/organizations/${org.id}`);
    try {
      await runCron();
      await eventually(async () => (await r2Keys(prefix)).length === 0, "R2 prefix purged by the cron", runCron);
      await eventually(
        async () => (await rows("SELECT attempts FROM pending_deletions WHERE kind = 'workos_org'"))[0]?.attempts >= 1,
        "failed WorkOS deletion counted",
        runCron
      );
      const [failed] = await rows("SELECT attempts, last_error FROM pending_deletions WHERE target = ?", org.id);
      assert.match(failed.last_error, /WorkOS 503/);
      // The objects go first, the queue row right after.
      await eventually(
        async () => (await count("SELECT COUNT(*) FROM pending_deletions WHERE target = ?", prefix)) === 0,
        "purged prefix leaves the queue",
        runCron
      );
      assert.deepEqual(await r2Keys("orgs/org_cron_test/drafts/zzzzzzzzzzzz/"), [outside], "only the prefix");
    } finally {
      await restore();
    }

    await runCron();
    await eventually(
      async () => (await count("SELECT COUNT(*) FROM pending_deletions")) === 0,
      "retry succeeds once WorkOS is back",
      runCron
    );
    await assert.rejects(workosApi(stack.emulator, "GET", `/organizations/${org.id}`), /404/);
  });

  test("upload request metadata (IP, user agent) is erased after 30 days", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const fresh = await upload(alice, { html: page("Retention fresh") });
    const old = await upload(alice, { html: page("Retention old") });
    const day = 24 * 60 * 60;
    const nowSeconds = Math.floor(Date.now() / 1000);
    await exec("UPDATE draft_versions SET created_at = ?, source_ip = '203.0.113.9' WHERE id = ?", nowSeconds - 31 * day, old.body.versionId);
    await exec("UPDATE draft_versions SET created_at = ?, source_ip = '203.0.113.8' WHERE id = ?", nowSeconds - 29 * day, fresh.body.versionId);

    await runCron();
    await eventually(
      async () => (await rows("SELECT source_ip FROM draft_versions WHERE id = ?", old.body.versionId))[0].source_ip === null,
      "old metadata erased",
      runCron
    );
    const [oldRow] = await rows("SELECT source_ip, user_agent, content_hash FROM draft_versions WHERE id = ?", old.body.versionId);
    assert.equal(oldRow.user_agent, null);
    assert.ok(oldRow.content_hash, "the version itself stays");
    const [freshRow] = await rows("SELECT source_ip, user_agent FROM draft_versions WHERE id = ?", fresh.body.versionId);
    assert.equal(freshRow.source_ip, "203.0.113.8");
    assert.ok(freshRow.user_agent);
  });
});

describe("workspace deletion", () => {
  let sam; // admin of "Doomed Co"
  let nora; // member of "Doomed Co"
  let workspace;
  let artifacts;

  before(async () => {
    sam = await signInTokens(stack, "sam@new.test");
    const created = await callApi(stack, sam.accessToken, "POST", "/api/workspaces", { name: "Doomed Co" });
    assert.equal(created.status, 201);
    workspace = created.body.workspace;
    sam = await refreshInto(stack, sam, workspace.id);
    const invite = await callApi(stack, sam.accessToken, "POST", "/api/workspaces/invites", {});
    nora = await signInTokens(stack, "nora@new.test");
    assert.equal((await callApi(stack, nora.accessToken, "POST", "/api/workspaces/join", { code: invite.body.code })).status, 200);
    nora = await refreshInto(stack, nora, workspace.id);
    artifacts = [
      (await upload(sam.accessToken, multiPage("Doomed deck"))).body,
      (await upload(nora.accessToken, { html: page("Doomed note") })).body
    ];
    // Both have a cached membership now.
    for (const a of artifacts) assert.equal((await read(viewUrl(a), nora.accessToken)).status, 200);
  });

  test("members cannot delete it; a wrong or missing confirmation is refused with a hint", async () => {
    assert.equal(
      (await callApi(stack, nora.accessToken, "DELETE", "/api/workspaces/current", { confirm: "Doomed Co" })).status,
      403
    );
    for (const body of [{}, { confirm: "doomed co" }, { confirm: "Doomed" }, undefined]) {
      const result = await callApi(stack, sam.accessToken, "DELETE", "/api/workspaces/current", body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.match(result.body.error, /"confirm": "Doomed Co"/);
    }
    assert.equal(await count("SELECT COUNT(*) FROM workspaces WHERE organization_id = ?", workspace.id), 1);
  });

  test("deletes R2, D1 and the WorkOS organization, and blocks access at once", async () => {
    const prefix = `orgs/${workspace.id}/`;
    assert.equal((await r2Keys(prefix)).length, 4);

    const result = await callApi(stack, sam.accessToken, "DELETE", "/api/workspaces/current", { confirm: "Doomed Co" });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, { ok: true, workspace: { id: workspace.id, name: "Doomed Co", handle: workspace.handle } });

    assert.deepEqual(await r2Keys(prefix), []);
    for (const table of ["drafts", "invites", "memberships", "membership_epochs", "revocations", "workspaces"]) {
      assert.equal(await count(`SELECT COUNT(*) FROM ${table} WHERE organization_id = ?`, workspace.id), 0, table);
    }
    for (const a of artifacts) assert.deepEqual(await draftRows(a.draftId), { drafts: 0, versions: 0, pages: 0 });
    assert.equal(await count("SELECT COUNT(*) FROM pending_deletions"), 0);
    await assert.rejects(workosApi(stack.emulator, "GET", `/organizations/${workspace.id}`), /404/);

    // Still-valid tokens issued for the workspace get nothing.
    for (const token of [sam.accessToken, nora.accessToken]) {
      for (const a of artifacts) assert.equal((await read(viewUrl(a), token)).status, 404);
      assert.equal((await callApi(stack, token, "GET", "/api/drafts")).status, 403);
      assert.equal((await upload(token, { html: page("zombie") })).status, 403);
      assert.equal((await callApi(stack, token, "GET", "/api/me")).body.workspace, null);
    }
    assert.equal(await count("SELECT COUNT(*) FROM workspaces WHERE organization_id = ?", workspace.id), 0, "not re-created");
  });

  test("late WorkOS webhooks for the deleted workspace are harmless", async () => {
    const noraUser = await findUser(stack.emulator, "nora@new.test");
    for (const payload of [
      { id: "event_org_gone", event: "organization.deleted", data: {
          object: "organization",
          id: workspace.id,
          name: "Doomed Co",
          domains: [],
          metadata: {},
          external_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      },
      {
        id: "event_member_gone",
        event: "organization_membership.deleted",
        data: { object: "organization_membership", user_id: noraUser.id, organization_id: workspace.id }
      },
      {
        id: "event_member_back",
        event: "organization_membership.created",
        data: { object: "organization_membership", user_id: noraUser.id, organization_id: workspace.id }
      }
    ]) {
      assert.equal((await sendWebhook(stack, payload)).status, 200, payload.event);
    }
    for (const table of ["workspaces", "memberships", "membership_epochs", "revocations"]) {
      assert.equal(await count(`SELECT COUNT(*) FROM ${table} WHERE organization_id = ?`, workspace.id), 0, table);
    }
    // R2 and WorkOS cleanup runs after the webhook answers (waitUntil).
    await eventually(async () => (await count("SELECT COUNT(*) FROM pending_deletions")) === 0, "nothing left queued");
  });

  test("a deleted workspace leaves workspace list at once, while WorkOS still has it; its members stay signed in", async () => {
    const max = await signInTokens(stack, "max@both.test", "Acme");
    const created = await callApi(stack, max.accessToken, "POST", "/api/workspaces", { name: "Lagging Co" });
    assert.equal(created.status, 201);
    const { id } = created.body.workspace;
    const lagging = await refreshInto(stack, max, id);
    const restore = await breakWorkos(stack.emulator, "DELETE", `/organizations/${id}`);
    try {
      const deleted = await callApi(stack, lagging.accessToken, "DELETE", "/api/workspaces/current", { confirm: "Lagging Co" });
      assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
      // WorkOS still lists the membership (its organization delete is queued).
      const memberships = await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?organization_id=${id}`);
      assert.equal(memberships.data.length, 1);
      const listed = await callApi(stack, lagging.accessToken, "GET", "/api/workspaces");
      assert.equal(listed.status, 200);
      assert.deepEqual(listed.body.workspaces.map((w) => w.name).sort(), ["Acme", "Other"]);
      // Signed in, with no workspace: not "Not signed in".
      const me = await callApi(stack, lagging.accessToken, "GET", "/api/me");
      assert.equal(me.status, 200);
      assert.equal(me.body.workspace, null);
    } finally {
      await restore();
    }
    await runCron();
    await eventually(async () => (await count("SELECT COUNT(*) FROM pending_deletions")) === 0, "queued org deletion retried", runCron);
  });

  test("an organization deleted in WorkOS directly takes its workspace with it", async () => {
    let olivia = await signInTokens(stack, "olivia@other.test", "Other");
    const created = await callApi(stack, olivia.accessToken, "POST", "/api/workspaces", { name: "Dashboard Deleted" });
    olivia = await refreshInto(stack, olivia, created.body.workspace.id);
    const art = await upload(olivia.accessToken, { html: page("Short lived") });
    assert.equal(art.status, 201);
    await workosApi(stack.emulator, "DELETE", `/organizations/${created.body.workspace.id}`);
    await eventually(
      async () =>
        (await count("SELECT COUNT(*) FROM drafts WHERE organization_id = ?", created.body.workspace.id)) === 0 &&
        (await r2Keys(`orgs/${created.body.workspace.id}/`)).length === 0,
      "organization.deleted webhook purges the workspace"
    );
    assert.equal((await read(art.body.publicUrl, olivia.accessToken)).status, 404);
    // Its members stay signed in, with no workspace there (R3-6).
    const me = await callApi(stack, olivia.accessToken, "GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.workspace, null);
  });
});

describe("offboarding", () => {
  test("user.deleted scrubs their cached profile and revokes them; their artifacts stay", async () => {
    const max = await accessToken(stack, "max@both.test", "Acme");
    const maxUser = await findUser(stack.emulator, "max@both.test");
    const theirs = await upload(max, { html: page("Max's legacy") });
    assert.equal(theirs.status, 201);
    const [before] = await rows("SELECT name, email FROM accounts WHERE id = ?", maxUser.id);
    assert.equal(before.email, "max@both.test");

    const response = await sendWebhook(stack, {
      id: "event_user_deleted",
      event: "user.deleted",
      data: { object: "user", id: maxUser.id, email: "max@both.test" }
    });
    assert.equal(response.status, 200);

    const [after] = await rows("SELECT name, email, picture_url FROM accounts WHERE id = ?", maxUser.id);
    assert.deepEqual({ ...after }, { name: "Deleted user", email: null, picture_url: null });
    const versions = await rows("SELECT source_ip, user_agent FROM draft_versions WHERE created_by = ?", maxUser.id);
    assert.ok(versions.length > 0);
    assert.ok(versions.every((v) => v.source_ip === null && v.user_agent === null));

    assert.equal((await callApi(stack, max, "GET", "/api/me")).status, 401);
    const [stillMax] = await rows("SELECT email FROM accounts WHERE id = ?", maxUser.id);
    assert.equal(stillMax.email, null, "a request with their old token does not re-cache their profile");

    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    assert.equal((await read(theirs.body.publicUrl, alice)).status, 200);
    const feed = await callApi(stack, alice, "GET", "/api/drafts?scope=workspace");
    assert.equal(feed.body.drafts.find((d) => d.draftId === theirs.body.draftId)?.author, "Deleted user");
  });
});

describe("WorkOS Admin Portal", () => {
  test("admins get a portal link (url only); members and CI keys do not", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const org = await findOrganization(stack.emulator, "Acme");
    for (const intent of ["sso", "dsync", "domain_verification"]) {
      const result = await callApi(stack, alice, "POST", "/api/workspaces/portal", { intent });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(Object.keys(result.body).sort(), ["ok", "url"]);
      assert.equal(result.body.ok, true);
      assert.match(result.body.url, new RegExp(`/portal/${intent}/${org.id}$`));
    }
    assert.equal((await callApi(stack, bob, "POST", "/api/workspaces/portal", { intent: "sso" })).status, 403);
    assert.equal((await callApi(stack, CI_KEY, "POST", "/api/workspaces/portal", { intent: "sso" })).status, 403);
    assert.equal((await callApi(stack, null, "POST", "/api/workspaces/portal", { intent: "sso" })).status, 401);
    for (const intent of ["audit_logs", "", undefined]) {
      assert.equal((await callApi(stack, alice, "POST", "/api/workspaces/portal", { intent })).status, 422, String(intent));
    }
  });
});

describe("review round 4", () => {
  test("SCIM deprovisioning (WorkOS deactivates the membership) ends every kind of access; reactivation restores it", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const bobUser = await findUser(stack.emulator, "bob@acme.test");
    const acme = await findOrganization(stack.emulator, "Acme");
    const membershipsUrl = `/user_management/organization_memberships?user_id=${bobUser.id}&organization_id=${acme.id}`;
    const [membership] = (await workosApi(stack.emulator, "GET", membershipsUrl)).data;
    const bobKey = (
      await workosApi(stack.emulator, "POST", `/user_management/users/${bobUser.id}/api_keys`, { name: "Bob laptop", organization_id: acme.id })
    ).value;
    const status = async (token) => (await callApi(stack, token, "GET", "/api/drafts?scope=workspace")).status;
    const updated = (id) =>
      sendWebhook(stack, {
        id,
        event: "organization_membership.updated",
        data: { object: "organization_membership", id: membership.id, user_id: bobUser.id, organization_id: acme.id }
      });
    const hooks = async () => (await (await fetch(`${stack.emulator.url}/_emulate/hooks`)).json()).filter((h) => h.path === "/portal/revoke_link");
    assert.equal(await status(bob), 200);
    assert.equal(await status(bobKey), 200, "a user-owned API key works while they are a member");

    // What AuthKit Directory Provisioning does when the directory removes someone.
    await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${membership.id}/deactivate`);

    // Even with the webhook lost and the membership cache expired, their own API key stops working.
    await exec("DELETE FROM memberships WHERE user_id = ?", bobUser.id);
    assert.equal(await status(bobKey), 403, "user-owned key follows its user's membership");

    // The webhook ends access and their Admin Portal sessions (revoke_link must succeed, or WorkOS retries).
    const [standIn] = await hooks();
    await fetch(`${stack.emulator.url}/_emulate/hooks/${standIn.id}`, { method: "DELETE" });
    const restore = await breakWorkos(stack.emulator, "POST", "/portal/revoke_link", 503);
    assert.equal((await updated("event_dsync_deactivated_1")).status, 500, "portal revocation failure is retried");
    assert.equal(await status(bob), 403, "access already ended");
    await restore();
    await fetch(`${stack.emulator.url}/_emulate/hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "POST", path: "/portal/revoke_link", status: 200, body: {}, count: 1 })
    });
    assert.equal((await updated("event_dsync_deactivated_2")).status, 200);
    assert.equal((await hooks()).length, 0, "revoke_link was called");
    await fetch(`${stack.emulator.url}/_emulate/hooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "POST", path: "/portal/revoke_link", status: 200, body: {} })
    });
    assert.equal(await status(bob), 403);

    // An old invite cannot undo it (creating a membership would reactivate it).
    const invite = await callApi(stack, alice, "POST", "/api/workspaces/invites", {});
    const join = await callApi(stack, bob, "POST", "/api/workspaces/join", { code: invite.body.code });
    assert.equal(join.status, 403, JSON.stringify(join.body));
    assert.equal((await workosApi(stack.emulator, "GET", `${membershipsUrl}&statuses=inactive`)).data[0]?.status, "inactive");

    // A stale copy of an earlier "updated" changes nothing: the handler re-checks WorkOS.
    assert.equal((await updated("event_dsync_stale")).status, 200);
    assert.equal(await status(bob), 403);

    await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${membership.id}/reactivate`);
    assert.equal((await updated("event_dsync_reactivated")).status, 200);
    assert.equal(await status(bob), 200, "reactivated in the directory: access back");
    assert.equal(await status(bobKey), 200);
  });

  test("a request that passed the revocation check cannot restore a deleted user's profile", async () => {
    const { saveAccount } = await import("../src/db.ts");
    const olivia = await findUser(stack.emulator, "olivia@other.test");
    await saveAccount(proxy.env.DB, { id: olivia.id, name: "Olivia", email: "olivia@other.test" });
    const response = await sendWebhook(stack, {
      id: "event_user_deleted_olivia",
      event: "user.deleted",
      data: { object: "user", id: olivia.id, email: "olivia@other.test" }
    });
    assert.equal(response.status, 200);
    // The paused request resumes and writes the profile it read before the webhook.
    await saveAccount(proxy.env.DB, { id: olivia.id, name: "Olivia", email: "olivia@other.test" });
    const [after] = await rows("SELECT name, email FROM accounts WHERE id = ?", olivia.id);
    assert.deepEqual({ ...after }, { name: "Deleted user", email: null });
  });

  test("an uncommitted upload's objects are queued, so a failed cleanup is retried by the cron", async () => {
    const { queueDeletion, versionPrefix } = await import("../src/purge.ts");
    const kept = "orgs/org_x/drafts/d1/versions/KEEPKEEPKEEPKEEPKEEP.html";
    const prefix = versionPrefix("org_x", "d1", "LOSTLOSTLOSTLOSTLOST");
    for (const key of [`${prefix}.html`, `${prefix}/about.html`, kept]) await putObject(key, "<p>secret</p>");
    // What discard() does when the immediate delete fails: the queued row stays.
    await queueDeletion(proxy.env.DB, "r2_prefix", prefix).run();
    assert.throws(() => queueDeletion(proxy.env.DB, "r2_prefix", "orgs/org_x/drafts/d1/versions/short"));
    await runCron();
    await eventually(async () => (await r2Keys("orgs/org_x/")).length === 1, "upload's objects purged by the cron", runCron);
    assert.deepEqual(await r2Keys("orgs/org_x/"), [kept]);
    await eventually(async () => (await count("SELECT COUNT(*) FROM pending_deletions WHERE target = ?", prefix)) === 0, "queue row cleared", runCron);
    await deleteObject(kept);
  });
});

describe("review round 8", () => {
  const hooksUrl = () => `${stack.emulator.url}/_emulate/hooks`;
  const addHook = (hook) =>
    fetch(hooksUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(hook) });
  // Counts calls to the Admin Portal revocation endpoint while `fn` runs.
  async function revokeCalls(fn) {
    const hooks = async () => (await (await fetch(hooksUrl())).json()).filter((h) => h.path === "/portal/revoke_link");
    for (const hook of await hooks()) await fetch(`${hooksUrl()}/${hook.id}`, { method: "DELETE" });
    await addHook({ method: "POST", path: "/portal/revoke_link", status: 200, body: {}, count: 1000 });
    try {
      await fn();
      const [left] = await hooks();
      return 1000 - (left?.count ?? 0);
    } finally {
      for (const hook of await hooks()) await fetch(`${hooksUrl()}/${hook.id}`, { method: "DELETE" });
      await addHook({ method: "POST", path: "/portal/revoke_link", status: 200, body: {} });
    }
  }
  const membershipEvent = (id, event, membership) =>
    sendWebhook(stack, {
      id,
      event,
      data: { object: "organization_membership", id: membership.id, user_id: membership.user_id, organization_id: membership.organization_id }
    }).then((r) => assert.equal(r.status, 200));

  test("removing someone revokes the invite codes issued up to then; codes issued later still work", async () => {
    const nora = await signInTokens(stack, "nora@new.test");
    const created = await callApi(stack, nora.accessToken, "POST", "/api/workspaces", { name: "Rejoin Labs" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const noraAdmin = (await refreshInto(stack, nora, created.body.workspace.id)).accessToken;
    const invite = await callApi(stack, noraAdmin, "POST", "/api/workspaces/invites", {});
    const sam = await signInTokens(stack, "sam@new.test");
    assert.equal((await callApi(stack, sam.accessToken, "POST", "/api/workspaces/join", { code: invite.body.code })).status, 200);
    const samUser = await findUser(stack.emulator, "sam@new.test");
    assert.equal((await callApi(stack, noraAdmin, "DELETE", `/api/workspaces/members/${samUser.id}`)).status, 200);

    const rejoin = await callApi(stack, sam.accessToken, "POST", "/api/workspaces/join", { code: invite.body.code });
    assert.equal(rejoin.status, 404, "the old code is revoked");

    // The WorkOS webhook for that removal arriving late (or again) only revokes codes issued up to the removal.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const fresh = await callApi(stack, noraAdmin, "POST", "/api/workspaces/invites", {});
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const late = await sendWebhook(stack, {
      id: "event_late_removal",
      event: "organization_membership.deleted",
      created_at: new Date(Date.now() - 1100).toISOString(),
      data: { object: "organization_membership", id: "om_gone", user_id: samUser.id, organization_id: org.id }
    });
    assert.equal(late.status, 200);
    assert.equal((await callApi(stack, sam.accessToken, "POST", "/api/workspaces/join", { code: fresh.body.code })).status, 200);
  });

  test("a membership deleted in WorkOS (e.g. directory deprovisioning) revokes old codes; an update to a live one does not", async () => {
    const nora = await signInTokens(stack, "nora@new.test", "Rejoin Labs");
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const olivia = await findUser(stack.emulator, "olivia@other.test");
    // The emulator creates memberships active; pending ones are treated the same (src/webhooks.ts).
    const pending = await workosApi(stack.emulator, "POST", "/user_management/organization_memberships", {
      user_id: olivia.id,
      organization_id: org.id
    });
    const codeWorks = async (code) =>
      (await rows("SELECT revoked_at FROM invites WHERE code = ?", code))[0]?.revoked_at === null;
    const invite = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", {});
    await membershipEvent("event_pending_updated", "organization_membership.updated", pending);
    assert.ok(await codeWorks(invite.body.code), "a live (active or pending) membership revokes nothing");

    await workosApi(stack.emulator, "DELETE", `/user_management/organization_memberships/${pending.id}`);
    await membershipEvent("event_pending_deleted", "organization_membership.deleted", pending);
    assert.ok(!(await codeWorks(invite.body.code)), "deprovisioned: old codes revoked");
  });

  test("a demoted admin loses Admin Portal sessions; a demotion not yet seen by the cache is caught when minting a link", async () => {
    const nora = await accessToken(stack, "nora@new.test", "Rejoin Labs");
    const noraUser = await findUser(stack.emulator, "nora@new.test");
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const [membership] = (
      await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${noraUser.id}&organization_id=${org.id}`)
    ).data;
    assert.equal((await callApi(stack, nora, "POST", "/api/workspaces/portal", { intent: "sso" })).status, 200);

    // Demoted in WorkOS, webhook not yet delivered: the cached role still says admin.
    await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${membership.id}`, { role_slug: "member" });
    const minted = await revokeCalls(async () => {
      assert.equal((await callApi(stack, nora, "POST", "/api/workspaces/portal", { intent: "sso" })).status, 403);
    });
    // (The emulator's own webhook for the demotion may add a revocation.)
    assert.ok(minted >= 1, "the link minted across the demotion was revoked");

    const demoted = await revokeCalls(() => membershipEvent("event_demoted", "organization_membership.updated", membership));
    assert.ok(demoted >= 1, "demotion revokes their portal sessions");
    assert.equal((await callApi(stack, nora, "POST", "/api/workspaces/portal", { intent: "sso" })).status, 403);
  });
});

describe("review round 10", () => {
  before(async () => {
    // Round 8 demoted Nora; make her Rejoin Labs' admin again.
    const nora = await findUser(stack.emulator, "nora@new.test");
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const [membership] = (
      await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${nora.id}&organization_id=${org.id}`)
    ).data;
    await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${membership.id}`, { role_slug: "admin" });
    await exec("DELETE FROM memberships WHERE user_id = ?", nora.id);
  });
  const liveCodes = async (token) => (await callApi(stack, token, "GET", "/api/workspaces/invites")).body.invites.map((i) => i.code);

  test("a membership deleted outside our app revokes old codes even if the person already rejoined", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const old = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    // WorkOS delivers the deletion late; meanwhile the membership looks live again.
    const late = await sendWebhook(stack, {
      id: "event_deleted_outside",
      event: "organization_membership.deleted",
      created_at: new Date(Date.now() + 1000).toISOString(),
      data: { object: "organization_membership", id: "om_outside", user_id: "user_someone_removed", organization_id: org.id }
    });
    assert.equal(late.status, 200);
    assert.ok(!(await liveCodes(nora)).includes(old), "revoked without consulting live state");
  });

  test("re-syncs of a deactivated membership never revoke codes issued after it", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const sam = await findUser(stack.emulator, "sam@new.test");
    const [membership] = (
      await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${sam.id}&organization_id=${org.id}`)
    ).data;
    await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${membership.id}/deactivate`);
    const fresh = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    for (const id of ["event_resync_1", "event_resync_2"]) {
      const r = await sendWebhook(stack, {
        id,
        event: "organization_membership.updated",
        data: { object: "organization_membership", id: membership.id, user_id: sam.id, organization_id: org.id, status: "inactive" }
      });
      assert.equal(r.status, 200);
    }
    assert.ok((await liveCodes(nora)).includes(fresh));
    const samToken = (await signInTokens(stack, "sam@new.test")).accessToken;
    assert.equal((await callApi(stack, samToken, "POST", "/api/workspaces/join", { code: fresh })).status, 403, "inactive: refused");
  });

  test("admins list and revoke invite codes; members cannot", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const a = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    const b = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    assert.ok((await liveCodes(nora)).includes(a));
    assert.equal((await callApi(stack, nora, "DELETE", `/api/workspaces/invites/${a}`)).status, 200);
    assert.equal((await callApi(stack, nora, "DELETE", `/api/workspaces/invites/${a}`)).status, 404, "already revoked");
    const codes = await liveCodes(nora);
    assert.ok(!codes.includes(a) && codes.includes(b));
    const bob = await accessToken(stack, "alice@acme.test", "Acme");
    assert.equal((await callApi(stack, bob, "DELETE", `/api/workspaces/invites/${b}`)).status, 404, "another workspace's admin");
    assert.equal((await callApi(stack, nora, "DELETE", "/api/workspaces/invites/all")).status, 200);
    assert.deepEqual(await liveCodes(nora), []);
  });

  test("a user deleted in WorkOS revokes the codes of the workspaces they were in", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const code = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    const sam = await findUser(stack.emulator, "sam@new.test");
    const r = await sendWebhook(stack, {
      id: "event_sam_deleted",
      event: "user.deleted",
      created_at: new Date(Date.now() + 1000).toISOString(),
      data: { object: "user", id: sam.id, email: "sam@new.test" }
    });
    assert.equal(r.status, 200);
    assert.ok(!(await liveCodes(nora)).includes(code));
  });
});

describe("review round 11", () => {
  test("removed outside our app and back in (old code) before the webhook: the late removal undoes the rejoin, durably", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const bobUser = await findUser(stack.emulator, "bob@acme.test");
    const old = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    // Bob had been removed in the WorkOS dashboard (membership om_dashboard), and rejoins
    // with a code he already had before that removal's webhook arrives.
    const bob = await signInTokens(stack, "bob@acme.test", "Acme");
    assert.equal((await callApi(stack, bob.accessToken, "POST", "/api/workspaces/join", { code: old })).status, 200);
    const bobIn = (await refreshInto(stack, bob, org.id)).accessToken;
    assert.equal((await callApi(stack, bobIn, "GET", "/api/drafts?scope=workspace")).status, 200);
    const [rejoined] = (
      await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${bobUser.id}&organization_id=${org.id}`)
    ).data;

    // WorkOS is failing deletes: the undo is queued, and grants nothing meanwhile.
    const restore = await breakWorkos(stack.emulator, "DELETE", `/user_management/organization_memberships/${rejoined.id}`);
    try {
      const late = await sendWebhook(stack, {
        id: "event_dashboard_removal",
        event: "organization_membership.deleted",
        created_at: new Date(Date.now() + 1000).toISOString(),
        data: { object: "organization_membership", id: "om_dashboard", user_id: bobUser.id, organization_id: org.id }
      });
      assert.equal(late.status, 200);
      assert.equal((await callApi(stack, bobIn, "GET", "/api/drafts?scope=workspace")).status, 403, "access ended at once");
      assert.equal(await count("SELECT COUNT(*) FROM pending_deletions WHERE kind = 'workos_membership' AND target = ?", rejoined.id), 1);
    } finally {
      await restore();
    }
    await runCron();
    await eventually(
      async () => (await count("SELECT COUNT(*) FROM pending_deletions WHERE target = ?", rejoined.id)) === 0,
      "the cron deletes the membership once WorkOS is back",
      runCron
    );
    assert.equal(
      (await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${bobUser.id}&organization_id=${org.id}`)).data.length,
      0
    );

    // The undo's own deletion event (e.g. redelivered) revokes nothing issued since.
    const fresh = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    const own = await sendWebhook(stack, {
      id: "event_undo_own",
      event: "organization_membership.deleted",
      created_at: new Date(Date.now() + 2000).toISOString(),
      data: { object: "organization_membership", id: rejoined.id, user_id: bobUser.id, organization_id: org.id }
    });
    assert.equal(own.status, 200);
    const live = (await callApi(stack, nora, "GET", "/api/workspaces/invites")).body.invites.map((i) => i.code);
    assert.ok(live.includes(fresh));
  });

  test("invite codes typed without the HA- prefix parse even when the random part starts with HA; revoke ALL works", async () => {
    const { normalizeInviteCode } = await import("../src/ids.ts");
    assert.equal(normalizeInviteCode("haxy-z234-5678"), "HA-HAXY-Z234-5678");
    assert.equal(normalizeInviteCode("HA-HAXY-Z234-5678"), "HA-HAXY-Z234-5678");
    assert.equal(normalizeInviteCode("ha 7kq2 mx9p 4tra"), "HA-7KQ2-MX9P-4TRA");
    assert.equal(normalizeInviteCode("7KQ2MX9P4TRA"), "HA-7KQ2-MX9P-4TRA");
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    await callApi(stack, nora, "POST", "/api/workspaces/invites", {});
    assert.equal((await callApi(stack, nora, "DELETE", "/api/workspaces/invites/ALL")).status, 200);
    assert.deepEqual((await callApi(stack, nora, "GET", "/api/workspaces/invites")).body.invites, []);
  });
});

describe("review round 12", () => {
  test("admins update any artifact; a new org CI key updates an old key's artifact; members can't update a teammate's", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const acme = await findOrganization(stack.emulator, "Acme");
    const bobs = await upload(bob, { html: page("Bob's report"), slug: "bob-report" });
    assert.equal(bobs.status, 201, JSON.stringify(bobs.body));
    assert.deepEqual(bobs.body.warnings, [], "no warning on your own artifact");
    const byAdmin = await upload(alice, { html: page("Bob's report, fixed by an admin"), slug: "bob-report" });
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
    assert.equal(byAdmin.body.draftId, bobs.body.draftId);
    // The receipt says whose it is; the list says who updated it last.
    assert.ok(byAdmin.body.warnings.some((w) => /This artifact is Bob's: you published version 2 over their work/.test(w)), JSON.stringify(byAdmin.body.warnings));
    const feed = (await callApi(stack, alice, "GET", "/api/drafts?scope=workspace")).body.drafts;
    const listed = feed.find((d) => d.draftId === bobs.body.draftId);
    assert.equal(listed.author, "Bob");
    assert.equal(listed.updatedBy, "Alice");

    const alices = await upload(alice, { html: page("Alice's plan"), slug: "alice-plan" });
    assert.equal((await callApi(stack, alice, "GET", "/api/drafts")).body.drafts.find((d) => d.draftId === alices.body.draftId).updatedBy, "Alice");
    // Like delete: a teammate's artifact is 403 (with why), not a conflict.
    const byMember = await upload(bob, { html: page("Bob overwriting"), slug: "alice-plan" });
    assert.equal(byMember.status, 403);
    assert.match(byMember.body.error, /belongs to a teammate's artifact; only they or a workspace admin can update it/);
    const byId = await upload(bob, { html: page("Bob overwriting"), draftId: alices.body.draftId });
    assert.equal(byId.status, 403);
    assert.match(byId.body.error, /belongs to a teammate/);

    const ci = await upload(CI_KEY, { html: page("Nightly"), slug: "nightly" });
    assert.equal(ci.status, 201, JSON.stringify(ci.body));
    const rotated = (await workosApi(stack.emulator, "POST", `/organizations/${acme.id}/api_keys`, { name: "Acme CI 2" })).value;
    const byNewKey = await upload(rotated, { html: page("Nightly, new key"), slug: "nightly" });
    assert.equal(byNewKey.status, 200, JSON.stringify(byNewKey.body));
    assert.equal(byNewKey.body.draftId, ci.body.draftId);
    assert.equal((await upload(rotated, { html: page("Key over Bob"), slug: "bob-report" })).status, 403, "keys can't take over people's artifacts");
  });

  test("a valid fresh code reclaims a membership whose undo is still queued", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const org = await findOrganization(stack.emulator, "Rejoin Labs");
    const bobUser = await findUser(stack.emulator, "bob@acme.test");
    const old = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    const bob = await signInTokens(stack, "bob@acme.test", "Acme");
    assert.equal((await callApi(stack, bob.accessToken, "POST", "/api/workspaces/join", { code: old })).status, 200);
    const bobIn = (await refreshInto(stack, bob, org.id)).accessToken;
    const [membership] = (
      await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${bobUser.id}&organization_id=${org.id}`)
    ).data;
    const restore = await breakWorkos(stack.emulator, "DELETE", `/user_management/organization_memberships/${membership.id}`);
    try {
      await sendWebhook(stack, {
        id: "event_dashboard_removal_2",
        event: "organization_membership.deleted",
        created_at: new Date(Date.now() + 1000).toISOString(),
        data: { object: "organization_membership", id: "om_dashboard_2", user_id: bobUser.id, organization_id: org.id }
      }).then((r) => assert.equal(r.status, 200));
      assert.equal((await callApi(stack, bobIn, "GET", "/api/drafts?scope=workspace")).status, 403);

      // The admin lets Bob back in with a fresh code while WorkOS is still failing deletes.
      await new Promise((resolve) => setTimeout(resolve, 2100));
      const fresh = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
      const join = await callApi(stack, bob.accessToken, "POST", "/api/workspaces/join", { code: fresh });
      assert.equal(join.status, 200, JSON.stringify(join.body));
      assert.equal(await count("SELECT COUNT(*) FROM pending_deletions WHERE target = ?", membership.id), 0, "queued delete cancelled");
      assert.equal((await callApi(stack, bobIn, "GET", "/api/drafts?scope=workspace")).status, 200);
    } finally {
      await restore();
    }
    await runCron();
    assert.equal((await callApi(stack, bobIn, "GET", "/api/drafts?scope=workspace")).status, 200, "the cron no longer removes him");
  });

  test("user.deleted leaves alone workspaces they were removed from earlier", async () => {
    const nora = (await signInTokens(stack, "nora@new.test", "Rejoin Labs")).accessToken;
    const bobUser = await findUser(stack.emulator, "bob@acme.test");
    // Bob (in Rejoin Labs through a join) is removed by the admin; later a standing team code is made.
    assert.equal((await callApi(stack, nora, "DELETE", `/api/workspaces/members/${bobUser.id}`)).status, 200);
    await eventually(
      async () => (await count("SELECT COUNT(*) FROM joins WHERE user_id = ? AND undone = 0", bobUser.id)) === 0,
      "the removal's webhook forgets his join"
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const standing = (await callApi(stack, nora, "POST", "/api/workspaces/invites", {})).body.code;
    const r = await sendWebhook(stack, {
      id: "event_bob_deleted",
      event: "user.deleted",
      created_at: new Date().toISOString(),
      data: { object: "user", id: bobUser.id, email: "bob@acme.test" }
    });
    assert.equal(r.status, 200);
    const live = (await callApi(stack, nora, "GET", "/api/workspaces/invites")).body.invites.map((i) => i.code);
    assert.ok(live.includes(standing));
    assert.equal(await count("SELECT COUNT(*) FROM joins WHERE user_id = ?", bobUser.id), 0, "their join rows are gone");
  });
});

describe(`artifact storage (${STORAGE})`, () => {
  test("uploads that lose a race leave no stored objects; deleting removes every chunk of every version", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const first = await upload(alice, { html: page("Race v1"), slug: "race-storage" });
    assert.equal(first.status, 201);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => upload(alice, { html: page(`Race contender ${i}`, `<p>${"x".repeat(1_020_000)}</p>`), slug: "race-storage" }))
    );
    const won = results.filter((r) => r.status === 200).length;
    assert.ok(won >= 1, results.map((r) => r.status).join(","));
    const acme = await findOrganization(stack.emulator, "Acme");
    const prefix = `orgs/${acme.id}/drafts/${first.body.draftId}/`;
    const versions = await count("SELECT COUNT(*) FROM draft_versions WHERE draft_id = ?", first.body.draftId);
    await eventually(async () => (await r2Keys(prefix)).length === versions, "exactly one object per committed version");
    if (STORAGE === "d1") {
      // ~1.02 MB pages (under the 1 MiB D1 limit) span two 1 MB chunks.
      assert.ok((await count("SELECT COUNT(*) FROM blobs WHERE key >= ? AND key < ?", prefix, `${prefix}~`)) > versions);
    }
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${first.body.draftId}`)).status, 200);
    assert.deepEqual(await r2Keys(prefix), []);
    assert.equal(await count("SELECT COUNT(*) FROM blobs WHERE key >= ? AND key < ?", prefix, `${prefix}~`), 0);
  });
});

describe("D1 Free quotas", () => {
  // proxy.env.DB, recording each statement it runs and failing past `limit`
  // queries, as D1 Free does past 50 in one Worker invocation.
  function meteredDb(db, limit = 50) {
    const queries = [];
    const statement = (inner, sql) =>
      new Proxy(inner, {
        get(target, key) {
          if (key === "bind") return (...args) => statement(target.bind(...args), sql);
          if (["run", "all", "first", "raw"].includes(key)) {
            return (...args) => {
              queries.push(sql);
              if (queries.length > limit) return Promise.reject(new Error("Too many API requests by single worker invocation."));
              return target[key](...args);
            };
          }
          const value = target[key];
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    const wrapped = new Proxy(db, {
      get(target, key) {
        if (key === "prepare") return (sql) => statement(target.prepare(sql), sql);
        if (key === "batch") throw new Error("unexpected batch in the cron");
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    return { db: wrapped, queries };
  }

  test("a deletion backlog stays within 50 queries per cron run and never skips retention; retention uses its index", async () => {
    const { ensureSchema } = await import("../src/db.ts");
    const { queueDeletion, runScheduledJobs } = await import("../src/purge.ts");
    await ensureSchema(proxy.env.DB);
    const day = 24 * 60 * 60;
    const versionId = "QUOTAQUOTAQUOTAQUOTA";
    await exec(
      `INSERT INTO draft_versions (id, draft_id, version_number, object_key, content_hash, file_size, created_by, source_ip, user_agent, created_at)
       VALUES (?, 'quota-draft', 1, 'orgs/org_quota/drafts/quota-draft/versions/x.html', 'h', 1, 'user_quota', '203.0.113.7', 'curl', ?)`,
      versionId,
      Math.floor(Date.now() / 1000) - 31 * day
    );
    // 100 queued deletions: what a burst of artifact deletions with storage down leaves.
    for (let i = 0; i < 100; i += 1) await queueDeletion(proxy.env.DB, "r2_prefix", `orgs/org_backlog_${i}/`).run();
    const backlog = () => count("SELECT COUNT(*) FROM pending_deletions WHERE target LIKE 'orgs/org_backlog_%'");
    try {
      const metered = meteredDb(proxy.env.DB);
      const result = await runScheduledJobs({ DB: metered.db, ARTIFACTS: proxy.env.ARTIFACTS });
      assert.ok(metered.queries.length <= 50, `${metered.queries.length} queries`);
      // An R2 job also reserves its list (Class A) and gives back the bytes it frees.
      const perRun = STORAGE === "r2" ? 10 : 20;
      assert.deepEqual(result.deletions, { done: perRun, failed: 0 }, `one run takes ${perRun} jobs`);
      assert.ok(result.erased >= 1, "retention ran");
      assert.equal(await backlog(), 100 - perRun, "the rest waits for the next runs");
      const [row] = await rows("SELECT source_ip, user_agent FROM draft_versions WHERE id = ?", versionId);
      assert.deepEqual({ ...row }, { source_ip: null, user_agent: null });

      // The retention statement the cron ran searches the partial index
      // (only versions still holding metadata), not the whole table.
      const retention = metered.queries.find((sql) => sql.startsWith("UPDATE draft_versions SET source_ip = NULL"));
      assert.ok(retention, metered.queries.join("\n"));
      const plan = (await rows(`EXPLAIN QUERY PLAN ${retention}`, 0)).map((r) => r.detail).join("\n");
      assert.match(plan, /SEARCH draft_versions USING INDEX draft_versions_retention_idx \(created_at<\?\)/, plan);
      assert.doesNotMatch(plan, /SCAN draft_versions/, plan);
    } finally {
      await exec("DELETE FROM pending_deletions WHERE target LIKE 'orgs/org_backlog_%'");
      await exec("DELETE FROM draft_versions WHERE id = ?", versionId);
    }
  });

  test("a signed-in page view does not rewrite an unchanged cached profile", async () => {
    const browser = new Browser(stack);
    await browser.signIn("alice@acme.test", { workspace: "Acme" });
    const alice = await findUser(stack.emulator, "alice@acme.test");
    const [profile] = await rows("SELECT name, email, picture_url FROM accounts WHERE id = ?", alice.id);
    const marker = Math.floor(Date.now() / 1000) - 60; // fresh (under an hour), and not "now"
    await exec("UPDATE accounts SET updated_at = ? WHERE id = ?", marker, alice.id);
    for (let i = 0; i < 3; i += 1) assert.equal((await browser.get("/docs")).status, 200);
    const [unchanged] = await rows("SELECT name, email, picture_url, updated_at FROM accounts WHERE id = ?", alice.id);
    assert.deepEqual({ ...unchanged }, { ...profile, updated_at: marker }, "no write for an unchanged profile");

    // A changed profile (here: a stale cached name) is still written at once.
    await exec("UPDATE accounts SET name = 'Stale name', updated_at = ? WHERE id = ?", marker, alice.id);
    assert.equal((await browser.get("/docs")).status, 200);
    const [rewritten] = await rows("SELECT name, updated_at FROM accounts WHERE id = ?", alice.id);
    assert.equal(rewritten.name, profile.name);
    assert.ok(rewritten.updated_at > marker);
  });
});
