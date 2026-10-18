// Shared types: the Worker's bindings, per-request variables, the viewer,
// and the D1 rows the server reads.

// Bindings from wrangler.toml (DB, ARTIFACTS, vars) and `wrangler secret put`.
// Every var is optional: getConfig applies defaults and reports what is
// missing.
export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  HTMLARTIFACT_PUBLIC_BASE_URL?: string;
  HTMLARTIFACT_SANDBOX_ORIGIN?: string;
  HTMLARTIFACT_COOKIE_PASSWORD?: string;
  HTMLARTIFACT_MEMBERSHIP_CACHE_SECONDS?: string;
  HTMLARTIFACT_INVITE_TTL_DAYS?: string;
  HTMLARTIFACT_INVITE_MAX_USES?: string;
  MAX_ACCOUNT_HTML_BYTES?: string;
  MAX_LARGE_HTML_BYTES?: string;
  MAX_PAGES_PER_UPLOAD?: string;
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_URL?: string;
  WORKOS_ISSUER?: string;
  WORKOS_WEBHOOK_SECRET?: string;
}

export interface Config {
  publicBaseUrl: string | null;
  sandboxOrigin: string | null;
  cookiePassword: string;
  limits: { accountBytes: number; largeBytes: number; maxPages: number };
  workos: {
    apiKey: string;
    clientId: string;
    apiUrl: string;
    issuer: string | null;
    webhookSecret: string | null;
    membershipCacheSeconds: number;
  };
  invites: { ttlDays: number; maxUses: number };
}

// Per-request variables. `viewer` is set by the auth middleware
// (requireUser / requireMember in api.ts, signedIn in web.ts).
export interface Vars {
  config: Config;
  origin: string;
  viewer: Viewer | undefined;
}

export interface AppEnv {
  Bindings: Env;
  Variables: Vars;
}

// Who is calling; see auth.ts. organization_id (and so workspace) is null
// for a signed-in user who has not joined or created a workspace yet.
export interface Viewer {
  account_id: string;
  account_name: string;
  email: string | null;
  picture_url: string | null;
  organization_id: string | null;
  workspace: WorkspaceRow | null;
  role: string | null;
  flags: string[];
  credential_id: string | null;
  is_api_key: boolean;
}

// A viewer inside a workspace: what requireMember and inWorkspace let through.
export interface MemberViewer extends Viewer {
  organization_id: string;
  workspace: WorkspaceRow;
}

export function isMember(viewer: Viewer): viewer is MemberViewer {
  return Boolean(viewer.organization_id && viewer.workspace);
}

// Context env for handlers behind requireUser / signedIn.
export interface UserEnv {
  Bindings: Env;
  Variables: Vars & { viewer: Viewer };
}

// Context env for handlers behind requireMember / inWorkspace.
export interface MemberEnv {
  Bindings: Env;
  Variables: Vars & { viewer: MemberViewer };
}

// ---- D1 rows (src/db.ts has the schema). Times are unix seconds.

export interface AccountRow {
  id: string;
  name: string;
  email: string | null;
  picture_url: string | null;
  flags: string;
  created_at: number;
  updated_at: number;
}

// An account with its flags parsed.
export interface Account extends Omit<AccountRow, "flags"> {
  flags: string[];
}

export interface WorkspaceRow {
  organization_id: string;
  handle: string;
  name: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface DraftRow {
  id: string;
  account_id: string;
  organization_id: string;
  title: string;
  description: string | null;
  current_version_id: string | null;
  repo_org: string | null;
  repo_name: string | null;
  repo_host: string | null;
  slug: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface VersionRow {
  id: string;
  draft_id: string;
  version_number: number;
  object_key: string;
  content_hash: string;
  file_size: number;
  page_count: number;
  has_inline_script: number;
  created_by: string;
  credential_id: string | null;
  source_ip: string | null;
  user_agent: string | null;
  cli_version: string | null;
  git_branch: string | null;
  git_commit_sha: string | null;
  git_commit_subject: string | null;
  git_dirty: number | null;
  original_filename: string | null;
  ci_run_url: string | null;
  created_at: number;
}

export interface PageRow {
  draft_version_id: string;
  path: string;
  object_key: string;
  content_hash: string;
  file_size: number;
  title: string | null;
  has_inline_script: number;
}

// A row of the artifact feed query in drafts.ts.
export interface DraftListRow
  extends Pick<
    DraftRow,
    "id" | "slug" | "title" | "description" | "repo_org" | "repo_name" | "repo_host" | "created_at" | "updated_at"
  > {
  author_name: string | null;
  latest_version_number: number | null;
  latest_version_at: number | null;
  version_count: number;
}
