import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { validateHtml, validateUpload } from "../src/html-policy.ts";
import { STORAGE, accessToken, callApi, startStack } from "./helpers.js";

const MiB = 1024 * 1024;
const ACCOUNT_LIMIT = 4 * MiB; // MAX_ACCOUNT_HTML_BYTES default with R2
// The server's default for this run's storage (src/config.ts): 1 MiB on D1.
const SERVER_LIMIT = STORAGE === "r2" ? 4 * MiB : 1 * MiB;

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

// Runs validateHtml and returns the result with its wall time and heap growth.
function timed(html) {
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = validateHtml(html, { maxBytes: ACCOUNT_LIMIT });
  return { result, ms: performance.now() - start, heapMB: (process.memoryUsage().heapUsed - heapBefore) / MiB };
}

const codes = (result) => result.issues.map((issue) => issue.code);
const attrList = (count, from = 0) => Array.from({ length: count }, (_, i) => `a${from + i}=x`).join(" ");

describe("validator limits stop hostile pages fast", () => {
  // Before the limit stopped parsing, 391 KB of <div> took ~70 s of CPU and
  // 4 MB of <b> needed over 512 MB of heap.
  for (const [name, open] of [
    ["<div>", "<div>"],
    ["<b>", "<b>"],
    ["<div> in a <template>", "<div>"]
  ]) {
    test(`~4 MB of nested ${name} fails as too-deep in under a second`, () => {
      const prefix = `<title>t</title>${name.includes("template") ? "<template>" : ""}`;
      const html = prefix + open.repeat(Math.floor((4_000_000 - prefix.length) / open.length));
      const { result, ms, heapMB } = timed(html);
      assert.deepEqual(codes(result), ["too-deep"]);
      assert.equal(result.ok, false);
      assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
      assert.ok(heapMB < 64, `heap grew ${heapMB.toFixed(1)} MB`);
    });
  }

  test("nesting up to the limit still validates the whole page", () => {
    const page = (depth) =>
      `<title>t</title>${"<div>".repeat(depth)}x${"</div>".repeat(depth)}<iframe></iframe>`;
    // html and body are levels 1 and 2; text at level 512 is too deep.
    assert.deepEqual(codes(validateHtml(page(508))), ["blocked-tag"]);
    assert.deepEqual(codes(validateHtml(page(509))), ["blocked-tag", "too-deep"]);
    assert.deepEqual(codes(validateHtml(page(600))), ["too-deep"], "parsing stops at the first element past the limit");
  });

  test("a tag with 40,000 attributes fails fast with too-many-attributes", () => {
    const html = `<title>t</title>\n<div ${attrList(40_000)}>x</div>`;
    const { result, ms } = timed(html);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map(({ code, message, line, column }) => ({ code, message, line, column })),
      [{ code: "too-many-attributes", message: "An element has more than 1000 attributes.", line: 2, column: 1 }]
    );
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  });

  test("20,000 <body> tags merging attributes fail fast with too-many-attributes", () => {
    const html = "<title>t</title>" + Array.from({ length: 20_000 }, (_, i) => `<body a${i}=x>`).join("");
    const { result, ms } = timed(html);
    assert.deepEqual(codes(result), ["too-many-attributes"]);
    assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
  });

  test("the attribute limit is 1,000 per element, merged tags included", () => {
    assert.deepEqual(codes(validateHtml(`<title>t</title><div ${attrList(1000)}>`)), []);
    assert.deepEqual(codes(validateHtml(`<title>t</title><div ${attrList(1001)}>`)), ["too-many-attributes"]);
    assert.deepEqual(codes(validateHtml(`<title>t</title><div ${attrList(1000)} a0=y a1=z>`)), [], "duplicates do not count");
    assert.deepEqual(codes(validateHtml(`<title>t</title><body ${attrList(600)}><body ${attrList(400, 600)}>`)), []);
    assert.deepEqual(
      codes(validateHtml(`<title>t</title><body ${attrList(600)}><body ${attrList(401, 600)}>`)),
      ["too-many-attributes"]
    );
  });

  // These fail if parse5 changes the tokenizer internals LimitedTokenizer
  // overrides (package.json pins parse5's exact version for that reason).
  test("duplicate attributes are dropped in linear time, keeping the first", async () => {
    const { readFile } = await import("node:fs/promises");
    const pinned = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).devDependencies.parse5;
    const installed = JSON.parse(
      await readFile(new URL("../node_modules/parse5/package.json", import.meta.url), "utf8")
    ).version;
    assert.match(pinned, /^\d+\.\d+\.\d+$/, "parse5 must be pinned to an exact version");
    assert.equal(installed, pinned);

    const first = validateHtml(`<title>t</title>\n<a  href="https://ok.test" href="javascript:x" onclick="fetch(1)">x</a>`);
    assert.deepEqual(
      first.issues.map(({ code, line, column }) => ({ code, line, column })),
      [{ code: "sandbox-network", line: 2, column: 48 }],
      "the later, unsafe href is a dropped duplicate; the onclick keeps its own location"
    );

    // 500 tags of 1,000 attributes each: ~2.8 s with parse5's linear scan.
    const wide = "<title>t</title>" + `<div ${attrList(1000)}></div>`.repeat(500);
    const { result, ms } = timed(wide);
    assert.deepEqual(codes(result), []);
    assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  });
});

