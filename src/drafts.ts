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
  // Who published the current version (an admin or CI key can update a
  // teammate's artifact, which keeps its author).
  updatedBy: string | null;
  // The author was removed from the workspace, left it, or was deleted.
  authorFormer: boolean;
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
    author: string | null;
    mine: boolean;
    publicUrl: string;
    versionBaseUrl: string;
  };
  versions: VersionSummary[];
}

interface FeedOptions {
  origin: string;
  handle: string;
  limit?: number;
  // From the previous page's `nextCursor`.
  cursor?: string | null;
  // Exactly the artifact at this custom URL (at most one).
  slug?: string | null;
}

// One page of a feed; `nextCursor` is null on the last page.
export interface DraftPage {
  drafts: DraftSummary[];
  nextCursor: string | null;
}

const FEED_PAGE_SIZE = 100;

// "Mine": what this member published in this workspace.
export function listMyDrafts(
  db: D1Database,
  { accountId, organizationId, ...options }: FeedOptions & { accountId: string; organizationId: string }
): Promise<DraftPage> {
  return listDrafts(db, "d.account_id = ? AND d.organization_id = ?", [accountId, organizationId], options);
}

// "Workspace": everything any member published in this workspace.
export function listWorkspaceDrafts(
  db: D1Database,
  { organizationId, ...options }: FeedOptions & { organizationId: string }
): Promise<DraftPage> {
  return listDrafts(db, "d.organization_id = ?", [organizationId], options);
}

// Keyset pages, newest first: the cursor is the last row's (updated_at, id),
// so a page never skips or repeats an artifact when others are published
// meanwhile (an artifact updated meanwhile moves to the top).
const encodeCursor = (updatedAt: number, id: string) => `${updatedAt}.${id}`;
function decodeCursor(cursor: string | null | undefined): [number, string] | null {
  const match = cursor ? /^(\d{1,12})\.([A-Za-z0-9_-]{1,64})$/.exec(cursor) : null;
  return match ? [Number(match[1]), match[2]!] : null;
}

async function listDrafts(
  db: D1Database,
  where: string,
  params: (string | number)[],
  { origin, handle, limit = FEED_PAGE_SIZE, cursor, slug }: FeedOptions
): Promise<DraftPage> {
  const after = decodeCursor(cursor);
  const size = Math.min(Math.max(1, Math.floor(limit)), 500);
  const { results } = await db
    .prepare(
      `SELECT d.id, d.slug, d.title, d.description, d.repo_org, d.repo_name, d.repo_host,
              d.created_at, d.updated_at, a.name AS author_name, u.name AS updated_by_name,
              (d.account_id NOT LIKE 'api_key_%' AND EXISTS (SELECT 1 FROM revocations r
                 WHERE r.subject = d.account_id AND r.organization_id IN (d.organization_id, '*'))) AS author_former,
              cv.version_number AS latest_version_number, cv.created_at AS latest_version_at,
              (SELECT COUNT(*) FROM draft_versions v WHERE v.draft_id = d.id) AS version_count
       FROM drafts d
       LEFT JOIN draft_versions cv ON cv.id = d.current_version_id
       LEFT JOIN accounts a ON a.id = d.account_id
       LEFT JOIN accounts u ON u.id = cv.created_by
       WHERE ${where} AND d.deleted_at IS NULL
         ${slug ? "AND d.slug = ?" : ""}
         ${after ? "AND (d.updated_at < ? OR (d.updated_at = ? AND d.id < ?))" : ""}
       ORDER BY d.updated_at DESC, d.id DESC
       LIMIT ${size + 1}`
    )
    .bind(...params, ...(slug ? [slug] : []), ...(after ? [after[0], after[0], after[1]] : []))
    .all<DraftListRow>();
  const more = results.length > size;
  const rows = more ? results.slice(0, size) : results;
  const last = rows.at(-1);
  const nextCursor = more && last ? encodeCursor(Number(last.updated_at), last.id) : null;

  return { nextCursor, drafts: rows.map((row) => ({
    draftId: row.id,
    slug: row.slug ?? null,
    title: row.title,
    description: row.description,
    author: row.author_name,
    updatedBy: row.updated_by_name,
    authorFormer: Boolean(row.author_former),
    repoOrg: row.repo_org,
    repoName: row.repo_name,
    repoHost: row.repo_host,
    latestVersionNumber: row.latest_version_number ?? null,
    versionCount: Number(row.version_count),
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    publicUrl: draftUrl(origin, row, handle)
  })) };
}

// One artifact of this workspace with its versions, whoever published it.
export async function getDraftWithVersions(
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
      `SELECT d.*, a.name AS author_name FROM drafts d LEFT JOIN accounts a ON a.id = d.account_id
       WHERE d.id = ? AND d.organization_id = ? AND d.deleted_at IS NULL`
    )
    .bind(draftId, organizationId)
    .first<DraftRow & { author_name: string | null }>();
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
      author: draft.author_name,
      mine: draft.account_id === accountId,
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
