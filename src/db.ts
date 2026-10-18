// D1 (SQLite) access. The schema is created on first use by each isolate, so
// a fresh deployment needs no migration step. Times are unix seconds.

import { PENDING_DELETIONS_SCHEMA } from "./purge.ts";
import type { Account, AccountRow, WorkspaceRow } from "./types.ts";

export const FLAGS = { largeUploads: "large-uploads" };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  picture_url TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS workspaces (
  organization_id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  role TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS membership_epochs (
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  PRIMARY KEY (user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS removed_members (
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS revocations (
  subject TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (subject, organization_id)
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  repo_org TEXT,
  repo_name TEXT,
  repo_host TEXT,
  slug TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS drafts_org_slug_idx ON drafts(organization_id, slug);
CREATE INDEX IF NOT EXISTS drafts_org_updated_idx ON drafts(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS drafts_account_idx ON drafts(account_id, organization_id);
CREATE TABLE IF NOT EXISTS draft_versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 1,
  has_inline_script INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  credential_id TEXT,
  source_ip TEXT,
  user_agent TEXT,
  cli_version TEXT,
  git_branch TEXT,
  git_commit_sha TEXT,
  git_commit_subject TEXT,
  git_dirty INTEGER,
  original_filename TEXT,
  ci_run_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (draft_id, version_number)
);
CREATE TABLE IF NOT EXISTS draft_pages (
  draft_version_id TEXT NOT NULL,
  path TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  title TEXT,
  has_inline_script INTEGER NOT NULL,
  PRIMARY KEY (draft_version_id, path)
);
CREATE TABLE IF NOT EXISTS deleted_workspaces (
  organization_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

const ready = new WeakMap<D1Database, Promise<D1Result[]>>();

// Runs the idempotent schema once per isolate and D1 binding.
export function ensureSchema(db: D1Database): Promise<D1Result[]> {
  let promise = ready.get(db);
  if (!promise) {
    const statements = SCHEMA.split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .concat(PENDING_DELETIONS_SCHEMA)
      .map((statement) => db.prepare(statement));
    promise = db.batch(statements).catch((error: unknown) => {
      ready.delete(db);
      throw error;
    });
    ready.set(db, promise);
  }
  return promise;
}

export const now = (): number => Math.floor(Date.now() / 1000);

export async function saveAccount(
  db: D1Database,
  {
    id,
    name,
    email = null,
    pictureUrl = null
  }: { id: string; name: string; email?: string | null; pictureUrl?: string | null }
): Promise<void> {
  await db
    .prepare(
      // Never for a deleted user: a request that passed the revocation check
      // before user.deleted landed must not restore the scrubbed profile.
      `INSERT INTO accounts (id, name, email, picture_url)
       SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM revocations WHERE subject = ? AND organization_id = '*')
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email,
         picture_url = excluded.picture_url, updated_at = unixepoch()`
    )
    .bind(id, name, email, pictureUrl, id)
    .run();
}

export async function findAccount(
  db: D1Database,
  id: string,
  maxAgeSeconds: number | null = null
): Promise<Account | null> {
  const row = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first<AccountRow>();
  if (!row) return null;
  if (maxAgeSeconds !== null && row.updated_at < now() - maxAgeSeconds) return null;
  const flags: string[] = JSON.parse(row.flags || "[]");
  return { ...row, flags };
}

export async function findWorkspace(db: D1Database, organizationId: string): Promise<WorkspaceRow | null> {
  return db.prepare("SELECT * FROM workspaces WHERE organization_id = ?").bind(organizationId).first<WorkspaceRow>();
}

export async function findWorkspaceByHandle(db: D1Database, handle: string): Promise<WorkspaceRow | null> {
  return db.prepare("SELECT * FROM workspaces WHERE handle = ?").bind(handle).first<WorkspaceRow>();
}

export async function saveWorkspace(
  db: D1Database,
  {
    organizationId,
    handle,
    name,
    createdBy = null
  }: { organizationId: string; handle: string; name: string; createdBy?: string | null }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO workspaces (organization_id, handle, name, created_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (organization_id) DO UPDATE SET name = excluded.name, updated_at = unixepoch()`
    )
    .bind(organizationId, handle, name, createdBy)
    .run();
}

export async function hasFreshMembership(
  db: D1Database,
  userId: string,
  organizationId: string,
  maxAgeSeconds: number
): Promise<{ role: string | null } | null> {
  const row = await db
    .prepare("SELECT role FROM memberships WHERE user_id = ? AND organization_id = ? AND checked_at > ?")
    .bind(userId, organizationId, now() - maxAgeSeconds)
    .first<{ role: string | null }>();
  return row ? { role: row.role } : null;
}

// Membership state is versioned. Every change signal (webhook, join,
// removal) bumps the epoch first; a reader that fetched from WorkOS may only
// write what it saw if the epoch is still the one it started with, so a slow,
// stale lookup can never overwrite a newer change.
export async function membershipEpoch(db: D1Database, userId: string, organizationId: string): Promise<number> {
  const row = await db
    .prepare("SELECT epoch FROM membership_epochs WHERE user_id = ? AND organization_id = ?")
    .bind(userId, organizationId)
    .first<{ epoch: number }>();
  return row?.epoch ?? 0;
}

// Bumps the epoch and drops the cached membership; returns the new epoch.
export async function bumpMembershipEpoch(db: D1Database, userId: string, organizationId: string): Promise<number> {
  const [bumped] = await db.batch<{ epoch: number }>([
    db
      .prepare(
        `INSERT INTO membership_epochs (user_id, organization_id, epoch) VALUES (?, ?, 1)
         ON CONFLICT (user_id, organization_id) DO UPDATE SET epoch = epoch + 1 RETURNING epoch`
      )
      .bind(userId, organizationId),
    db.prepare("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?").bind(userId, organizationId)
  ]);
  const epoch = bumped?.results[0]?.epoch;
  if (epoch === undefined) throw new Error("Membership epoch was not returned.");
  return epoch;
}

const EPOCH_IS = "COALESCE((SELECT epoch FROM membership_epochs WHERE user_id = ? AND organization_id = ?), 0) = ?";

// Caches a WorkOS answer, only if no change happened since `epoch` was read.
export async function saveMembership(
  db: D1Database,
  userId: string,
  organizationId: string,
  active: boolean,
  role: string | null,
  epoch: number
): Promise<void> {
  if (active) {
    await db
      .prepare(
        `INSERT INTO memberships (user_id, organization_id, role, checked_at)
         SELECT ?, ?, ?, ? WHERE ${EPOCH_IS}
           AND NOT EXISTS (SELECT 1 FROM deleted_workspaces WHERE organization_id = ?)
         ON CONFLICT (user_id, organization_id) DO UPDATE SET role = excluded.role, checked_at = excluded.checked_at`
      )
      .bind(userId, organizationId, role, now(), userId, organizationId, epoch, organizationId)
      .run();
  } else {
    await forgetMembership(db, userId, organizationId);
  }
}

// Reconciles the per-workspace revocation to what WorkOS said, only if this
// is still the newest change signal.
export async function setRevokedAtEpoch(
  db: D1Database,
  userId: string,
  organizationId: string,
  revoked: boolean,
  epoch: number
): Promise<void> {
  if (revoked) {
    await db
      .prepare(
        `INSERT INTO revocations (subject, organization_id) SELECT ?, ? WHERE ${EPOCH_IS} ON CONFLICT DO NOTHING`
      )
      .bind(userId, organizationId, userId, organizationId, epoch)
      .run();
  } else {
    await db
      .prepare(`DELETE FROM revocations WHERE subject = ? AND organization_id = ? AND ${EPOCH_IS}`)
      .bind(userId, organizationId, userId, organizationId, epoch)
      .run();
  }
}

export async function forgetMembership(db: D1Database, userId: string, organizationId: string): Promise<void> {
  await db
    .prepare("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?")
    .bind(userId, organizationId)
    .run();
}

// subjects: user, API key, or session ids; any revoked one denies. Pass
// organizationId '*' for the everywhere-revocations.
export async function isRevoked(
  db: D1Database,
  subjects: (string | null | undefined)[],
  organizationId: string
): Promise<boolean> {
  const list = subjects.filter(Boolean);
  if (!list.length) return false;
  const marks = list.map(() => "?").join(", ");
  const row = await db
    .prepare(`SELECT 1 FROM revocations WHERE subject IN (${marks}) AND organization_id = ? LIMIT 1`)
    .bind(...list, organizationId)
    .first();
  return Boolean(row);
}

// organizationId '*' revokes everywhere (user deleted, session revoked) and
// is one-way; per-organization rows follow WorkOS membership.
export async function setRevoked(
  db: D1Database,
  subject: string,
  organizationId: string,
  revoked: boolean
): Promise<void> {
  if (revoked) {
    await db.batch([
      db
        .prepare("DELETE FROM memberships WHERE user_id = ? AND (? = '*' OR organization_id = ?)")
        .bind(subject, organizationId, organizationId),
      db
        .prepare("INSERT INTO revocations (subject, organization_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .bind(subject, organizationId)
    ]);
  } else {
    await db
      .prepare("DELETE FROM revocations WHERE subject = ? AND organization_id = ?")
      .bind(subject, organizationId)
      .run();
  }
}

// Someone removed from a workspace (by an admin, the directory, or WorkOS)
// cannot rejoin through an invite code until an admin reinstates them.
// Written and cleared under the same membership epoch as revocations.
export async function setRemovedAtEpoch(
  db: D1Database,
  userId: string,
  organizationId: string,
  removed: boolean,
  epoch: number
): Promise<void> {
  const sql = removed
    ? `INSERT INTO removed_members (user_id, organization_id) SELECT ?, ? WHERE ${EPOCH_IS} ON CONFLICT DO NOTHING`
    : `DELETE FROM removed_members WHERE user_id = ? AND organization_id = ? AND ${EPOCH_IS}`;
  await db.prepare(sql).bind(userId, organizationId, userId, organizationId, epoch).run();
}

export async function isRemoved(db: D1Database, userId: string, organizationId: string): Promise<boolean> {
  return Boolean(
    await db
      .prepare("SELECT 1 FROM removed_members WHERE user_id = ? AND organization_id = ?")
      .bind(userId, organizationId)
      .first()
  );
}
