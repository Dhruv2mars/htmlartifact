import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { getPlatformProxy } from "wrangler";
import pkg from "../package.json" with { type: "json" };
import { Browser, STORAGE, accessToken, callApi, page, retryLocked, startStack, testConfigPath, writeHtml } from "./helpers.js";

// Capacity on the free tier (product plan v2, milestone M0): pages stored
// gzip-compressed (G0a), D1 write budgets counted as D1 measures them, in
// separate scopes (G0b), the beta gate on new workspaces (G0c), and the CLI
// version floor (G45). Checked against the stores themselves through
// wrangler's getPlatformProxy on the Worker's local state.

const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;

// A dense, compressible page of about `bytes` bytes (a report table).
function densePage(title, bytes) {
  const rows = [];
  let size = 0;
  for (let i = 0; size < bytes; i += 1) {
    const row = `<tr><td class="c${i % 7}">${(i * 7919) % 100003}</td><td>${Math.sin(i).toFixed(6)}</td><td>row ${i} of the ${title} table</td></tr>`;
    rows.push(row);
    size += row.length;
  }
  return page(title, `<table>${rows.join("")}</table>`);
}
const gzip = (html) => zlib.gzipSync(Buffer.from(html, "utf8"), { level: 9 });
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

// A request with full control of headers, and the body exactly as sent (fetch
// would inflate a gzip body and drop Content-Encoding).
function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

