import { draftUrl } from "./public-url.ts";
import type { DraftListRow, DraftRow, VersionRow } from "./types.ts";

// Artifact feeds, newest first, always scoped to one workspace. Shared by
// GET /api/drafts and the web dashboard.

// One artifact in a feed, as the API and the web pages show it.
export interface DraftSummary {
  draftId: string;
  slug: string | null;
  title: string;
  description: string | null;
  author: string | null;
  repoOrg: string | null;
  repoName: string | null;
  repoHost: string | null;
  latestVersionNumber: number | null;
  versionCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  publicUrl: string;
}

type VersionSummary = Pick<
  VersionRow,
  "id" | "version_number" | "git_branch" | "git_commit_sha" | "git_commit_subject" | "git_dirty" | "file_size"
> & { created_at: string | null };

export interface DraftWithVersions {
  draft: {
    draftId: string;
    title: string;
    description: string | null;
    publicUrl: string;
    versionBaseUrl: string;
  };
  versions: VersionSummary[];
}

interface FeedOptions {
  origin: string;
  handle: string;
  limit?: number;
}

// "Mine": what this member published in this workspace.
export function listMyDrafts(
  db: D1Database,
  {
    accountId,
    organizationId,
    origin,
    handle
  }: { accountId: string; organizationId: string; origin: string; handle: string }
): Promise<DraftSummary[]> {
  return listDrafts(db, "d.account_id = ? AND d.organization_id = ?", [accountId, organizationId], {
    origin,
    handle
  });
}

// "Workspace": everything any member published in this workspace.
export function listWorkspaceDrafts(
  db: D1Database,
  { organizationId, origin, handle, limit = 200 }: FeedOptions & { organizationId: string }
): Promise<DraftSummary[]> {
  return listDrafts(db, "d.organization_id = ?", [organizationId], { origin, handle, limit });
}

async function listDrafts(
  db: D1Database,
  where: string,
  params: string[],
  { origin, handle, limit = 500 }: FeedOptions
): Promise<DraftSummary[]> {
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
    .all<DraftListRow>();

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

export async function getMyDraftWithVersions(
  db: D1Database,
  {
    accountId,
    organizationId,
    draftId,
    origin,
    handle
  }: { accountId: string; organizationId: string; draftId: string; origin: string; handle: string }
): Promise<DraftWithVersions | null> {
  const draft = await db
    .prepare(
      "SELECT * FROM drafts WHERE id = ? AND account_id = ? AND organization_id = ? AND deleted_at IS NULL"
    )
    .bind(draftId, accountId, organizationId)
    .first<DraftRow>();
  if (!draft) return null;
  const { results } = await db
    .prepare(
      `SELECT id, version_number, created_at, git_branch, git_commit_sha, git_commit_subject, git_dirty, file_size
       FROM draft_versions WHERE draft_id = ? ORDER BY version_number DESC`
    )
    .bind(draftId)
    .all<Pick<VersionRow, keyof VersionSummary>>();
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

function isoTime(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}
