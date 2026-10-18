// Moves artifact HTML from D1 (`blobs`) into R2, once R2 is switched on.
//   bun run migrate:r2              -> production
//   bun run migrate:r2 -- --staging -> staging
//   add --dry-run to only report what would move
//   --local <dir>: against local state persisted in <dir> (repo wrangler.toml;
//   tests only), treating the app as already reading R2
//
// For each object: reassemble its chunks, upload to R2, download it again and
// compare SHA-256, and only then delete its rows from D1. Safe to re-run: it
// picks up whatever is still in D1.
//
// Order matters (README: Storage): the app must already be deployed with the
// ARTIFACTS binding, so it writes to R2, reads R2 first, then D1, and deletes
// from both. This script refuses to run until /healthz says storage "r2":
// before that, an artifact deleted after being copied would leave its copy
// in R2 for good. An artifact deleted while its object is being copied is
// caught by re-checking, after the upload, that a version still references it.
import { $ } from "bun";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const staging = process.argv.includes("--staging");
const dryRun = process.argv.includes("--dry-run");
const localAt = process.argv.indexOf("--local");
const local = localAt > 0 ? process.argv[localAt + 1] : null;
const database = staging ? "htmlartifact-staging" : "htmlartifact";
const bucket = staging ? "htmlartifact-artifacts-staging" : "htmlartifact-artifacts";
const appUrl = staging ? "https://staging.htmlartifact.pages.dev" : "https://htmlartifact.pages.dev";
const root = new URL("..", import.meta.url).pathname;
const wrangler = `${root}node_modules/.bin/wrangler`;
const cwd = local ? root : `${root}deploy/app`;
const where = local ? ["--local", "--persist-to", local] : ["--remote"];
// Keys are generated server-side from this alphabet; anything else is refused
// rather than interpolated into SQL.
const SAFE_KEY = /^orgs\/[A-Za-z0-9_-]+\/drafts\/[A-Za-z0-9]+\/versions\/[A-Za-z0-9._/-]+$/;

async function d1<T>(sql: string): Promise<T[]> {
  const out = await $`${wrangler} d1 execute ${database} ${where} --json --command ${sql}`.cwd(cwd).quiet().text();
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed.flatMap((entry) => entry.results ?? []);
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const health = local
  ? { storage: "r2" }
  : await fetch(`${appUrl}/healthz`).then((r) => r.json() as Promise<{ storage?: string }>).catch(() => ({}) as { storage?: string });
const appReadsR2 = health.storage === "r2";
console.log(`${local ? `local ${local}` : appUrl} storage: ${health.storage ?? "unreachable"}`);
if (!appReadsR2 && !dryRun) {
  console.error("Deploy with the ARTIFACTS binding first (README: Storage), then run this again.");
  process.exit(1);
}

const keys = await d1<{ key: string; chunks: number; last: number }>(
  "SELECT key, COUNT(*) AS chunks, MAX(chunk) AS last FROM blobs GROUP BY key ORDER BY key"
);
console.log(`${keys.length} object(s) in D1 ${database}${dryRun ? " (dry run)" : ""}`);
if (dryRun || keys.length === 0) process.exit(0);

const work = mkdtempSync(join(tmpdir(), "htmlartifact-migrate-"));
let moved = 0;
let failed = 0;
try {
  for (const { key, chunks, last } of keys) {
    try {
      if (!SAFE_KEY.test(key)) throw new Error("unexpected key format");
      if (last !== chunks - 1) throw new Error(`chunks are not contiguous (${chunks} rows, last index ${last})`);
      const rows = await d1<{ data: string }>(`SELECT data FROM blobs WHERE key = '${key}' ORDER BY chunk`);
      const html = rows.map((row) => row.data).join("");
      const upload = join(work, "up.html");
      const download = join(work, "down.html");
      writeFileSync(upload, html);
      await $`${wrangler} r2 object put ${`${bucket}/${key}`} --file ${upload} --content-type ${"text/html; charset=utf-8"} --cache-control no-store ${where}`
        .cwd(cwd)
        .quiet();
      rmSync(download, { force: true });
      await $`${wrangler} r2 object get ${`${bucket}/${key}`} --file ${download} ${where}`.cwd(cwd).quiet();
      if (sha256(readFileSync(download)) !== sha256(Buffer.from(html, "utf8"))) throw new Error("R2 copy does not match (SHA-256)");
      // Deleted while we copied it? The app's deletion may have run before
      // our upload, so the copy would outlive it: remove it (and queue the
      // removal, so the ops cron retries if this delete fails).
      const referenced = await d1<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM draft_versions WHERE object_key = '${key}') + (SELECT COUNT(*) FROM draft_pages WHERE object_key = '${key}') AS n`
      );
      if (!referenced[0]?.n) {
        const versionPrefix = key.match(/^(orgs\/[^/]+\/drafts\/[^/]+\/versions\/[0-9A-Za-z]{20})/)?.[1];
        if (versionPrefix) {
          await d1(`INSERT INTO pending_deletions (kind, target) VALUES ('r2_prefix', '${versionPrefix}') ON CONFLICT (kind, target) DO NOTHING`);
        }
        await $`${wrangler} r2 object delete ${`${bucket}/${key}`} ${where}`.cwd(cwd).quiet();
        await d1(`DELETE FROM blobs WHERE key = '${key}'`);
        console.log(`dropped  ${key} (artifact deleted meanwhile)`);
        continue;
      }
      await d1(`DELETE FROM blobs WHERE key = '${key}'`);
      console.log(`moved    ${key}`);
      moved += 1;
    } catch (error) {
      failed += 1;
      console.error(`FAILED   ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`${moved} moved, ${failed} failed`);
if (failed) process.exit(1);