// An upload with a given User-Agent (callApi sends Node's).
async function uploadAs(stack, token, userAgent, body) {
  const response = await fetch(`${stack.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": userAgent },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function openProxy(stack) {
  return getPlatformProxy({ configPath: testConfigPath(), persist: { path: path.join(stack.tmp, "state", "v3") } });
}
const rowsOf = (proxy, sql, ...binds) => retryLocked(async () => (await proxy.env.DB.prepare(sql).bind(...binds).all()).results);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
async function used(proxy, scope) {
  const [row] = await rowsOf(proxy, "SELECT used FROM daily_budget WHERE day = ? AND scope = ?", today(), scope);
  return row?.used ?? 0;
}

describe("gzip storage (G0a)", () => {
  let stack;
  let proxy;
  let alice;
  before(async () => {
    stack = await startStack();
    assert.equal((await fetch(`${stack.baseUrl}/healthz`)).status, 200);
    proxy = await openProxy(stack);
    alice = await accessToken(stack, "alice@acme.test", "Acme");
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("a gzip page is stored as sent, served as gzip, and inflated for clients that don't take gzip", async () => {
    const html = densePage("Gzip report", 100_000);
    const gz = gzip(html);
    const before = (await callApi(stack, alice, "POST", "/api/check", {})).body.usage.storedBytes;
    const up = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(gz), filename: "report.html" });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.totalBytes, Buffer.byteLength(html), "totalBytes is the HTML's size");
    assert.equal(up.body.storedBytes, gz.length, "storedBytes is what is stored");
    assert.ok(gz.length * 3 < Buffer.byteLength(html), `compressed ${gz.length} of ${Buffer.byteLength(html)}`);
    assert.equal(up.body.title, "Gzip report");

    // Stored exactly as received, under a ".gz" key; the quota counts it.
    const [version] = await rowsOf(proxy, "SELECT object_key, file_size FROM draft_versions WHERE id = ?", up.body.versionId);
    assert.match(version.object_key, /\/versions\/[a-z0-9]+\.html\.gz$/);
    assert.equal(version.file_size, gz.length);
    if (STORAGE === "d1") {
      const chunks = await rowsOf(proxy, "SELECT typeof(data) AS type, hex(data) AS hex FROM blobs WHERE key = ? ORDER BY chunk", version.object_key);
      assert.deepEqual([...new Set(chunks.map((chunk) => chunk.type))], ["blob"]);
      assert.equal(chunks.map((chunk) => chunk.hex).join(""), gz.toString("hex").toUpperCase());
    } else {
      const object = await proxy.env.ARTIFACTS.get(version.object_key);
      assert.deepEqual(Buffer.from(await object.arrayBuffer()), gz);
    }
    const after = (await callApi(stack, alice, "POST", "/api/check", {})).body.usage.storedBytes;
    assert.equal(after - before, gz.length, "the workspace's storage grew by the compressed size");

    // Served as stored to a client that takes gzip: the bytes validated are the bytes inflated.
    const url = up.body.publicUrl;
    const zipped = await rawGet(url, { Authorization: `Bearer ${alice}`, "Accept-Encoding": "gzip, deflate, br" });
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers["content-encoding"], "gzip");
    assert.match(zipped.headers["vary"] || "", /accept-encoding/i);
    assert.match(zipped.headers["content-type"], /^text\/html; charset=utf-8/i);
    assert.ok(zipped.body.equals(gz), "the body is the uploaded gzip member, byte for byte");
    // Inflated for one that doesn't, and for one that refuses gzip by q=0.
    for (const accept of [undefined, "identity", "gzip;q=0, *;q=1", "br"]) {
      const plain = await rawGet(url, { Authorization: `Bearer ${alice}`, ...(accept ? { "Accept-Encoding": accept } : {}) });
      assert.equal(plain.status, 200, String(accept));
      assert.equal(plain.headers["content-encoding"], undefined, String(accept));
      assert.equal(plain.body.toString("utf8"), html, String(accept));
    }
    // The raw source view (text/plain) too.
    const source = await rawGet(`${url}/raw`, { Authorization: `Bearer ${alice}`, "Accept-Encoding": "identity" });
    assert.equal(source.body.toString("utf8"), html);

    // The same HTML sent plain is the same content: no new version.
    const again = await callApi(stack, alice, "POST", "/api/uploads", { html, draftId: up.body.draftId });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.unchanged, true);
  });

  test("versions stored before gzip keep serving next to gzip ones", async () => {
    const first = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Plain v1") });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const [v1] = await rowsOf(proxy, "SELECT object_key FROM draft_versions WHERE id = ?", first.body.versionId);
    assert.match(v1.object_key, /\.html$/, "a plain upload is stored as text, as before");
    const second = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(gzip(page("Gzip v2"))), draftId: first.body.draftId });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const base = first.body.versionUrl.replace(/\/v\/1$/, "");
    const one = await rawGet(`${base}/v/1`, { Authorization: `Bearer ${alice}`, "Accept-Encoding": "gzip" });
    assert.equal(one.headers["content-encoding"], undefined);
    assert.equal(one.body.toString(), page("Plain v1"));
    const two = await rawGet(`${base}/v/2`, { Authorization: `Bearer ${alice}`, "Accept-Encoding": "gzip" });
    assert.equal(two.headers["content-encoding"], "gzip");
    assert.equal(zlib.gunzipSync(two.body).toString(), page("Gzip v2"));
  });

  test("anything but one complete gzip member is refused, and a bomb stops at the limit", async () => {
    const html = page("Member");
    const gz = gzip(html);
    const crcBroken = Buffer.from(gz);
    crcBroken[crcBroken.length - 6] ^= 0xff;
    const sizeLies = Buffer.from(gz);
    sizeLies.writeUInt32LE(5, sizeLies.length - 4);
    const cases = {
      "two members": Buffer.concat([gz, gzip(page("Second"))]),
      "trailing bytes": Buffer.concat([gz, Buffer.from("<script>alert(1)</script>")]),
      "trailing zeros": Buffer.concat([gz, Buffer.alloc(8)]),
      truncated: gz.subarray(0, gz.length - 4),
      "bad checksum": crcBroken,
      "wrong length": sizeLies,
      "not gzip": Buffer.from(html),
      "zlib, not gzip": zlib.deflateSync(Buffer.from(html)),
      "not UTF-8": zlib.gzipSync(Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x70, 0x3e]))
    };
    for (const [name, bytes] of Object.entries(cases)) {
      const refused = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(bytes) });
      assert.equal(refused.status, 422, `${name}: ${JSON.stringify(refused.body)}`);
      assert.equal(refused.body.issues[0].code, "bad-gzip", name);
    }
    const notBase64 = await callApi(stack, alice, "POST", "/api/uploads", { gzip: "%%% not base64 %%%" });
    assert.equal(notBase64.status, 422);
    assert.equal(notBase64.body.issues[0].code, "bad-gzip");
    const both = await callApi(stack, alice, "POST", "/api/uploads", { html, gzip: b64(gz) });
    assert.equal(both.status, 422);
    // A multi-page upload says which page.
    const folder = await callApi(stack, alice, "POST", "/api/uploads", {
      files: [
        { path: "index.html", gzip: b64(gz) },
        { path: "notes.html", gzip: b64(cases["two members"]) }
      ]
    });
    assert.equal(folder.status, 422);
    assert.equal(folder.body.issues[0].path, "notes.html");

    // 200 MB of zeros in ~200 KB: refused as too large, without inflating it all.
    const bomb = zlib.gzipSync(Buffer.alloc(200 * 1024 * 1024), { level: 9 });
    const started = Date.now();
    const exploded = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(bomb) });
    assert.equal(exploded.status, 422, JSON.stringify(exploded.body));
    assert.equal(exploded.body.issues[0].code, "too-large");
    assert.ok(Date.now() - started < 5000, `answered in ${Date.now() - started} ms`);
    // The same bomb with its trailer claiming 5 bytes: stops at the limit too.
    const lyingBomb = Buffer.from(bomb);
    lyingBomb.writeUInt32LE(5, lyingBomb.length - 4);
    const lying = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(lyingBomb) });
    assert.equal(lying.status, 422);
    assert.equal(lying.body.issues[0].code, "too-large");
    // Two pages that each fit but together don't: the limit is for the upload.
    const half = densePage("Half", 600 * 1024);
    const pair = await callApi(stack, alice, "POST", "/api/uploads", {
      files: [
        { path: "index.html", gzip: b64(gzip(half)) },
        { path: "two.html", gzip: b64(gzip(half.replace("Half", "Other"))) }
      ]
    });
    assert.equal(pair.status, 422);
    assert.equal(pair.body.issues[0].code, "too-large");
  });

  test("a gzip header with a file name, comment and header CRC (as gzip(1) writes) is accepted", async () => {
    const html = page("Named member");
    const deflated = zlib.deflateRawSync(Buffer.from(html));
    const name = Buffer.from("report.html\0");
    const comment = Buffer.from("made by hand\0");
    const head = Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0x08 | 0x10 | 0x02, 0, 0, 0, 0, 0, 3]), name, comment]);
    const headerCrc = Buffer.alloc(2);
    headerCrc.writeUInt16LE(zlib.crc32(head) & 0xffff);
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(zlib.crc32(Buffer.from(html)) >>> 0, 0);
    trailer.writeUInt32LE(Buffer.byteLength(html), 4);
    const member = Buffer.concat([head, headerCrc, deflated, trailer]);
    assert.equal(zlib.gunzipSync(member).toString(), html, "a valid member");
    const up = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(member) });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const served = await rawGet(up.body.publicUrl, { Authorization: `Bearer ${alice}`, "Accept-Encoding": "gzip" });
    assert.ok(served.body.equals(member));
    // The same header with a wrong header CRC is refused.
    headerCrc[0] ^= 0xff;
    const broken = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(Buffer.concat([head, headerCrc, deflated, trailer])) });
    assert.equal(broken.status, 422);
  });
});

describe("gzip storage and the quota", () => {
  let stack;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_WORKSPACE_QUOTA_BYTES: "60000" } });
  });
  after(() => stack?.stop());

  test("the workspace quota counts stored (compressed) bytes", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const html = densePage("Big table", 200_000);
    const plain = await callApi(stack, alice, "POST", "/api/uploads", { html });
    assert.equal(plain.status, 507, "200 KB of HTML does not fit 60 KB plain");
    const zipped = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(gzip(html)) });
    assert.equal(zipped.status, 201, JSON.stringify(zipped.body));
    const usage = (await callApi(stack, alice, "POST", "/api/check", {})).body.usage;
    assert.equal(usage.storedBytes, zipped.body.storedBytes);
  });
});

describe("the CLI publishes gzip (G0a)", () => {
  let stack;
  let proxy;
  let home;
  const cli = (args, env = {}) =>
    run(process.execPath, [CLI, ...args], {
      env: { ...process.env, HTMLARTIFACT_HOME: home, HTMLARTIFACT_TOKEN: "", HTMLARTIFACT_API_URL: stack.baseUrl, CI: "", GITHUB_ACTIONS: "", ...env },
      timeout: 60_000
    });
  before(async () => {
    stack = await startStack();
    assert.equal((await fetch(`${stack.baseUrl}/healthz`)).status, 200);
    proxy = await openProxy(stack);
    home = path.join(stack.tmp, "cli-home");
    await cli(["login"]);
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("a folder goes up gzip-compressed and reads back byte for byte", async () => {
    const dir = path.join(stack.tmp, "deck");
    const index = `﻿${densePage("Deck", 50_000)}`; // a byte order mark survives too
    const notes = densePage("Deck notes", 30_000);
    writeHtml(stack.tmp, "deck/index.html", index);
    writeHtml(stack.tmp, "deck/notes.html", notes);
    const receipt = JSON.parse((await cli(["upload", dir, "--json"])).stdout);
    assert.equal(receipt.action, "created");
    assert.equal(receipt.totalBytes, Buffer.byteLength(index) + Buffer.byteLength(notes));
    assert.ok(receipt.storedBytes > 0 && receipt.storedBytes * 3 < receipt.totalBytes, JSON.stringify(receipt));
    assert.deepEqual(receipt.notices, []);
    const keys = await rowsOf(
      proxy,
      `SELECT object_key FROM draft_versions WHERE draft_id = ?1
       UNION ALL SELECT p.object_key FROM draft_pages p JOIN draft_versions v ON v.id = p.draft_version_id WHERE v.draft_id = ?1`,
      receipt.draftId
    );
    assert.equal(keys.length, 2);
    for (const { object_key } of keys) assert.match(object_key, /\.html\.gz$/);
    const out = path.join(stack.tmp, "read-back.html");
    await cli(["read", receipt.url, "--out", out]);
    const { readFileSync } = await import("node:fs");
    assert.equal(readFileSync(out, "utf8"), index);
  });

  test("a server that reads no gzip gets the HTML again, plain; codes and notices reach --json", async () => {
    // Stands in for a server before gzip (or before the version floor).
    const seen = [];
    let answer = null;
    const old = http.createServer((request, response) => {
      let data = "";
      request.on("data", (chunk) => (data += chunk));
      request.on("end", () => {
        const send = (status, body) => {
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify(body));
        };
        if (request.url === "/api/me") return send(200, { ok: true, workspace: { id: "org_old", name: "Old" } });
        const body = JSON.parse(data || "{}");
        seen.push({ ua: request.headers["user-agent"], body });
        if (answer) return send(...answer);
        if (body.gzip !== undefined) {
          return send(422, { ok: false, errors: ["HTML document is empty."], warnings: [], issues: [{ level: "error", code: "empty", message: "HTML document is empty.", count: 1 }] });
        }
        return send(201, {
          ok: true,
          created: true,
          draftId: "abcdefabcdef",
          versionId: "v1",
          versionNumber: 1,
          publicUrl: "http://old.test/d/abcdefabcdef",
          rawUrl: "http://old.test/d/abcdefabcdef/raw",
          versionUrl: "http://old.test/d/abcdefabcdef/v/1",
          contentHash: "x",
          totalBytes: Buffer.byteLength(body.html),
          workspace: { id: "org_old", name: "Old" },
          warnings: ["htmlartifact 0.0.1 is out of date. Update: npx htmlartifact@latest"],
          notices: [{ code: "cli_outdated", message: "htmlartifact 0.0.1 is out of date.", fix: "npx htmlartifact@latest" }]
        });
      });
    });
    await new Promise((resolve) => old.listen(0, "127.0.0.1", resolve));
    const env = { HTMLARTIFACT_API_URL: `http://127.0.0.1:${old.address().port}`, HTMLARTIFACT_TOKEN: "sk_old_server" };
    try {
      const file = writeHtml(stack.tmp, "old.html", page("For an old server"));
      const receipt = JSON.parse((await cli(["upload", file, "--json"], env)).stdout);
      assert.equal(seen.length, 2, "sent gzip, then plain");
      assert.equal(typeof seen[0].body.gzip, "string");
      assert.equal(seen[0].body.html, undefined);
      assert.equal(seen[1].body.html, page("For an old server"));
      assert.equal(seen[1].body.gzip, undefined);
      assert.equal(seen[0].ua, `htmlartifact/${pkg.version}`);
      assert.equal(receipt.storedBytes, null, "an old server reports no storedBytes");
      assert.deepEqual(receipt.notices, [{ code: "cli_outdated", message: "htmlartifact 0.0.1 is out of date.", fix: "npx htmlartifact@latest" }]);

      // A refusal for being below the floor: its code and minimum in --json.
      answer = [426, { ok: false, code: "cli_too_old", minVersion: "9.0.0", error: "htmlartifact 0.3.0 is too old.", fix: "npx htmlartifact@latest" }];
      const refused = await cli(["upload", file, "--json"], env).then(
        () => assert.fail("expected a refusal"),
        (error) => ({ ...JSON.parse(error.stdout), exit: error.code })
      );
      assert.equal(refused.code, "cli_too_old");
      assert.equal(refused.minVersion, "9.0.0");
      assert.equal(refused.exit, 1);
    } finally {
      old.close();
    }
  });
});

