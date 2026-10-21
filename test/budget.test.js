import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { STORAGE, accessToken, callApi, page, startStack } from "./helpers.js";

// Daily budgets for D1 rows written by uploads (README: Storage and the
// free-tier budget): D1 Free refuses every write, for everyone, for the rest
// of the day past 100,000. A one-page upload counts 16 rows on D1 storage
// (14 with an R2 bucket); content sent again unchanged counts 12.
const UPLOAD = STORAGE === "d1" ? 16 : 14;
const RESEND = 12;

describe("D1 rows-written budget", () => {
  let stack;
  before(async () => {
    stack = await startStack({
      vars: {
        HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY: String(2 * UPLOAD),
        HTMLARTIFACT_UPLOAD_ROWS_PER_DAY: String(2 * UPLOAD + RESEND)
      }
    });
  });
  after(() => stack?.stop());

  test("a workspace stops at its daily share, then the deployment at its total; reads keep working", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const up = (token, n) => callApi(stack, token, "POST", "/api/uploads", { html: page(`Page ${n}`) });
    const first = await up(alice, 1);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const resend = (description) =>
      callApi(stack, alice, "POST", "/api/uploads", { html: page("Page 1"), draftId: first.body.draftId, description });
    assert.equal((await resend("first")).status, 200, "unchanged content fits the rest of the share");

    const workspaceFull = await up(alice, 2);
    assert.equal(workspaceFull.status, 429);
    assert.equal(workspaceFull.body.code, "daily_budget");
    assert.match(workspaceFull.body.error, /This workspace has reached today's upload limit\. Try again after 00:00 UTC\./);
    const retryAfter = Number(workspaceFull.headers.get("retry-after"));
    assert.ok(retryAfter >= 1 && retryAfter <= 86_400, `Retry-After ${retryAfter}`);
    // Past the budget a metadata-only change is refused too, and nothing is written.
    assert.equal((await resend("second")).status, 429);
    const read = await callApi(stack, alice, "GET", "/api/drafts?scope=workspace");
    assert.equal(read.status, 200, "reads keep working");
    assert.equal(read.body.drafts.find((d) => d.draftId === first.body.draftId).description, "first");

    // Another workspace has its own share, until the deployment's total runs out.
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    assert.equal((await up(olivia, 3)).status, 201);
    const deploymentFull = await up(olivia, 4);
    assert.equal(deploymentFull.status, 429);
    assert.match(deploymentFull.body.error, /deployment has reached today's upload limit/);
  });
});

describe("daily budget under concurrent uploads", () => {
  let stack;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY: String(3 * UPLOAD) } });
  });
  after(() => stack?.stop());

  test("parallel uploads cannot overdraw it", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => callApi(stack, alice, "POST", "/api/uploads", { html: page(`Race ${i}`) })));
    for (const r of results) assert.ok([201, 429].includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(results.filter((r) => r.status === 201).length, 3);
  });
});