describe("declarative shadow roots", () => {
  test("shadow root content is checked like the rest of the page", () => {
    const result = validateHtml(
      `<title>t</title><div><template shadowrootmode="open">\n<meta http-equiv="refresh" content="0;url=https://x.test"><script src="https://x.test/a.js"></script></template></div>`
    );
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.map(({ code, line, column }) => ({ code, line, column })),
      [
        { code: "meta-refresh", line: 2, column: 1 },
        { code: "external-script", line: 2, column: 59 }
      ]
    );
    assert.equal(result.hasScripts, true);
  });

  test("the legacy shadowroot attribute and nested shadow roots count too", () => {
    assert.deepEqual(codes(validateHtml(`<title>t</title><template shadowroot="closed"><iframe></iframe></template>`)), [
      "blocked-tag"
    ]);
    assert.deepEqual(
      codes(
        validateHtml(
          `<title>t</title><template shadowrootmode="open"><p><template shadowrootmode="open"><a href="javascript:x">x</a></template></template>`
        )
      ),
      ["unsafe-url"]
    );
  });

  test("ordinary templates, and shadow roots inside them, stay unchecked", () => {
    const inner = `<meta http-equiv="refresh" content="0"><iframe></iframe><script src="https://x.test/a.js"></script>`;
    for (const html of [
      `<title>t</title><template>${inner}</template>`,
      `<title>t</title><template><template shadowrootmode="open">${inner}</template></template>`
    ]) {
      const result = validateHtml(html);
      assert.deepEqual(result.issues, [], html);
      assert.equal(result.hasScripts, false);
    }
  });

  test("a <title> in a shadow root does not name the page", () => {
    const result = validateHtml(`<template shadowrootmode="open"><title>Shadow</title></template><title>Real</title>`);
    assert.equal(result.title, "Real");
    assert.deepEqual(
      codes(validateHtml(`<template shadowrootmode="open"><title>Shadow</title></template>`)),
      ["no-title"]
    );
  });

  test("issues in a shadow root sort in document order", () => {
    const result = validateHtml(
      `<title>t</title><iframe></iframe><table><template shadowrootmode="open"><form></form></template>x<embed></table>`
    );
    // "x" and <embed> are foster-parented before the table; the template stays inside it.
    assert.deepEqual(
      result.issues.map(({ message, column }) => ({ message, column })),
      [
        { message: "Blocked <iframe> tag.", column: 17 },
        { message: "Blocked <embed> tag.", column: 98 },
        { message: "Blocked <form> tag.", column: 73 }
      ]
    );
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

  test("a dense page just under the limit publishes and reads back byte for byte", async () => {
    // On D1 this spans several 1 MB chunks, and multi-byte text crosses chunk edges.
    const html = densePage(SERVER_LIMIT - 64 * 1024, { extra: "<p>naïve café ☕ 日本語</p>".repeat(2000) });
    const result = await callApi(stack, alice, "POST", "/api/uploads", { html });
    assert.equal(result.status, 201, JSON.stringify(result.body).slice(0, 500));
    const read = await fetch(result.body.publicUrl, { headers: { Authorization: `Bearer ${alice}` } });
    assert.equal(read.status, 200);
    assert.equal(await read.text(), html);
  });

  test("a page over the account limit is refused with too-large", async () => {
    const result = await callApi(stack, alice, "POST", "/api/uploads", { html: densePage(SERVER_LIMIT + 1) });
    assert.equal(result.status, 422);
    assert.deepEqual(
      result.body.issues.map((issue) => issue.code),
      ["too-large"]
    );
  });

  test("a body that cannot hold a valid upload is refused unread", async () => {
    // 3x the limit plus 64 KiB is the most a valid upload's JSON can need.
    const result = await callApi(stack, alice, "POST", "/api/uploads", {
      html: densePage(1000),
      padding: "x".repeat(3 * SERVER_LIMIT + 64 * 1024)
    });
    assert.equal(result.status, 413);
    assert.match(result.body.error, STORAGE === "r2" ? /Request is over the 12\.1 MiB limit\./ : /Request is over the 3\.1 MiB limit\./);
  });
});