describe("measured D1 budgets (G0b)", () => {
  let stack;
  let proxy;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY: "400" } });
    assert.equal((await fetch(`${stack.baseUrl}/healthz`)).status, 200);
    proxy = await openProxy(stack);
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("uploads count the rows D1 measured, in the upload scope", async (t) => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    await callApi(stack, alice, "GET", "/api/me");
    const org = (await callApi(stack, alice, "GET", "/api/me")).body.workspace.id;
    // Warm up: the workspace's storage counter row is created on first use.
    const warm = await callApi(stack, alice, "POST", "/api/uploads", { gzip: b64(gzip(page("Warm"))) });
    assert.equal(warm.status, 201);
    const measure = async (body) => {
      const deployment = await used(proxy, "d1:rows");
      const workspace = await used(proxy, `d1:rows:${org}`);
      const response = await callApi(stack, alice, "POST", "/api/uploads", body);
      assert.ok(response.status < 300, JSON.stringify(response.body));
      const spent = (await used(proxy, "d1:rows")) - deployment;
      assert.equal((await used(proxy, `d1:rows:${org}`)) - workspace, spent, "the workspace's share moves with the deployment's");
      return { spent, response };
    };
    const created = await measure({ gzip: b64(gzip(page("Measured"))) });
    const version = await measure({ gzip: b64(gzip(page("Measured v2"))), draftId: created.response.body.draftId });
    const unchanged = await measure({ gzip: b64(gzip(page("Measured v2"))), draftId: created.response.body.draftId });
    const deck = await measure({
      files: ["index.html", "a.html", "b.html"].map((p) => ({ path: p, gzip: b64(gzip(page(`Deck ${p}`))) }))
    });
    const figures = { created: created.spent, version: version.spent, unchanged: unchanged.spent, threePages: deck.spent };
    t.diagnostic(`rows per upload (${STORAGE}): ${JSON.stringify(figures)}`);
    // src/api.ts reserves MEASURED_UPLOAD_ROWS before an upload; these are what
    // it measures. A change to the upload's statements changes them: update both.
    const expected = STORAGE === "d1" ? { created: 0, version: 0, unchanged: 0, threePages: 0 } : { created: 0, version: 0, unchanged: 0, threePages: 0 };
    assert.deepEqual(figures, expected);
  });

  test("settling a budget writes one row per key", async () => {
    await retryLocked(() => proxy.env.DB.prepare("INSERT OR IGNORE INTO daily_budget (day, scope, used) VALUES (?, 'probe', 1)").bind(today()).run());
    const settled = await retryLocked(() =>
      proxy.env.DB.prepare(
        `INSERT INTO daily_budget (day, scope, used) VALUES (?1, 'probe', MAX(0, ?2))
         ON CONFLICT (day, scope) DO UPDATE SET used = MAX(0, used + ?2)`
      )
        .bind(today(), 3)
        .run()
    );
    assert.equal(settled.meta.rows_written, 1);
  });
});

