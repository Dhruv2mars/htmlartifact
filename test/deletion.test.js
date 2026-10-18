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
  stack = await startStack({ directoryProvisioning: true });
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
// The app, the ops Worker and this proxy share one local SQLite file; a read
// racing a writer occasionally loses the lock. Retry only that transient error.
async function rows(sql, ...binds) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await proxy.env.DB.prepare(sql).bind(...binds).all()).results;
    } catch (error) {
      if (attempt >= 5 || !String(error?.message).includes("session commit token")) throw error;
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
    await proxy.env.DB.prepare("DELETE FROM memberships WHERE user_id = ?").bind(bobUser.id).run();
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
    for (const key of [`${prefix}.html`, `${prefix}/about.html`, kept]) await proxy.env.ARTIFACTS.put(key, "<p>secret</p>");
    // What discard() does when the immediate delete fails: the queued row stays.
    await queueDeletion(proxy.env.DB, "r2_prefix", prefix).run();
    assert.throws(() => queueDeletion(proxy.env.DB, "r2_prefix", "orgs/org_x/drafts/d1/versions/short"));
    await runCron();
    await eventually(async () => (await r2Keys("orgs/org_x/")).length === 1, "upload's objects purged by the cron");
    assert.deepEqual(await r2Keys("orgs/org_x/"), [kept]);
    assert.equal(await count("SELECT COUNT(*) FROM pending_deletions WHERE target = ?", prefix), 0);
    await proxy.env.ARTIFACTS.delete(kept);
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
    assert.equal(minted, 1, "the link minted across the demotion was revoked");

    const demoted = await revokeCalls(() => membershipEvent("event_demoted", "organization_membership.updated", membership));
    assert.equal(demoted, 1, "demotion revokes their portal sessions");
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
    await proxy.env.DB.prepare("DELETE FROM memberships WHERE user_id = ?").bind(nora.id).run();
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
