import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { accessToken, callApi, page, startStack } from "./helpers.js";

// Free-tier storage guards: each workspace's share of HTML, and the database
// size at which uploads stop (D1 Free caps a database at 500 MB).

describe("workspace storage quota", () => {
  let stack;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_WORKSPACE_QUOTA_BYTES: "5000" } });
  });
  after(() => stack?.stop());

  test("uploads stop at the quota; deleting frees it; unchanged re-uploads are not counted", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const body = (n) => `<p>${"x".repeat(1800)}</p><p>${n}</p>`;
    const first = await callApi(stack, alice, "POST", "/api/uploads", { html: page("One", body(1)) });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const again = await callApi(stack, alice, "POST", "/api/uploads", { html: page("One", body(1)), draftId: first.body.draftId });
    assert.equal(again.status, 200);
    assert.equal(again.body.unchanged, true, "identical content is a no-op, not counted");
    const second = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Two", body(2)) });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const third = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Three", body(3)) });
    assert.equal(third.status, 507);
    assert.match(third.body.error, /workspace's storage is full/);
    assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${first.body.draftId}`)).status, 200);
    const retry = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Three", body(3)) });
    assert.equal(retry.status, 201, "deleting freed the space");
    // Other workspaces have their own share.
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    assert.equal((await callApi(stack, olivia, "POST", "/api/uploads", { html: page("Theirs", body(4)) })).status, 201);
  });
});

describe("database size guard", () => {
  let stack;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_DATABASE_LIMIT_BYTES: "1000" } });
  });
  after(() => stack?.stop());

  test("uploads stop when the database would pass its limit; reads keep working", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const res = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Big", "<p>hello</p>") });
    assert.equal(res.status, 507);
    assert.match(res.body.error, /deployment's storage is full/);
    assert.equal((await callApi(stack, alice, "GET", "/api/me")).status, 200);
  });
});
