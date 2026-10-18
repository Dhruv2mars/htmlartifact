import { pool } from "./db.js";
import { config } from "./config.js";
import { getDraftPublicUrl, getDraftRawUrl } from "./public-url.js";

// Draft feeds, newest first, with the aggregates a dashboard needs (latest
// version, version count, repo, author). Shared by GET /api/drafts and the
// server-rendered dashboards. Both are always scoped to one organization.

// "Mine": what this member published in this organization.
export function listAccountDrafts(accountId, organizationId, { requestBaseUrl }) {
  return listDrafts("d.account_id = $1 AND d.organization_id = $2", [accountId, organizationId], {
    requestBaseUrl
  });
}

// "Workspace": everything any member published in this organization.
export function listWorkspaceDrafts(organizationId, { requestBaseUrl, limit = 200 }) {
  return listDrafts("d.organization_id = $1", [organizationId], { requestBaseUrl, limit });
}

async function listDrafts(where, params, { requestBaseUrl, limit = 500 }) {
  const result = await pool.query(
    `
      SELECT
        d.id,
        a.name AS author_name,
        d.slug,
        d.title,
        d.description,
        d.repo_org,
        d.repo_name,
        d.repo_host,
        d.created_at,
        d.updated_at,
        d.disabled_at,
        cv.version_number AS latest_version_number,
        cv.created_at AS latest_version_at,
        COALESCE(vc.version_count, 0) AS version_count
      FROM drafts d
      LEFT JOIN draft_versions cv ON cv.id = d.current_version_id
      LEFT JOIN (
        SELECT draft_id, COUNT(*)::int AS version_count
        FROM draft_versions
        GROUP BY draft_id
      ) vc ON vc.draft_id = d.id
      JOIN accounts a ON a.id = d.account_id
      WHERE ${where}
        AND d.deleted_at IS NULL
      ORDER BY d.updated_at DESC
      LIMIT ${Number(limit)}
    `,
    params
  );

  return result.rows.map((row) => ({
    draftId: row.id,
    slug: row.slug ?? null,
    author: row.author_name,
    title: row.title,
    description: row.description,
    repoOrg: row.repo_org,
    repoName: row.repo_name,
    repoHost: row.repo_host,
    latestVersionNumber:
      row.latest_version_number === null ? null : Number(row.latest_version_number),
    versionCount: Number(row.version_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersionAt: row.latest_version_at,
    disabled: Boolean(row.disabled_at),
    publicUrl: getDraftPublicUrl({
      draftId: row.slug || row.id,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl
    }),
    rawUrl: getDraftRawUrl({
      draftId: row.slug || row.id,
      publicBaseUrl: config.publicBaseUrl,
      requestBaseUrl
    })
  }));
}

export async function getAccountDraftWithVersions(accountId, organizationId, draftId, { requestBaseUrl }) {
  const draftResult = await pool.query(
    `
      SELECT *
      FROM drafts
      WHERE id = $1 AND account_id = $2 AND organization_id = $3 AND deleted_at IS NULL
      LIMIT 1
    `,
    [draftId, accountId, organizationId]
  );
  const draft = draftResult.rows[0];
  if (!draft) return null;

  const versionsResult = await pool.query(
    `
      SELECT id, version_number, created_at, git_branch, git_commit_sha,
             git_commit_subject, git_dirty, file_size
      FROM draft_versions
      WHERE draft_id = $1
      ORDER BY version_number DESC
    `,
    [draftId]
  );

  return {
    draft: {
      draftId: draft.id,
      title: draft.title,
      description: draft.description,
      publicUrl: getDraftPublicUrl({
        draftId: draft.slug || draft.id,
        publicBaseUrl: config.publicBaseUrl,
        requestBaseUrl
      }),
      // Version links use the draft ID, which never moves to another draft.
      versionBaseUrl: getDraftPublicUrl({
        draftId: draft.id,
        publicBaseUrl: config.publicBaseUrl,
        requestBaseUrl
      })
    },
    versions: versionsResult.rows
  };
}
