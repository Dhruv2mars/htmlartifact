import { draftUrl } from "./public-url.js";

// Artifact feeds, newest first, always scoped to one workspace. Shared by
// GET /api/drafts and the web dashboard.

// "Mine": what this member published in this workspace.
export function listMyDrafts(db, { accountId, organizationId, origin, handle }) {
  return listDrafts(db, "d.account_id = ? AND d.organization_id = ?", [accountId, organizationId], {
    origin,
    handle
  });
}

// "Workspace": everything any member published in this workspace.
export function listWorkspaceDrafts(db, { organizationId, origin, handle, limit = 200 }) {
  return listDrafts(db, "d.organization_id = ?", [organizationId], { origin, handle, limit });
}

async function listDrafts(db, where, params, { origin, handle, limit = 500 }) {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.slug, d.title, d.description, d.repo_org, d.repo_name, d.repo_host,
              d.created_at, d.updated_at, a.name AS author_name,
              cv.version_number AS latest_version_number, cv.created_at AS latest_version_at,
              (SELECT COUNT(*) FROM draft_versions v WHERE v.draft_id = d.id) AS version_count
       FROM drafts d
       LEFT JOIN draft_versions cv ON cv.id = d.current_version_id
       LEFT JOIN accounts a ON a.id = d.account_id
       WHERE ${where} AND d.deleted_at IS NULL
       ORDER BY d.updated_at DESC
       LIMIT ${Number(limit)}`
    )
    .bind(...params)
    .all();

  return results.map((row) => ({
    draftId: row.id,
    slug: row.slug ?? null,
    title: row.title,
    description: row.description,
    author: row.author_name,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
    repoHost: row.repo_host,
    latestVersionNumber: row.latest_version_number ?? null,
    versionCount: Number(row.version_count),
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    publicUrl: draftUrl(origin, row, handle)
  }));
}

export async function getMyDraftWithVersions(db, { accountId, organizationId, draftId, origin, handle }) {
  const draft = await db
    .prepare(
      "SELECT * FROM drafts WHERE id = ? AND account_id = ? AND organization_id = ? AND deleted_at IS NULL"
    )
    .bind(draftId, accountId, organizationId)
    .first();
  if (!draft) return null;
  const { results } = await db
    .prepare(
      `SELECT id, version_number, created_at, git_branch, git_commit_sha, git_commit_subject, git_dirty, file_size
       FROM draft_versions WHERE draft_id = ? ORDER BY version_number DESC`
    )
    .bind(draftId)
    .all();
  return {
    draft: {
      draftId: draft.id,
      title: draft.title,
      description: draft.description,
      publicUrl: draftUrl(origin, draft, handle),
      // Version links use the draft ID, which never moves to another draft.
      versionBaseUrl: `${origin}/d/${draft.id}`
    },
    versions: results.map((v) => ({ ...v, created_at: isoTime(v.created_at) }))
  };
}

export function isoTime(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}