describe("budget scopes (G0b)", () => {
  let stack;
  before(async () => {
    stack = await startStack({
      vars: { HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY: "1", HTMLARTIFACT_OPS_ROWS_PER_WORKSPACE_DAY: "1000" }
    });
  });
  after(() => stack?.stop());

  test("uploads past their budget leave invites, joins and sign-ins working", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const upload = await callApi(stack, alice, "POST", "/api/uploads", { html: page("No room") });
    assert.equal(upload.status, 429, JSON.stringify(upload.body));
    assert.equal(upload.body.code, "daily_budget");
    // The ops scope is its own: one tenant's uploads cannot stop its invites.
    const invite = await callApi(stack, alice, "POST", "/api/workspaces/invites", {});
    assert.equal(invite.status, 201, JSON.stringify(invite.body));
    const nora = await accessToken(stack, "nora@new.test");
    const join = await callApi(stack, nora, "POST", "/api/workspaces/join", { code: invite.body.code });
    assert.equal(join.status, 200, JSON.stringify(join.body));
    assert.equal((await callApi(stack, alice, "GET", "/api/me")).status, 200, "signing in is never budgeted");
  });
});

describe("workspace creation cap (G0c)", () => {
  let stack;
  let proxy;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_UPLOAD_ROWS_PER_DAY: "1000" } });
    assert.equal((await fetch(`${stack.baseUrl}/healthz`)).status, 200);
    proxy = await openProxy(stack);
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("closes after 3 busy upload days in 7, on the API and the web form; joining stays open", async () => {
    const nora = await accessToken(stack, "nora@new.test");
    const create = (name) => callApi(stack, nora, "POST", "/api/workspaces", { name });
    assert.equal((await create("Open team")).status, 201, "open by default");

    // Two days at 80% of the upload pool, and one at 79%: still open.
    const busy = (day, value) =>
      retryLocked(() =>
        proxy.env.DB.prepare("INSERT OR REPLACE INTO daily_budget (day, scope, used) VALUES (?, 'd1:rows', ?)").bind(day, value).run()
      );
    await busy(daysAgo(1), 800);
    await busy(daysAgo(3), 950);
    await busy(daysAgo(4), 790);
    await busy(daysAgo(9), 1000); // older than 7 days: not counted
    assert.equal((await create("Still open")).status, 201);

    await busy(daysAgo(6), 800);
    const closed = await create("Too late");
    assert.equal(closed.status, 507, JSON.stringify(closed.body));
    assert.equal(closed.body.code, "creation_closed");
    assert.equal(closed.body.reason, "uploads");
    assert.equal(closed.body.error, "htmlartifact is full for new teams right now. Join a team with its invite link.");

    const browser = new Browser(stack);
    await browser.signIn("sam@new.test");
    const web = await browser.post("/workspaces", { name: "Web team" });
    assert.equal(web.status, 507);
    assert.match(web.text_, /full for new teams/);

    // Joining with an invite stays open.
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const invite = await callApi(stack, alice, "POST", "/api/workspaces/invites", {});
    const join = await callApi(stack, nora, "POST", "/api/workspaces/join", { code: invite.body.code });
    assert.equal(join.status, 200, JSON.stringify(join.body));
  });
});

