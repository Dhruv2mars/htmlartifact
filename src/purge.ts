// Real deletion. R2 objects live under `orgs/<organizationId>/drafts/<draftId>/...`,
// so deleting an artifact or a whole workspace is deleting one key prefix.
// Every deletion is queued in D1 first (`pending_deletions`), attempted at once,
// and retried by the ops Worker's cron until it succeeds.

export type DeletionKind = "r2_prefix" | "workos_org";

export interface PurgeEnv {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  WORKOS_API_KEY?: string;
  WORKOS_API_URL?: string;
}

export const PENDING_DELETIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS pending_deletions (
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (kind, target)
)`;

export const orgPrefix = (organizationId: string) => `orgs/${organizationId}/`;
export const draftPrefix = (organizationId: string, draftId: string) =>
  `${orgPrefix(organizationId)}drafts/${draftId}/`;
export const versionPrefix = (organizationId: string, draftId: string, versionId: string) =>
  `${draftPrefix(organizationId, draftId)}versions/${versionId}`;

export function queueDeletion(db: D1Database, kind: DeletionKind, target: string): D1PreparedStatement {
  // An org, an artifact, or one upload's objects (`.../versions/<versionId>`
  // covers `<versionId>.html` and `<versionId>/...`; version IDs are fixed-length).
  if (kind === "r2_prefix" && !/^orgs\/[^/]+\/(drafts\/[^/]+\/(versions\/[0-9A-Za-z]{20})?)?$/.test(target)) {
    throw new Error(`refusing to queue unscoped R2 prefix: ${target}`);
  }
  return db
    .prepare("INSERT INTO pending_deletions (kind, target) VALUES (?, ?) ON CONFLICT (kind, target) DO NOTHING")
    .bind(kind, target);
}

/** Delete every object under `prefix`. Returns how many were deleted. */
export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    // Always list from the start: we delete what we list, so the next page is the new first page.
    const page = await bucket.list({ prefix, limit: 1000 });
    if (page.objects.length === 0) return deleted;
    await bucket.delete(page.objects.map((object) => object.key));
    deleted += page.objects.length;
  }
}

async function deleteWorkosOrganization(env: PurgeEnv, organizationId: string): Promise<void> {
  if (!env.WORKOS_API_KEY) throw new Error("WORKOS_API_KEY is not set");
  const base = (env.WORKOS_API_URL || "https://api.workos.com").replace(/\/$/, "");
  const response = await fetch(`${base}/organizations/${encodeURIComponent(organizationId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.WORKOS_API_KEY}` }
  });
  if (!response.ok && response.status !== 404) throw new Error(`WorkOS ${response.status}`);
}

export async function runDeletion(env: PurgeEnv, kind: DeletionKind, target: string): Promise<boolean> {
  try {
    if (kind === "r2_prefix") await deletePrefix(env.ARTIFACTS, target);
    else await deleteWorkosOrganization(env, target);
    await env.DB.prepare("DELETE FROM pending_deletions WHERE kind = ? AND target = ?").bind(kind, target).run();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE pending_deletions SET attempts = attempts + 1, last_error = ? WHERE kind = ? AND target = ?"
    )
      .bind(message.slice(0, 500), kind, target)
      .run();
    return false;
  }
}

/** Retry queued deletions (oldest first). Returns counts for logging. */
export async function drainPendingDeletions(env: PurgeEnv, max = 100): Promise<{ done: number; failed: number }> {
  const { results } = await env.DB.prepare(
    "SELECT kind, target FROM pending_deletions ORDER BY created_at LIMIT ?"
  )
    .bind(max)
    .all<{ kind: DeletionKind; target: string }>();
  let done = 0;
  let failed = 0;
  for (const row of results) {
    if (await runDeletion(env, row.kind, row.target)) done += 1;
    else failed += 1;
  }
  return { done, failed };
}

// ---- Artifacts, workspaces, users. Each deletion is one D1 batch (atomic):
// queue the R2 prefix (and WorkOS org) and drop every row. The R2/WorkOS work
// runs right after; whatever fails stays queued for the cron.

/** Queue an artifact's R2 prefix and delete its rows (its custom URL goes with the row). */
export function deleteDraftStatements(db: D1Database, organizationId: string, draftId: string): D1PreparedStatement[] {
  return [
    queueDeletion(db, "r2_prefix", draftPrefix(organizationId, draftId)),
    db
      .prepare("DELETE FROM draft_pages WHERE draft_version_id IN (SELECT id FROM draft_versions WHERE draft_id = ?)")
      .bind(draftId),
    db.prepare("DELETE FROM draft_versions WHERE draft_id = ?").bind(draftId),
    db.prepare("DELETE FROM drafts WHERE id = ? AND organization_id = ?").bind(draftId, organizationId)
  ];
}

/** Delete an artifact everywhere. True if R2 was purged now; false: still queued for the cron. */
export async function purgeDraft(env: PurgeEnv, organizationId: string, draftId: string): Promise<boolean> {
  await env.DB.batch(deleteDraftStatements(env.DB, organizationId, draftId));
  return runDeletion(env, "r2_prefix", draftPrefix(organizationId, draftId));
}

/**
 * The first statement tombstones the workspace (deleted_workspaces), which
 * every access path checks, so access ends in the same transaction that drops
 * the data. The tombstone holds only the organization ID and is kept.
 */
export function deleteWorkspaceStatements(db: D1Database, organizationId: string): D1PreparedStatement[] {
  const org = (sql: string) => db.prepare(sql).bind(organizationId);
  return [
    org("INSERT INTO deleted_workspaces (organization_id) VALUES (?) ON CONFLICT DO NOTHING"),
    queueDeletion(db, "r2_prefix", orgPrefix(organizationId)),
    queueDeletion(db, "workos_org", organizationId),
    org(
      `DELETE FROM draft_pages WHERE draft_version_id IN
         (SELECT v.id FROM draft_versions v JOIN drafts d ON d.id = v.draft_id WHERE d.organization_id = ?)`
    ),
    org("DELETE FROM draft_versions WHERE draft_id IN (SELECT id FROM drafts WHERE organization_id = ?)"),
    org("DELETE FROM drafts WHERE organization_id = ?"),
    org("DELETE FROM invites WHERE organization_id = ?"),
    org("DELETE FROM memberships WHERE organization_id = ?"),
    org("DELETE FROM membership_epochs WHERE organization_id = ?"),
    org("DELETE FROM revocations WHERE organization_id = ?"),
    org("DELETE FROM workspaces WHERE organization_id = ?")
  ];
}

/** The queued half of a workspace deletion: its R2 prefix, then its WorkOS organization. */
export async function runWorkspaceDeletions(env: PurgeEnv, organizationId: string): Promise<{ r2: boolean; workos: boolean }> {
  const r2 = await runDeletion(env, "r2_prefix", orgPrefix(organizationId));
  const workos = await runDeletion(env, "workos_org", organizationId);
  return { r2, workos };
}

export async function isWorkspaceDeleted(db: D1Database, organizationId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM deleted_workspaces WHERE organization_id = ?").bind(organizationId).first();
  return Boolean(row);
}

/** A deleted WorkOS user: drop their cached PII. Their artifacts stay with the workspace. */
export function scrubUserStatements(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        "UPDATE accounts SET name = 'Deleted user', email = NULL, picture_url = NULL, updated_at = unixepoch() WHERE id = ?"
      )
      .bind(userId),
    db.prepare("UPDATE draft_versions SET source_ip = NULL, user_agent = NULL WHERE created_by = ?").bind(userId)
  ];
}

export const RETENTION_SECONDS = 30 * 24 * 60 * 60;

/** Erase upload request metadata older than the retention window. */
export async function eraseExpiredRequestMetadata(db: D1Database, now = Math.floor(Date.now() / 1000)): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE draft_versions SET source_ip = NULL, user_agent = NULL WHERE created_at < ? AND (source_ip IS NOT NULL OR user_agent IS NOT NULL)"
    )
    .bind(now - RETENTION_SECONDS)
    .run();
  return result.meta.changes ?? 0;
}
