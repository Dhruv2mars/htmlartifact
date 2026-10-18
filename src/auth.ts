import type { User } from "@workos-inc/node";
import type { Context } from "hono";
import {
  findAccount,
  findWorkspace,
  hasFreshMembership,
  isRevoked,
  membershipEpoch,
  saveAccount,
  saveMembership,
  saveWorkspace
} from "./db.ts";
import { workspaceHandle } from "./ids.ts";
import { isWorkspaceDeleted } from "./purge.ts";
import type { AppEnv, DraftRow, Viewer, WorkspaceRow } from "./types.ts";
import { clearSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from "./web-auth.ts";
import { displayName, validateApiKey, verifyAccessToken, workos, type AccessTokenClaims, type ApiKeyInfo } from "./workos.ts";

// Who is calling. Three credentials resolve to the same viewer shape:
//   browser → WorkOS sealed-session cookie (AuthKit sign-in)
//   CLI     → Bearer WorkOS access token (device sign-in, relayed by us)
//   CI      → Bearer WorkOS organization API key
//
// viewer = { account_id, account_name, email, picture_url, organization_id,
//            workspace, role, flags, credential_id }
// organization_id is null for a signed-in user who has not joined or
// created a workspace yet. Membership is always confirmed with WorkOS (cached
// briefly); a token's org claim alone is never trusted.

const PROFILE_CACHE_SECONDS = 3600;

// A browser session as authenticate() or refresh() reports it.
type SessionAuth =
  | { authenticated: false }
  | { authenticated: true; user: User; organizationId?: string; sessionId: string; sealedSession?: string };

// Bearer credential → viewer, or null. Never reads cookies, so /api calls
// cannot be driven cross-site.
export async function bearerViewer<E extends AppEnv>(c: Context<E>): Promise<Viewer | null> {
  const token = bearerToken(c);
  if (!token) return null;
  return looksLikeJwt(token) ? viewerFromAccessToken(c, token) : viewerFromApiKey(c, token);
}

// Browser session → viewer, or null. Refreshes an expired access token and,
// when `organizationId` names another workspace the user belongs to, moves
// the session there. Updated cookies are set on the response.
export async function sessionViewer<E extends AppEnv>(
  c: Context<E>,
  { organizationId }: { organizationId?: string | undefined } = {}
): Promise<Viewer | null> {
  const sealed = readCookie(c, SESSION_COOKIE);
  if (!sealed) return null;
  const config = c.get("config");
  const secure = isSecure(c);
  const session = workos(config).client.userManagement.loadSealedSession({
    sessionData: sealed,
    cookiePassword: config.cookiePassword
  });

  let auth: SessionAuth = await session.authenticate().catch(() => ({ authenticated: false as const }));
  const wantsSwitch =
    organizationId &&
    auth.authenticated &&
    auth.organizationId !== organizationId &&
    Boolean(await activeMembership(c, auth.user.id, organizationId));
  if (!auth.authenticated || wantsSwitch) {
    const refreshed: SessionAuth = await session
      .refresh(wantsSwitch ? { organizationId } : undefined)
      .catch(() => ({ authenticated: false as const }));
    if (refreshed.authenticated && refreshed.sealedSession) {
      c.header("Set-Cookie", sessionCookie(refreshed.sealedSession, secure), { append: true });
      auth = refreshed;
    } else if (!auth.authenticated) {
      c.header("Set-Cookie", clearSessionCookie(secure), { append: true });
      return null;
    }
  }

  const { user } = auth;
  // A deleted user's cookie may outlive them briefly: never re-cache their profile.
  if (await isRevoked(c.env.DB, [user.id], "*")) return null;
  await saveAccount(c.env.DB, {
    id: user.id,
    name: displayName(user),
    email: user.email,
    pictureUrl: user.profilePictureUrl
  });
  return buildViewer(c, {
    accountId: user.id,
    organizationId: auth.organizationId || null,
    credentialId: auth.sessionId
  });
}

// "member" | "anonymous" | "denied" for reading `draft` (may be null).
export async function canReadDraft<E extends AppEnv>(
  c: Context<E>,
  draft: DraftRow | null
): Promise<"member" | "anonymous" | "denied"> {
  if (bearerToken(c)) {
    const viewer = await bearerViewer(c);
    if (!viewer) return "anonymous";
    return draft && viewer.organization_id === draft.organization_id ? "member" : "denied";
  }
  if (!readCookie(c, SESSION_COOKIE)) return "anonymous";
  const viewer = await sessionViewer(c, { organizationId: draft?.organization_id });
  if (!viewer) return "anonymous";
  return draft && viewer.organization_id === draft.organization_id ? "member" : "denied";
}

// The caller's active membership in organizationId per WorkOS ({ role }), or
// null. Cached in D1 for membershipCacheSeconds; webhooks clear it.
export async function activeMembership<E extends AppEnv>(
  c: Context<E>,
  userId: string,
  organizationId: string
): Promise<{ role: string | null } | null> {
  const config = c.get("config");
  const cached = await hasFreshMembership(c.env.DB, userId, organizationId, config.workos.membershipCacheSeconds);
  if (cached) return cached;
  if (await isWorkspaceDeleted(c.env.DB, organizationId)) return null;
  const epoch = await membershipEpoch(c.env.DB, userId, organizationId);
  const page = await workos(config).client.userManagement.listOrganizationMemberships({
    userId,
    organizationId,
    statuses: ["active"],
    limit: 1
  });
  const membership = page.data.find((m) => m.organizationId === organizationId && m.status === "active");
  const role = membership?.role?.slug || null;
  await saveMembership(c.env.DB, userId, organizationId, Boolean(membership), role, epoch);
  return membership ? { role } : null;
}

// Workspace row for an organization, created from WorkOS on first sight.
export async function ensureWorkspace<E extends AppEnv>(c: Context<E>, organizationId: string): Promise<WorkspaceRow | null> {
  const existing = await findWorkspace(c.env.DB, organizationId);
  if (existing) return existing;
  // A deleted workspace is never re-created from WorkOS.
  if (await isWorkspaceDeleted(c.env.DB, organizationId)) return null;
  const organization = await workos(c.get("config")).client.organizations.getOrganization(organizationId);
  await saveWorkspace(c.env.DB, {
    organizationId,
    handle: workspaceHandle(organization.name),
    name: organization.name
  });
  return findWorkspace(c.env.DB, organizationId);
}

export function isSecure<E extends AppEnv>(c: Context<E>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

async function viewerFromAccessToken<E extends AppEnv>(c: Context<E>, token: string): Promise<Viewer | null> {
  let claims: AccessTokenClaims;
  try {
    claims = await verifyAccessToken(c.get("config"), token);
  } catch {
    return null;
  }
  if (await isRevoked(c.env.DB, [claims.sid], "*")) return null;
  await ensureAccount(c, claims.sub);
  return buildViewer(c, {
    accountId: claims.sub,
    organizationId: claims.org_id || null,
    credentialId: claims.sid
  });
}

async function viewerFromApiKey<E extends AppEnv>(c: Context<E>, value: string): Promise<Viewer | null> {
  let key: ApiKeyInfo | null;
  try {
    key = await validateApiKey(c.get("config"), value);
  } catch (error) {
    console.error("WorkOS API key validation failed:", error instanceof Error ? error.message : error);
    return null;
  }
  if (!key?.organizationId) return null;
  if (key.userId) {
    await ensureAccount(c, key.userId);
  } else if (!(await findAccount(c.env.DB, key.id, PROFILE_CACHE_SECONDS))) {
    await saveAccount(c.env.DB, { id: key.id, name: `${key.name} (API key)` });
  }
  return buildViewer(c, {
    accountId: key.userId || key.id,
    organizationId: key.organizationId,
    credentialId: key.id,
    ownedByOrganization: true
  });
}

async function buildViewer<E extends AppEnv>(
  c: Context<E>,
  {
    accountId,
    organizationId,
    credentialId,
    ownedByOrganization = false
  }: { accountId: string; organizationId: string | null; credentialId: string | null; ownedByOrganization?: boolean }
): Promise<Viewer | null> {
  const db = c.env.DB;
  let role: string | null = null;
  // Deleted users, revoked sessions and revoked keys: no access at all.
  if (await isRevoked(db, [accountId, credentialId], "*")) return null;
  if (organizationId) {
    // Removed from this workspace, or the workspace was deleted: still signed
    // in, just not a member. This holds for organization API keys too.
    if (
      (await isRevoked(db, [accountId, credentialId], organizationId)) ||
      (await isWorkspaceDeleted(db, organizationId))
    ) {
      organizationId = null;
    }
  }
  if (organizationId) {
    if (!ownedByOrganization) {
      const membership = await activeMembership(c, accountId, organizationId);
      // Not (or no longer) a member: still a signed-in user, but no workspace.
      if (!membership) organizationId = null;
      else role = membership.role;
    }
  }
  const account = await findAccount(db, accountId);
  const workspace = organizationId ? await ensureWorkspace(c, organizationId) : null;
  if (!workspace) {
    organizationId = null;
    role = null;
  }
  return {
    account_id: accountId,
    account_name: account?.name || accountId,
    email: account?.email || null,
    picture_url: account?.picture_url || null,
    organization_id: organizationId,
    workspace,
    role,
    flags: account?.flags || [],
    credential_id: credentialId || null,
    is_api_key: ownedByOrganization
  };
}

async function ensureAccount<E extends AppEnv>(c: Context<E>, userId: string): Promise<void> {
  if (await findAccount(c.env.DB, userId, PROFILE_CACHE_SECONDS)) return;
  // Deleted users are scrubbed and revoked; buildViewer turns them away.
  if (await isRevoked(c.env.DB, [userId], "*")) return;
  const user = await workos(c.get("config")).client.userManagement.getUser(userId);
  await saveAccount(c.env.DB, {
    id: user.id,
    name: displayName(user),
    email: user.email,
    pictureUrl: user.profilePictureUrl
  });
}

function bearerToken<E extends AppEnv>(c: Context<E>): string | null {
  const match = (c.req.header("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] ? match[1].trim() : null;
}

function looksLikeJwt(token: string): boolean {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token);
}
