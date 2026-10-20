import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getPlatformProxy } from "wrangler";
import { STORAGE, accessToken, callApi, page, startStack, testConfigPath } from "./helpers.js";

// R2 bills past its free tier and has no spending cap, so the app caps its
// own use (README: Free-tier budget): Class A operations (puts, lists) per
// UTC day, and the HTML the bucket may hold. R2 runs only.

const twoPages = (title) => ({
  files: [
    { path: "index.html", html: page(title, '<a href="notes.html">notes</a>') },
    { path: "notes.html", html: page(`${title} notes`) }
  ]
});

describe("R2 Class A budget", { skip: STORAGE !== "r2" && "R2 only" }, () => {
  let stack;
  let proxy;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_R2_CLASS_A_PER_DAY: "3" } });
    proxy = await getPlatformProxy({ configPath: testConfigPath(), persist: { path: path.join(stack.tmp, "state", "v3") } });
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  const rows = async (sql, ...binds) => (await proxy.env.DB.prepare(sql).bind(...binds).all()).results;

  test("uploads stop when today's puts would pass the budget; deletions wait for the next day", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const first = await callApi(stack, alice, "POST", "/api/uploads", twoPages("One"));
    assert.equal(first.status, 201, JSON.stringify(first.body));

    // Two more puts would make 4 > 3: refused before anything is written.
    const over = await callApi(stack, alice, "POST", "/api/uploads", twoPages("Two"));
    assert.equal(over.status, 503);
    assert.match(over.body.error, /today's upload limit/);
    const retryAfter = Number(over.headers.get("retry-after"));
    assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `Retry-After ${retryAfter}`);

    // One put still fits.
    const single = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Three") });
    assert.equal(single.status, 201, JSON.stringify(single.body));
    const day = new Date().toISOString().slice(0, 10);
    assert.deepEqual(await rows("SELECT day, class_a FROM r2_ops"), [{ day, class_a: 3 }]);
    assert.equal((await proxy.env.ARTIFACTS.list()).objects.length, 3, "the refused upload wrote nothing");

    // Deleting needs a list (Class A): the rows go now, the objects stay queued.
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${first.body.draftId}`)).status, 200);
    assert.deepEqual(await rows("SELECT id FROM drafts WHERE id = ?", first.body.draftId), []);
    const [queued] = await rows("SELECT target, last_error FROM pending_deletions WHERE kind = 'r2_prefix'");
    assert.match(queued.target, new RegExp(`/drafts/${first.body.draftId}/$`));
    assert.match(queued.last_error, /R2 operations budget/);
    assert.equal((await proxy.env.ARTIFACTS.list()).objects.length, 3);

    // A new day: the budget is back, and the next deletion goes through.
    await proxy.env.DB.prepare("UPDATE r2_ops SET day = '2000-01-01'").run();
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${single.body.draftId}`)).status, 200);
    const left = (await proxy.env.ARTIFACTS.list()).objects.map((o) => o.key);
    assert.equal(left.length, 2);
    assert.ok(left.every((key) => key.includes(first.body.draftId)), "only the queued artifact's objects are left");
  });
});

describe("R2 storage cap", { skip: STORAGE !== "r2" && "R2 only" }, () => {
  let stack;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_STORAGE_LIMIT_BYTES: "3000" } });
  });
  after(() => stack?.stop());

  test("uploads stop when the bucket would hold more than the cap, across workspaces", async () => {
    const body = (n) => `<p>${"x".repeat(1800)}</p><p>${n}</p>`;
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    assert.equal((await callApi(stack, alice, "POST", "/api/uploads", { html: page("One", body(1)) })).status, 201);
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    const full = await callApi(stack, olivia, "POST", "/api/uploads", { html: page("Two", body(2)) });
    assert.equal(full.status, 507);
    assert.match(full.body.error, /deployment's storage is full/);
  });
});
