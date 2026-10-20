// Shared types: the Worker's bindings, per-request variables, the viewer,
// and the D1 rows the server reads.

// Bindings from wrangler.toml (DB, ARTIFACTS, vars) and `wrangler secret put`.
// Every var is optional: getConfig applies defaults and reports what is
// missing.
export interface Env {
  DB: D1Database;
  // Optional: without it artifact HTML lives in D1 (src/storage.ts).
  ARTIFACTS?: R2Bucket;
  HTMLARTIFACT_PUBLIC_BASE_URL?: string;
  HTMLARTIFACT_SANDBOX_ORIGIN?: string;
  /** "sandbox" on the usercontent deployment: every host it answers serves only the sandbox. */
  HTMLARTIFACT_SERVE?: string;
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
  // "on" once WorkOS has enabled AuthKit Directory Provisioning for this
  // environment; until then Directory Sync setup links are refused.
  HTMLARTIFACT_DIRECTORY_PROVISIONING?: string;
  // "on" to offer SSO and Directory Sync setup links. WorkOS bills each SSO or
  // directory connection (per month), so they are off unless chosen.
  HTMLARTIFACT_ENTERPRISE_CONNECTIONS?: string;
  // Storage guards (bytes): HTML per workspace, and the D1 database size at
  // which uploads stop (D1 Free caps a database at 500 MB).
  HTMLARTIFACT_WORKSPACE_QUOTA_BYTES?: string;
  HTMLARTIFACT_DATABASE_LIMIT_BYTES?: string;
  // Service binding to the ops Worker's `Ops` entrypoint (src/ops.ts). When
  // absent (local dev, tests), rate limits fall back to an in-memory window.
  OPS?: OpsService;
  // The web app's static assets (web/build/client). Pages serves /assets/*
  // and the public files itself (_routes.json); this covers the rest.
  ASSETS?: Fetcher;
}

// What the Pages app calls on the ops Worker over RPC.
// Which ops limiter counts a call (bindings in deploy/ops/wrangler.toml):
//   "upload"  most authenticated API calls, per user
//   "auth"    sign-in steps, keyed per device code / refresh token / join
//   "auth-ip" the looser per-IP ceiling over every sign-in step
//   "api-key" non-JWT bearer values sent to WorkOS for validation, per IP
export type LimitKind = "upload" | "auth" | "auth-ip" | "api-key";

export interface OpsService {
  limit(kind: LimitKind, key: string): Promise<boolean>;
}

export interface Config {
  publicBaseUrl: string | null;
  sandboxOrigin: string | null;
  cookiePassword: string;
  limits: { accountBytes: number; largeBytes: number; maxPages: number; workspaceBytes: number; databaseBytes: number };
  workos: {
    apiKey: string;
    clientId: string;
    apiUrl: string;
    issuer: string | null;
    webhookSecret: string | null;
    membershipCacheSeconds: number;
    directoryProvisioning: boolean;
    enterpriseConnections: boolean;
  };
  invites: { ttlDays: number; maxUses: number };
}

// Per-request variables. `viewer` is set by the auth middleware
// (requireUser / requireMember in api.ts, signedIn in web.ts).
interface Vars {
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

export interface CiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  token_hash: string;
  created_by: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
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
  updated_by_name: string | null;
  latest_version_number: number | null;
  latest_version_at: number | null;
  version_count: number;
}
