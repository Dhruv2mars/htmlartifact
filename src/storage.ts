import type { StoredBody } from "./gzip.ts";

// Artifact HTML storage. Keys are generated server-side from IDs and
// validated page paths (`orgs/<org>/drafts/<draft>/versions/<version>...`).
//
// Two backends behind one interface:
//   - R2, when the ARTIFACTS bucket is bound. Reads fall back to D1, so blobs
//     written before the switch keep serving until `bun run migrate:r2` has
//     moved them (see README: Storage).
//   - D1 otherwise: each object is split into ≤ 1 MB chunks (D1 rows are
//     capped at 2 MB), stored as rows of `blobs`, and written in the same
//     atomic batch as the version row that references them. D1, not KV: a
//     fresh artifact must open for teammates at once, and KV is eventually
//     consistent.
//
// An object is HTML text (plain uploads), or, when its key ends in ".gz", the
// gzip member it was uploaded as (src/gzip.ts), stored and served as received.
// In D1 those are BLOBs (SQLite keeps a BLOB as is in a TEXT column), moved as
// hex (`unhex`/`hex` in SQL): D1 passes a BLOB to and from the Worker as an
// array of numbers, which costs milliseconds of CPU per MB to build and read.

export const BLOBS_SCHEMA = `CREATE TABLE IF NOT EXISTS blobs (
  key TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (key, chunk)
)`;

const CHUNK_BYTES = 1_000_000;
// Gzip chunks travel as hex, two characters a byte: 1 MB of hex per row too.
const GZIP_CHUNK_BYTES = 500_000;

export const GZIP_SUFFIX = ".gz";

export interface StorageEnv {
  DB: D1Database;
  ARTIFACTS?: R2Bucket;
}

export type StorageKind = "r2" | "d1";

export const storageKind = (env: StorageEnv): StorageKind => (env.ARTIFACTS ? "r2" : "d1");

/**
 * Stores `objects` for one upload. R2: written now (the caller deletes them
 * again if its rows don't commit). D1: nothing is written yet; the returned
 * statements must go into the caller's batch, after the statement that
 * inserts version `versionId`, so the chunks commit (or not) with it.
 */
export async function stageObjects(
  env: StorageEnv,
  versionId: string,
  objects: { key: string; body: StoredBody }[]
): Promise<D1PreparedStatement[]> {
  for (const { key, body } of objects) {
    if (isGzipKey(key) !== (typeof body !== "string")) throw new Error(`Object ${key} does not match its encoding.`);
  }
  const bucket = env.ARTIFACTS;
  if (bucket) {
    // allSettled: on a failed write, wait for the others before the caller cleans up.
    const puts = await Promise.allSettled(
      objects.map(({ key, body }) =>
        bucket.put(key, body, {
          httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "no-store", ...(typeof body === "string" ? {} : { contentEncoding: "gzip" }) }
        })
      )
    );
    const failed = puts.find((put) => put.status === "rejected");
    if (failed) throw failed.reason;
    return [];
  }
  const where = "WHERE EXISTS (SELECT 1 FROM draft_versions WHERE id = ?)";
  const text = env.DB.prepare(`INSERT INTO blobs (key, chunk, data) SELECT ?, ?, ? ${where}`);
  const bytes = env.DB.prepare(`INSERT INTO blobs (key, chunk, data) SELECT ?, ?, unhex(?) ${where}`);
  return objects.flatMap(({ key, body }) =>
    typeof body === "string"
      ? utf8Chunks(body, CHUNK_BYTES).map((data, chunk) => text.bind(key, chunk, data, versionId))
      : byteChunks(body, GZIP_CHUNK_BYTES).map((data, chunk) => bytes.bind(key, chunk, toHex(data), versionId))
  );
}

/** An object as stored: HTML text, or (a ".gz" key) its gzip bytes. */
export async function getObject(env: StorageEnv, key: string): Promise<StoredBody> {
  const gzip = isGzipKey(key);
  if (env.ARTIFACTS) {
    const object = await env.ARTIFACTS.get(key);
    if (object) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      // Decode exactly what was stored: Body.text() would drop a leading BOM.
      return gzip ? bytes : new TextDecoder("utf-8", { ignoreBOM: true, fatal: false }).decode(bytes);
    }
  }
  const { results } = await env.DB.prepare(`SELECT ${gzip ? "hex(data)" : "data"} AS data FROM blobs WHERE key = ? ORDER BY chunk`)
    .bind(key)
    .all<{ data: string }>();
  if (!results.length) throw new Error(`Missing artifact object: ${key}`);
  const data = results.map((row) => row.data).join("");
  return gzip ? fromHex(data) : data;
}

const isGzipKey = (key: string): boolean => key.endsWith(GZIP_SUFFIX);

/** Delete every object whose key starts with `prefix`, in every backend. Returns how many. */
export async function deleteObjects(env: StorageEnv, prefix: string): Promise<number> {
  let deleted = 0;
  const bucket = env.ARTIFACTS;
  if (bucket) {
    for (;;) {
      // Always list from the start: we delete what we list, so the next page is the new first page.
      const page = await bucket.list({ prefix, limit: 1000 });
      if (page.objects.length === 0) break;
      await bucket.delete(page.objects.map((object) => object.key));
      deleted += page.objects.length;
    }
  }
  // Keys are ASCII from [A-Za-z0-9._/-], all below "~": [prefix, prefix + "~")
  // is exactly the keys starting with prefix, as an index range.
  const result = await env.DB.prepare("DELETE FROM blobs WHERE key >= ? AND key < ?").bind(prefix, `${prefix}~`).run();
  return deleted + (result.meta.changes ?? 0);
}

/** Throws if the storage backend is unreachable (health checks). */
export async function probeStorage(env: StorageEnv): Promise<void> {
  if (env.ARTIFACTS) await env.ARTIFACTS.head("healthz");
  await env.DB.prepare("SELECT 1 FROM blobs LIMIT 1").all();
}

function byteChunks(bytes: Uint8Array, maxBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength || chunks.length === 0; at += maxBytes) chunks.push(bytes.subarray(at, at + maxBytes));
  return chunks;
}

// Workers have Uint8Array#toHex and Uint8Array.fromHex (native); TypeScript's ES2023 lib does not.
const toHex = (bytes: Uint8Array): string => (bytes as unknown as { toHex(): string }).toHex();
const fromHex = (hex: string): Uint8Array => (Uint8Array as unknown as { fromHex(hex: string): Uint8Array }).fromHex(hex);

// Splits `text` into pieces of at most `maxBytes` UTF-8 bytes, never inside a
// character (TextEncoder.encodeInto stops at a character boundary).
function utf8Chunks(text: string, maxBytes: number): string[] {
  if (text === "") return [""];
  const encoder = new TextEncoder();
  const buffer = new Uint8Array(maxBytes);
  const chunks: string[] = [];
  let rest = text;
  while (rest.length) {
    const { read } = encoder.encodeInto(rest, buffer);
    chunks.push(rest.slice(0, read));
    rest = rest.slice(read);
  }
  return chunks;
}
