import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getPlatformProxy, unstable_dev } from "wrangler";
import {
  CI_KEY,
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
  stack = await startStack();
  const state = path.join(stack.tmp, "state");
  proxy = await getPlatformProxy({
    configPath: new URL("../wrangler.toml", import.meta.url).pathname,
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
const r2Keys = async (prefix) => (await proxy.env.ARTIFACTS.list({ prefix })).objects.map((o) => o.key).sort();
const rows = async (sql, ...binds) => (await proxy.env.DB.prepare(sql).bind(...binds).all()).results;
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

async function eventually(check, message) {
  for (let i = 0; i < 50; i += 1) {
    if (await check()) return;
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

  test("a plain member cannot delete a teammate's artifact (404, same as missing); an admin can", async () => {
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const max = await accessToken(stack, "max@both.test", "Acme");
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const org = await findOrganization(stack.emulator, "Acme");
    const bobs = await upload(bob, { html: page("Bob's notes") });
    assert.equal(bobs.status, 201);
    const prefix = `orgs/${org.id}/drafts/${bobs.body.draftId}/`;

    const denied = await callApi(stack, max, "DELETE", `/api/drafts/${bobs.body.draftId}`);
    const missing = await callApi(stack, max, "DELETE", "/api/drafts/zzzzzzzzzzzz");
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, missing.body);
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
});

describe("ops Worker cron", () => {
  test("queued deletions are retried until they succeed", async () => {
    // A queued R2 prefix, as left behind when R2 failed mid-request.
    const prefix = "orgs/org_cron_test/drafts/abcdefabcdef/";
    await proxy.env.ARTIFACTS.put(`${prefix}versions/v1.html`, "<p>1</p>");
    await proxy.env.ARTIFACTS.put(`${prefix}versions/v1/page.html`, "<p>2</p>");
    const outside = "orgs/org_cron_test/drafts/zzzzzzzzzzzz/versions/v1.html";
    await proxy.env.ARTIFACTS.put(outside, "<p>keep</p>");
    await proxy.env.DB.prepare("INSERT INTO pending_deletions (kind, target) VALUES ('r2_prefix', ?)").bind(prefix).run();

    // A queued WorkOS organization deletion while WorkOS is down.
    const org = await workosApi(stack.emulator, "POST", "/organizations", { name: "Cron Doomed" });
    await proxy.env.DB.prepare("INSERT INTO pending_deletions (kind, target) VALUES ('workos_org', ?)").bind(org.id).run();
    const restore = await breakWorkos(stack.emulator, "DELETE", `/organizations/${org.id}`);
    try {
      await runCron();
      await eventually(async () => (await r2Keys(prefix)).length === 0, "R2 prefix purged by the cron");
      await eventually(
        async () => (await rows("SELECT attempts FROM pending_deletions WHERE kind = 'workos_org'"))[0]?.attempts === 1,
        "failed WorkOS deletion counted"
      );
      const [failed] = await rows("SELECT attempts, last_error FROM pending_deletions WHERE target = ?", org.id);
      assert.match(failed.last_error, /WorkOS 503/);
      assert.equal(await count("SELECT COUNT(*) FROM pending_deletions WHERE target = ?", prefix), 0);
      assert.deepEqual(await r2Keys("orgs/org_cron_test/drafts/zzzzzzzzzzzz/"), [outside], "only the prefix");
    } finally {
      await restore();
    }

    await runCron();
    await eventually(
      async () => (await count("SELECT COUNT(*) FROM pending_deletions")) === 0,
      "retry succeeds once WorkOS is back"
    );
    await assert.rejects(workosApi(stack.emulator, "GET", `/organizations/${org.id}`), /404/);
  });

  test("upload request metadata (IP, user agent) is erased after 30 days", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const fresh = await upload(alice, { html: page("Retention fresh") });
    const old = await upload(alice, { html: page("Retention old") });
    const day = 24 * 60 * 60;
    const nowSeconds = Math.floor(Date.now() / 1000);
    await proxy.env.DB.prepare("UPDATE draft_versions SET created_at = ?, source_ip = '203.0.113.9' WHERE id = ?")
      .bind(nowSeconds - 31 * day, old.body.versionId)
      .run();
    await proxy.env.DB.prepare("UPDATE draft_versions SET created_at = ?, source_ip = '203.0.113.8' WHERE id = ?")
      .bind(nowSeconds - 29 * day, fresh.body.versionId)
      .run();

    await runCron();
    await eventually(
      async () => (await rows("SELECT source_ip FROM draft_versions WHERE id = ?", old.body.versionId))[0].source_ip === null,
      "old metadata erased"
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
    assert.equal(await count("SELECT COUNT(*) FROM pending_deletions"), 0);
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