describe("workspace creation cap: storage", () => {
  let stack;
  before(async () => {
    // A fresh local database is a few hundred KB: past 60% of 500 KB.
    stack = await startStack({ vars: { HTMLARTIFACT_DATABASE_LIMIT_BYTES: "500000" } });
  });
  after(() => stack?.stop());

  test("closes when the database holds more than 60% of its cap", async () => {
    const nora = await accessToken(stack, "nora@new.test");
    const closed = await callApi(stack, nora, "POST", "/api/workspaces", { name: "Too full" });
    assert.equal(closed.status, 507, JSON.stringify(closed.body));
    assert.equal(closed.body.reason, "storage");
  });
});

describe("CLI version floor (G45)", () => {
  let stack;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_MIN_CLI_VERSION: "0.2.1" } });
  });
  after(() => stack?.stop());

  test("below the floor uploads are refused; older than the server, a cli_outdated notice", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const body = (title) => ({ html: page(title) });
    const tooOld = await uploadAs(stack, alice, "htmlartifact/0.2.0", body("Too old"));
    assert.equal(tooOld.status, 426, JSON.stringify(tooOld.body));
    assert.equal(tooOld.body.code, "cli_too_old");
    assert.equal(tooOld.body.minVersion, "0.2.1");
    assert.match(tooOld.body.error, /npx htmlartifact@latest/);
    assert.equal((await uploadAs(stack, alice, "htmlartifact/0.2.1-beta.1", body("Pre-release"))).status, 426, "a pre-release sorts before its release");

    const older = await uploadAs(stack, alice, "htmlartifact/0.2.1", body("Old but allowed"));
    assert.equal(older.status, 201, JSON.stringify(older.body));
    const outdated = pkg.version !== "0.2.1";
    assert.deepEqual(
      older.body.notices.map((notice) => notice.code),
      outdated ? ["cli_outdated"] : []
    );
    if (outdated) {
      assert.match(older.body.notices[0].fix, /npx htmlartifact@latest/);
      assert.ok(older.body.warnings.some((warning) => warning.startsWith("htmlartifact 0.2.1 is out of date")), "older CLIs print warnings");
    }
    const current = await uploadAs(stack, alice, `htmlartifact/${pkg.version}`, body("Current"));
    assert.deepEqual(current.body.notices, []);
    const other = await uploadAs(stack, alice, "curl/8.7.1", body("Not the CLI"));
    assert.equal(other.status, 201);
    assert.deepEqual(other.body.notices, [], "other clients are not checked");
  });
});
