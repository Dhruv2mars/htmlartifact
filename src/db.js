// D1 (SQLite) access. The schema is created on first use by each isolate, so
// a fresh deployment needs no migration step. Times are unix seconds.

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
`;

const ready = new WeakMap();

// Runs the idempotent schema once per isolate and D1 binding.
export function ensureSchema(db) {
  let promise = ready.get(db);
  if (!promise) {
    const statements = SCHEMA.split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement));
    promise = db.batch(statements).catch((error) => {
      ready.delete(db);
      throw error;
    });
    ready.set(db, promise);
  }
  return promise;
}

export const now = () => Math.floor(Date.now() / 1000);

export async function saveAccount(db, { id, name, email = null, pictureUrl = null }) {
  await db
    .prepare(
      `INSERT INTO accounts (id, name, email, picture_url) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email,
         picture_url = excluded.picture_url, updated_at = unixepoch()`
    )
    .bind(id, name, email, pictureUrl)
    .run();
}

export async function findAccount(db, id, maxAgeSeconds = null) {
  const row = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first();
  if (!row) return null;
  if (maxAgeSeconds !== null && row.updated_at < now() - maxAgeSeconds) return null;
  return { ...row, flags: JSON.parse(row.flags || "[]") };
}

export async function findWorkspace(db, organizationId) {
  return db.prepare("SELECT * FROM workspaces WHERE organization_id = ?").bind(organizationId).first();
}

export async function findWorkspaceByHandle(db, handle) {
  return db.prepare("SELECT * FROM workspaces WHERE handle = ?").bind(handle).first();
}

export async function saveWorkspace(db, { organizationId, handle, name, createdBy = null }) {
  await db
    .prepare(
      `INSERT INTO workspaces (organization_id, handle, name, created_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (organization_id) DO UPDATE SET name = excluded.name, updated_at = unixepoch()`
    )
    .bind(organizationId, handle, name, createdBy)
    .run();
}

export async function hasFreshMembership(db, userId, organizationId, maxAgeSeconds) {
  const row = await db
    .prepare("SELECT role FROM memberships WHERE user_id = ? AND organization_id = ? AND checked_at > ?")
    .bind(userId, organizationId, now() - maxAgeSeconds)
    .first();
  return row ? { role: row.role } : null;
}

export async function saveMembership(db, userId, organizationId, active, role = null) {
  if (active) {
    await db
      .prepare(
        `INSERT INTO memberships (user_id, organization_id, role, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, organization_id) DO UPDATE SET role = excluded.role, checked_at = excluded.checked_at`
      )
      .bind(userId, organizationId, role, now())
      .run();
  } else {
    await forgetMembership(db, userId, organizationId);
  }
}

export async function forgetMembership(db, userId, organizationId) {
  await db
    .prepare("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?")
    .bind(userId, organizationId)
    .run();
}

// subjects: user, API key, or session ids; any revoked one denies. Pass
// organizationId '*' for the everywhere-revocations.
export async function isRevoked(db, subjects, organizationId) {
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
export async function setRevoked(db, subject, organizationId, revoked) {
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
