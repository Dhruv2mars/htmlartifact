import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// `bun run migrate:r2` end to end, on local D1 and R2 state: chunks are
// reassembled, copied to R2, verified by SHA-256, and only then deleted from D1.
const root = new URL("..", import.meta.url).pathname;
const wrangler = path.join(root, "node_modules/.bin/wrangler");

test("migrate:r2 moves every referenced D1 blob into R2 intact, drops deleted ones, and empties D1", { timeout: 120_000 }, () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "htmlartifact-migrate-test-"));
  const d1 = (sql) => {
    const file = path.join(state, "query.sql");
    fs.writeFileSync(file, sql);
    return JSON.parse(execFileSync(wrangler, ["d1", "execute", "htmlartifact", "--local", "--persist-to", state, "--json", "--file", file], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  };
  const big = "é".repeat(90_000); // stored as two chunk rows, joined back in order
  const key = "orgs/org_m/drafts/abcdefabcdef/versions/AAAAAAAAAAAAAAAAAAAA.html";
  // D1 caps a statement at 100 KB: one row per statement.
  const sql = [
    "CREATE TABLE IF NOT EXISTS blobs (key TEXT NOT NULL, chunk INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, chunk));",
    `INSERT INTO blobs VALUES ('${key}', 0, '${big.slice(0, 45_000)}');`,
    `INSERT INTO blobs VALUES ('${key}', 1, '${big.slice(45_000)}');`,
    "INSERT INTO blobs VALUES ('orgs/org_m/drafts/abcdefabcdef/versions/AAAAAAAAAAAAAAAAAAAA/about.html', 0, '<p>about ☕</p>');",
    // An artifact deleted while the migration ran: its blob is read, but no version references it any more.
    "INSERT INTO blobs VALUES ('orgs/org_m/drafts/zzzzzzzzzzzz/versions/BBBBBBBBBBBBBBBBBBBB.html', 0, '<p>deleted</p>');",
    // The rows that reference stored objects (the app's schema, as far as the migration reads it).
    "CREATE TABLE draft_versions (id TEXT PRIMARY KEY, object_key TEXT NOT NULL);",
    "CREATE TABLE draft_pages (draft_version_id TEXT NOT NULL, path TEXT NOT NULL, object_key TEXT NOT NULL);",
    "CREATE TABLE pending_deletions (kind TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, PRIMARY KEY (kind, target));",
    `INSERT INTO draft_versions VALUES ('AAAAAAAAAAAAAAAAAAAA', '${key}');`,
    "INSERT INTO draft_pages VALUES ('AAAAAAAAAAAAAAAAAAAA', 'about.html', 'orgs/org_m/drafts/abcdefabcdef/versions/AAAAAAAAAAAAAAAAAAAA/about.html');"
  ];
  for (const statement of sql) d1(statement);
  const out = execFileSync("bun", ["scripts/migrate-blobs-to-r2.ts", "--local", state], { cwd: root, encoding: "utf8" });
  assert.match(out, /2 moved, 0 failed/);
  assert.equal(d1("SELECT COUNT(*) AS n FROM blobs")[0].results[0].n, 0);
  const get = (key) =>
    execFileSync(wrangler, ["r2", "object", "get", `htmlartifact-artifacts/${key}`, "--local", "--persist-to", state, "--pipe"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(get("orgs/org_m/drafts/abcdefabcdef/versions/AAAAAAAAAAAAAAAAAAAA.html"), big);
  assert.equal(get("orgs/org_m/drafts/abcdefabcdef/versions/AAAAAAAAAAAAAAAAAAAA/about.html"), "<p>about ☕</p>");
  // What it moved counts against the bucket's cap, as uploads do.
  const counted = d1("SELECT used FROM daily_budget WHERE day = 'total' AND scope = 'r2:bytes'")[0].results[0].used;
  assert.equal(counted, Buffer.byteLength(big) + Buffer.byteLength("<p>about ☕</p>") + 2 * 1024, "each object's bytes and overhead");
  // The deleted artifact's copy was removed again, with a queued retry for the cron.
  assert.match(out, /dropped {2}orgs\/org_m\/drafts\/zzzzzzzzzzzz\/versions\/BBBBBBBBBBBBBBBBBBBB\.html/);
  assert.throws(() => get("orgs/org_m/drafts/zzzzzzzzzzzz/versions/BBBBBBBBBBBBBBBBBBBB.html"));
  assert.equal(d1("SELECT target FROM pending_deletions")[0].results[0].target, "orgs/org_m/drafts/zzzzzzzzzzzz/versions/BBBBBBBBBBBBBBBBBBBB");
});
