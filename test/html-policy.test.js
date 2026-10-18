import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { validateHtml, validateUpload } from "../src/html-policy.ts";
import { accessToken, callApi, startStack } from "./helpers.js";

const MiB = 1024 * 1024;
const ACCOUNT_LIMIT = 4 * MiB; // MAX_ACCOUNT_HTML_BYTES default

// Dense, table-heavy markup of about `bytes` bytes: 7 elements per ~190-byte
// row, the shape that made a full parse5 tree cost ~57 MB of heap per MB.
function densePage(bytes, { title = "Dense report", extra = "" } = {}) {
  const head = `<!doctype html><html><head><title>${title}</title></head><body><table>`;
  const tail = `</table>${extra}</body></html>`;
  const rows = [head];
  let size = head.length + tail.length;
  for (let i = 0; size < bytes; i++) {
    const row = `<tr class="r${i % 7}"><td>${i}</td><td><a href="https://example.com/p/${i}">item ${i}</a></td><td><span class="v">${(i * 37) % 1000}</span></td><td><b>x</b></td></tr>\n`;
    rows.push(row);
    size += row.length;
  }
  rows.push(tail);
  return rows.join("");
}

describe("validating large pages", () => {
  const page = densePage(4_000_000);

  test("a dense ~4 MB table page passes, in bounded memory", () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const result = validateHtml(page, { maxBytes: ACCOUNT_LIMIT });
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

    assert.equal(result.bytes, Buffer.byteLength(page));
    assert.ok(result.bytes > 3.8 * MiB && result.bytes <= ACCOUNT_LIMIT);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.issues, []);
    assert.equal(result.title, "Dense report");
    assert.equal(result.hasScripts, false);
    // A full parse5 tree of this page holds ~230 MB until validation returns.
    assert.ok(heapGrowth < 64 * MiB, `heap grew ${(heapGrowth / MiB).toFixed(1)} MB`);
  });

  test("problems deep in a dense page fail it, with their source location", () => {
    const bad = densePage(4_000_000, {
      extra: `\n<iframe src="https://x.test"></iframe><div onclick="fetch('/x')">x</div><iframe></iframe>`
    });
    const line = bad.split("\n").length;
    const result = validateHtml(bad, { maxBytes: ACCOUNT_LIMIT });
    assert.equal(result.ok, false);
    assert.equal(result.hasScripts, true);
    assert.deepEqual(
      result.issues.map(({ code, line, column, count }) => ({ code, line, column, count })),
      [
        { code: "blocked-tag", line, column: 1, count: 2 },
        { code: "sandbox-network", line, column: 44, count: 1 } // the onclick attribute
      ]
    );
  });

  test("a page over the limit is rejected before it is parsed", () => {
    const big = densePage(ACCOUNT_LIMIT + 1, { extra: "<iframe></iframe>" });
    const result = validateHtml(big, { maxBytes: ACCOUNT_LIMIT });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map((issue) => issue.code),
      ["too-large"],
      "no other issue: the page was never parsed"
    );
    assert.equal(result.title, null);
    assert.equal(
      result.issues[0].message,
      `HTML is ${result.bytes} bytes (4 MiB); the limit for this upload is 4194304 bytes (4 MiB).`
    );

    const upload = validateUpload(
      [
        { path: "index.html", html: big },
        { path: "bad path", html: "<p>x" }
      ],
      { maxBytes: ACCOUNT_LIMIT }
    );
    assert.equal(upload.ok, false);
    assert.deepEqual(
      upload.issues.map((issue) => issue.code),
      ["page-path", "too-large"]
    );
    assert.equal(upload.totalBytes, Buffer.byteLength(big));
    assert.equal(upload.pages[0].title, null, "pages of an oversized upload are not parsed");
  });
});

describe("large uploads through the API", () => {
  let stack;
  let alice;

  before(async () => {
    stack = await startStack();
    alice = await accessToken(stack, "alice@acme.test", "Acme");
  });

  after(async () => {
    await stack?.stop();
  });

  test("a dense ~4 MB page publishes", async () => {
    const result = await callApi(stack, alice, "POST", "/api/uploads", { html: densePage(4_000_000) });
    assert.equal(result.status, 201, JSON.stringify(result.body).slice(0, 500));
  });

  test("a page over the account limit is refused with too-large", async () => {
    const result = await callApi(stack, alice, "POST", "/api/uploads", { html: densePage(ACCOUNT_LIMIT + 1) });
    assert.equal(result.status, 422);
    assert.deepEqual(
      result.body.issues.map((issue) => issue.code),
      ["too-large"]
    );
  });

  test("a body that cannot hold a valid upload is refused unread", async () => {
    // 2x the limit plus 64 KiB is the most a valid upload's JSON can need.
    const result = await callApi(stack, alice, "POST", "/api/uploads", {
      html: densePage(1000),
      padding: "x".repeat(2 * ACCOUNT_LIMIT + 64 * 1024)
    });
    assert.equal(result.status, 413);
    assert.match(result.body.error, /Request is over the 8\.1 MiB limit\./);
  });
});
