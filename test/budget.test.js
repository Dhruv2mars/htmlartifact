import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getPlatformProxy } from "wrangler";
import { STORAGE, accessToken, callApi, page, startStack, testConfigPath } from "./helpers.js";

// Daily budgets (README: Storage and the free-tier budget). D1 rows written
// by uploads, per workspace and per deployment (D1 Free refuses every write
// for the rest of the day past 100,000). R2 bills past its free tier and has
// no spending cap, so the app caps its own use: Class A operations (puts,
// lists) per UTC day, and the HTML the bucket may hold (R2 runs only).

const twoPages = (title) => ({
  files: [
    { path: "index.html", html: page(title, '<a href="notes.html">notes</a>') },
    { path: "notes.html", html: page(`${title} notes`) }
  ]
});

// Rows and objects straight from the stack's local D1 and R2.
async function platform(stack) {
  const proxy = await getPlatformProxy({ configPath: testConfigPath(), persist: { path: path.join(stack.tmp, "state", "v3") } });
  return { proxy, rows: async (sql, ...binds) => (await proxy.env.DB.prepare(sql).bind(...binds).all()).results };
}

// R2 holds exactly the bytes the cap counts.
async function assertBytesCounted(proxy, rows) {
  const stored = (await proxy.env.ARTIFACTS.list()).objects.reduce((total, object) => total + object.size, 0);
  const [counted] = await rows("SELECT used FROM daily_budget WHERE day = 'total' AND scope = 'r2:bytes'");
  assert.equal(counted?.used ?? 0, stored);
  return stored;
}

describe("D1 rows-written budget", () => {
  let stack;
  let proxy;
  let rows;
  before(async () => {
    // A one-page upload counts 12 rows on D1 storage, 10 on R2.
    stack = await startStack({ vars: { HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY: "24", HTMLARTIFACT_UPLOAD_ROWS_PER_DAY: "36" } });
    ({ proxy, rows } = await platform(stack));
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("a workspace stops at its daily share, then the deployment at its total; unchanged content still counts its metadata", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const up = (token, n) => callApi(stack, token, "POST", "/api/uploads", { html: page(`Page ${n}`) });
    const first = await up(alice, 1);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    // Identical content keeps the version but writes its metadata: 8 rows.
    const resend = (description) =>
      callApi(stack, alice, "POST", "/api/uploads", { html: page("Page 1"), draftId: first.body.draftId, description });
    assert.equal((await resend("first")).status, 200);
    const workspaceFull = await up(alice, 2);
    assert.equal(workspaceFull.status, 429);
    assert.match(workspaceFull.body.error, /This workspace has reached today's upload limit\. Try again after 00:00 UTC\./);
    const retryAfter = Number(workspaceFull.headers.get("retry-after"));
    assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `Retry-After ${retryAfter}`);
    // Past the budget, a metadata-only change is refused too, and nothing is written.
    assert.equal((await resend("second")).status, 429);
    const [draft] = await rows("SELECT description FROM drafts WHERE id = ?", first.body.draftId);
    assert.equal(draft.description, "first");

    // Another workspace has its own share, until the deployment's total runs out.
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    assert.equal((await up(olivia, 3)).status, 201);
    const deploymentFull = await up(olivia, 4);
    assert.equal(deploymentFull.status, 429);
    assert.match(deploymentFull.body.error, /deployment has reached today's upload limit/);
  });
});

describe("R2 Class A budget", { skip: STORAGE !== "r2" && "R2 only" }, () => {
  let stack;
  let proxy;
  let rows;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_R2_CLASS_A_PER_DAY: "3" } });
    ({ proxy, rows } = await platform(stack));
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("uploads stop when today's puts would pass the budget; deletions wait for the next day", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const first = await callApi(stack, alice, "POST", "/api/uploads", twoPages("One"));
    assert.equal(first.status, 201, JSON.stringify(first.body));

    // Two more puts would make 4 > 3: refused before anything is written.
    const over = await callApi(stack, alice, "POST", "/api/uploads", twoPages("Two"));
    assert.equal(over.status, 429);
    assert.match(over.body.error, /deployment has reached today's upload limit/);
    const retryAfter = Number(over.headers.get("retry-after"));
    assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `Retry-After ${retryAfter}`);

    // One put still fits.
    const single = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Three") });
    assert.equal(single.status, 201, JSON.stringify(single.body));
    const day = new Date().toISOString().slice(0, 10);
    assert.deepEqual(await rows("SELECT day, used FROM daily_budget WHERE scope = 'r2:class_a'"), [{ day, used: 3 }]);
    assert.equal((await proxy.env.ARTIFACTS.list()).objects.length, 3, "the refused upload wrote nothing");

    // Deleting needs a list (Class A): the rows go now, the objects stay queued.
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${first.body.draftId}`)).status, 200);
    assert.deepEqual(await rows("SELECT id FROM drafts WHERE id = ?", first.body.draftId), []);
    const [queued] = await rows("SELECT target, last_error FROM pending_deletions WHERE kind = 'r2_prefix'");
    assert.match(queued.target, new RegExp(`/drafts/${first.body.draftId}/$`));
    assert.match(queued.last_error, /R2 operations budget/);
    assert.equal((await proxy.env.ARTIFACTS.list()).objects.length, 3);
    // Its objects are still in the bucket, so they still count against the cap.
    const before = await assertBytesCounted(proxy, rows);

    // A new day: the budget is back, and the next deletion goes through.
    await proxy.env.DB.prepare("UPDATE daily_budget SET day = '2000-01-01' WHERE day <> 'total'").run();
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${single.body.draftId}`)).status, 200);
    const left = (await proxy.env.ARTIFACTS.list()).objects.map((o) => o.key);
    assert.equal(left.length, 2);
    assert.ok(left.every((key) => key.includes(first.body.draftId)), "only the queued artifact's objects are left");
    assert.ok((await assertBytesCounted(proxy, rows)) < before);
  });
});

describe("R2 storage cap", { skip: STORAGE !== "r2" && "R2 only" }, () => {
  let stack;
  let proxy;
  let rows;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_STORAGE_LIMIT_BYTES: "3000" } });
    ({ proxy, rows } = await platform(stack));
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("uploads stop when the bucket would hold more than the cap, across workspaces, until a deletion frees it", async () => {
    const body = (n) => `<p>${"x".repeat(1800)}</p><p>${n}</p>`;
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const first = await callApi(stack, alice, "POST", "/api/uploads", { html: page("One", body(1)) });
    assert.equal(first.status, 201);
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    const full = await callApi(stack, olivia, "POST", "/api/uploads", { html: page("Two", body(2)) });
    assert.equal(full.status, 507);
    assert.match(full.body.error, /deployment's storage is full/);
    assert.equal((await proxy.env.ARTIFACTS.list()).objects.length, 1, "the refused upload wrote nothing");
    await assertBytesCounted(proxy, rows);

    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${first.body.draftId}`)).status, 200);
    assert.equal(await assertBytesCounted(proxy, rows), 0);
    assert.equal((await callApi(stack, olivia, "POST", "/api/uploads", { html: page("Two", body(2)) })).status, 201);
    await assertBytesCounted(proxy, rows);
  });
});
