import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import { getPlatformProxy } from "wrangler";
import { reconcileStatements } from "../scripts/restore-reconcile.ts";
import { STORAGE, accessToken, callApi, page, refreshInto, retryLocked, signInTokens, startStack, testConfigPath } from "./helpers.js";

// A D1 Time Travel restore (SECURITY.md: Backups and restore) brings back the
// database as it was at the bookmark: keys and invites revoked since are live
// again, deleted artifacts and workspaces are back. scripts/restore-reconcile.ts
// re-applies all of it from the export taken just before restoring. Here the
// restore is simulated by writing a snapshot back into the local database.
// D1 storage only (production's): a D1 restore does not bring back R2 objects.
describe("restore reconciliation", { skip: STORAGE !== "d1" && "D1 storage only" }, () => {
  let stack;
  let proxy;
  before(async () => {
    stack = await startStack();
    assert.equal((await fetch(`${stack.baseUrl}/healthz`)).status, 200);
    proxy = await getPlatformProxy({ configPath: testConfigPath(), persist: { path: path.join(stack.tmp, "state", "v3") } });
    await all("SELECT 1 FROM drafts LIMIT 1");
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  const all = (sql) => retryLocked(async () => (await proxy.env.DB.prepare(sql).all()).results);
  const batch = (statements) => retryLocked(() => proxy.env.DB.batch(statements));

  // Every table, as `wrangler d1 export` would capture it.
  async function snapshot() {
    const tables = await all("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
    const data = {};
    for (const { name } of tables) data[name] = await all(`SELECT * FROM "${name}"`);
    const db = new DatabaseSync(":memory:");
    for (const { name, sql } of tables) {
      db.exec(sql);
      for (const row of data[name]) {
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO "${name}" (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
          ...columns.map((c) => (row[c] instanceof ArrayBuffer ? new Uint8Array(row[c]) : row[c]))
        );
      }
    }
    return { data, query: (sql) => db.prepare(sql).all() };
  }

  // The restore: every table back to the snapshot.
  async function restore({ data }) {
    const statements = [];
    for (const [name, rows] of Object.entries(data)) {
      statements.push(proxy.env.DB.prepare(`DELETE FROM "${name}"`));
      for (const row of rows) {
        const columns = Object.keys(row);
        statements.push(
          proxy.env.DB.prepare(`INSERT INTO "${name}" (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).bind(
            ...columns.map((c) => row[c])
          )
        );
      }
    }
    await batch(statements);
  }

  test("revoked keys and invites stay revoked, deleted artifacts and workspaces stay deleted", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const key = (await callApi(stack, alice, "POST", "/api/workspaces/api-keys", { name: "Restored CI" })).body;
    assert.ok(key.token);
    const invite = (await callApi(stack, alice, "POST", "/api/workspaces/invites", {})).body;
    assert.ok(invite.code);
    const doomed = (await callApi(stack, alice, "POST", "/api/uploads", { html: page("Doomed") })).body;
    const kept = (await callApi(stack, alice, "POST", "/api/uploads", { html: page("Kept") })).body;
    let max = await signInTokens(stack, "max@both.test", "Acme");
    const workspace = (await callApi(stack, max.accessToken, "POST", "/api/workspaces", { name: "Restored Co" })).body.workspace;
    max = await refreshInto(stack, max, workspace.id);
    assert.equal((await callApi(stack, max.accessToken, "POST", "/api/uploads", { html: page("Restored Co plan") })).status, 201);

    const bookmark = await snapshot();

    assert.equal((await callApi(stack, alice, "DELETE", `/api/workspaces/api-keys/${key.key.id}`)).status, 200);
    assert.equal((await callApi(stack, alice, "DELETE", `/api/workspaces/invites/${invite.code}`)).status, 200);
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${doomed.draftId}`)).status, 200);
    assert.equal((await callApi(stack, max.accessToken, "DELETE", "/api/workspaces/current", { confirm: "Restored Co" })).status, 200);
    const exported = await snapshot();

    await restore(bookmark);
    const sam = await accessToken(stack, "sam@new.test");
    // The problem: all of it is back.
    assert.equal((await callApi(stack, key.token, "GET", "/api/me")).status, 200, "the revoked key works again");
    assert.equal((await callApi(stack, alice, "GET", "/api/drafts?scope=workspace&slug=")).body.drafts.filter((d) => d.draftId === doomed.draftId).length, 1);
    assert.equal((await all(`SELECT COUNT(*) AS n FROM workspaces WHERE organization_id = '${workspace.id}'`))[0].n, 1);

    const { sql, summary } = reconcileStatements(exported.query, (await snapshot()).query);
    assert.deepEqual({ ...summary, revocations: 0, epochs: 0 }, { workspaces: 1, artifacts: 1, ciKeys: 1, invites: 1, revocations: 0, epochs: 0, undoneJoins: 0, scrubbedUsers: 0 });
    await batch(sql.map((statement) => proxy.env.DB.prepare(statement)));

    assert.equal((await callApi(stack, key.token, "GET", "/api/me")).status, 401, "the key is revoked again");
    const joined = await callApi(stack, sam, "POST", "/api/workspaces/join", { code: invite.code });
    assert.notEqual(joined.status, 200, "the invite is revoked again");
    const feed = (await callApi(stack, alice, "GET", "/api/drafts?scope=workspace")).body.drafts.map((d) => d.draftId);
    assert.ok(!feed.includes(doomed.draftId), "the deleted artifact is gone again");
    assert.ok(feed.includes(kept.draftId), "the rest is untouched");
    assert.equal((await fetch(doomed.publicUrl, { headers: { Authorization: `Bearer ${alice}` } })).status, 404);
    // Their HTML is queued for the cron again (deletion.test.js covers the cron).
    const queued = (await all("SELECT target FROM pending_deletions WHERE kind = 'r2_prefix'")).map((r) => r.target);
    assert.ok(queued.some((t) => t.endsWith(`/drafts/${doomed.draftId}/`)), "its HTML is queued for deletion");
    assert.equal((await all(`SELECT COUNT(*) AS n FROM workspaces WHERE organization_id = '${workspace.id}'`))[0].n, 0);
    assert.equal((await all(`SELECT COUNT(*) AS n FROM deleted_workspaces WHERE organization_id = '${workspace.id}'`))[0].n, 1);
    assert.ok(queued.includes(`orgs/${workspace.id}/`), "the workspace's HTML is queued for deletion");
    // Nothing is left to reconcile.
    const again = reconcileStatements(exported.query, (await snapshot()).query).summary;
    assert.equal(again.workspaces + again.artifacts + again.ciKeys + again.invites, 0);
  });
});

// Step 1 of the runbook: the service stays closed until the restore is reconciled.
describe("maintenance switch", () => {
  let stack;
  before(async () => {
    stack = await startStack({ sandbox: true, vars: { HTMLARTIFACT_MAINTENANCE: "on" } });
  });
  after(() => stack?.stop());

  test("every route but /healthz answers 503, on the app and the sandbox", async () => {
    assert.equal((await fetch(`${stack.baseUrl}/healthz`)).status, 200);
    const api = await fetch(`${stack.baseUrl}/api/me`, { headers: { Authorization: "Bearer anything" } });
    assert.equal(api.status, 503);
    assert.equal((await api.json()).code, "maintenance");
    assert.equal(api.headers.get("retry-after"), "300");
    for (const url of [`${stack.baseUrl}/`, `${stack.baseUrl}/auth/sign-in`, `${stack.sandboxUrl}/a/anything`]) {
      assert.equal((await fetch(url, { redirect: "manual" })).status, 503, url);
    }
  });
});
