// Artifact HTML storage. Keys are generated server-side from IDs and
// validated page paths (`orgs/<org>/drafts/<draft>/versions/<version>...`).
//
// Two backends behind one interface:
//   - R2, when the ARTIFACTS bucket is bound. Reads fall back to D1, so blobs
//     written before the switch keep serving until `bun run migrate:r2` has
//     moved them (see README: Storage).
//   - D1 otherwise: each object is split into ≤ 1 MB chunks of UTF-8 (D1 rows
//     are capped at 2 MB), stored as rows of `blobs`, and written in the same
//     atomic batch as the version row that references them. D1, not KV: a
//     fresh artifact must open for teammates at once, and KV is eventually
//     consistent.

export const BLOBS_SCHEMA = `CREATE TABLE IF NOT EXISTS blobs (
  key TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (key, chunk)
)`;

const CHUNK_BYTES = 1_000_000;

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
  objects: { key: string; html: string }[]
): Promise<D1PreparedStatement[]> {
  const bucket = env.ARTIFACTS;
  if (bucket) {
    // allSettled: on a failed write, wait for the others before the caller cleans up.
    const puts = await Promise.allSettled(
      objects.map(({ key, html }) =>
        bucket.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "no-store" } })
      )
    );
    const failed = puts.find((put) => put.status === "rejected");
    if (failed) throw failed.reason;
    return [];
  }
  const insert = env.DB.prepare(
    "INSERT INTO blobs (key, chunk, data) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM draft_versions WHERE id = ?)"
  );
  return objects.flatMap(({ key, html }) =>
    utf8Chunks(html, CHUNK_BYTES).map((data, chunk) => insert.bind(key, chunk, data, versionId))
  );
}

export async function getHtmlObject(env: StorageEnv, key: string): Promise<string> {
  if (env.ARTIFACTS) {
    const object = await env.ARTIFACTS.get(key);
    // Decode exactly what was stored: Body.text() would drop a leading BOM.
    if (object) return new TextDecoder("utf-8", { ignoreBOM: true, fatal: false }).decode(await object.arrayBuffer());
  }
  const { results } = await env.DB.prepare("SELECT data FROM blobs WHERE key = ? ORDER BY chunk")
    .bind(key)
    .all<{ data: string }>();
  if (!results.length) throw new Error(`Missing artifact object: ${key}`);
  return results.map((row) => row.data).join("");
}

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
