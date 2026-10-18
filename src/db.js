import pg from "pg";
import { config, requireEnv } from "./config.js";
import { newInternalId } from "./ids.js";

const { Pool } = pg;

// Per-account feature flags, stored in accounts.flags. Set them with SQL:
//   UPDATE accounts SET flags = ARRAY['large-uploads'] WHERE email = '...';
export const FLAGS = {
  largeUploads: "large-uploads"
};

export const pool = new Pool({
  connectionString: requireEnv("DATABASE_URL", config.databaseUrl)
});

export async function initDb() {
  await pool.query(`
    -- People and machine credentials that publish. id is the WorkOS user id
    -- (user_...) or, for CI, the WorkOS API key id (api_key_...). Profile
    -- columns are a cache of WorkOS, refreshed by src/auth.js.
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      picture_url TEXT,
      flags TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Cache of WorkOS organization names; WorkOS stays the source of truth.
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Access removed in WorkOS (webhooks), honoured before tokens expire.
    -- organization_id '*' means every organization (user deleted).
    CREATE TABLE IF NOT EXISTS revocations (
      subject TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (subject, organization_id)
    );

    -- Verified WorkOS memberships. A token's org claim is only trusted once
    -- WorkOS confirms the membership; rows expire after a few minutes.
    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, organization_id)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      organization_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      current_version_id TEXT,
      repo_org TEXT,
      repo_name TEXT,
      repo_host TEXT,
      slug TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      disabled_at TIMESTAMPTZ,
      disabled_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS draft_versions (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL REFERENCES drafts(id),
      version_number INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT NOT NULL REFERENCES accounts(id),
      credential_id TEXT,
      source_ip TEXT,
      user_agent TEXT,
      cli_version TEXT,
      git_branch TEXT,
      git_commit_sha TEXT,
      git_commit_subject TEXT,
      git_dirty BOOLEAN,
      original_filename TEXT,
      request_id TEXT,
      has_inline_script BOOLEAN,
      external_image_hosts JSONB,
      ci_run_url TEXT,
      ci_actor TEXT,
      page_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE (draft_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS upload_events (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL REFERENCES drafts(id),
      draft_version_id TEXT REFERENCES draft_versions(id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      organization_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_ip TEXT,
      user_agent TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Pages of a multi-page version other than index.html, which stays on
    -- draft_versions.object_key so single-page versions need no rows here.
    CREATE TABLE IF NOT EXISTS draft_pages (
      draft_version_id TEXT NOT NULL REFERENCES draft_versions(id),
      path TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      title TEXT,
      has_inline_script BOOLEAN NOT NULL,
      PRIMARY KEY (draft_version_id, path)
    );

    CREATE INDEX IF NOT EXISTS draft_versions_draft_id_idx ON draft_versions(draft_id);
    CREATE INDEX IF NOT EXISTS upload_events_draft_id_idx ON upload_events(draft_id);
    CREATE INDEX IF NOT EXISTS drafts_account_org_idx ON drafts(account_id, organization_id);
    CREATE INDEX IF NOT EXISTS drafts_org_updated_idx ON drafts(organization_id, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS drafts_org_slug_idx ON drafts(organization_id, slug);
    -- Slugs used to be globally unique; that index leaked other teams' slugs.
    DROP INDEX IF EXISTS drafts_slug_idx;
  `);
}

// Upserts the cached profile for an account. Called with fresh WorkOS data.
export async function saveAccount({ id, name, email = null, pictureUrl = null }) {
  await pool.query(
    `
      INSERT INTO accounts (id, name, email, picture_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email,
            picture_url = EXCLUDED.picture_url, updated_at = now()
    `,
    [id, name, email, pictureUrl]
  );
}

export async function saveOrganization({ id, name }) {
  await pool.query(
    `
      INSERT INTO organizations (id, name) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
    `,
    [id, name]
  );
}

export async function findAccount(id) {
  const result = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

// Cached rows younger than maxAgeSeconds, or null (missing or stale).
export async function findFreshAccount(id, maxAgeSeconds) {
  const result = await pool.query(
    `SELECT * FROM accounts WHERE id = $1 AND updated_at > now() - make_interval(secs => $2)`,
    [id, maxAgeSeconds]
  );
  return result.rows[0] || null;
}

export async function findFreshOrganization(id, maxAgeSeconds) {
  const result = await pool.query(
    `SELECT * FROM organizations WHERE id = $1 AND updated_at > now() - make_interval(secs => $2)`,
    [id, maxAgeSeconds]
  );
  return result.rows[0] || null;
}

export async function hasFreshMembership(userId, organizationId, maxAgeSeconds) {
  const result = await pool.query(
    `SELECT 1 FROM memberships
     WHERE user_id = $1 AND organization_id = $2 AND checked_at > now() - make_interval(secs => $3)`,
    [userId, organizationId, maxAgeSeconds]
  );
  return result.rowCount > 0;
}

export async function saveMembership(userId, organizationId, active) {
  if (active) {
    await pool.query(
      `INSERT INTO memberships (user_id, organization_id) VALUES ($1, $2)
       ON CONFLICT (user_id, organization_id) DO UPDATE SET checked_at = now()`,
      [userId, organizationId]
    );
  } else {
    await pool.query(`DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2`, [
      userId,
      organizationId
    ]);
  }
}

export async function forgetMembership(userId, organizationId) {
  await pool.query(`DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2`, [
    userId,
    organizationId
  ]);
}

// subjects: user, API key, or session ids; any revoked one denies.
export async function isRevoked(subjects, organizationId) {
  const result = await pool.query(
    `SELECT 1 FROM revocations WHERE subject = ANY($1) AND organization_id IN ($2, '*') LIMIT 1`,
    [subjects.filter(Boolean), organizationId]
  );
  return result.rowCount > 0;
}

export async function setRevoked(subject, organizationId, revoked) {
  if (revoked) {
    await pool.query(
      `DELETE FROM memberships WHERE user_id = $1 AND ($2 = '*' OR organization_id = $2)`,
      [subject, organizationId]
    );
    await pool.query(
      `INSERT INTO revocations (subject, organization_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [subject, organizationId]
    );
  } else {
    // Only the per-organization row: user-wide ('*') revocations are one-way.
    await pool.query(`DELETE FROM revocations WHERE subject = $1 AND organization_id = $2`, [
      subject,
      organizationId
    ]);
  }
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function newEventId() {
  return newInternalId();
}
