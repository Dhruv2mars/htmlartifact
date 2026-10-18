import {
  findAccount,
  findWorkspace,
  hasFreshMembership,
  isRevoked,
  membershipEpoch,
  saveAccount,
  saveMembership,
  saveWorkspace
} from "./db.js";
import { workspaceHandle } from "./ids.js";
import { clearSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from "./web-auth.js";
import { displayName, validateApiKey, verifyAccessToken, workos } from "./workos.js";

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

// Bearer credential → viewer, or null. Never reads cookies, so /api calls
// cannot be driven cross-site.
export async function bearerViewer(c) {
  const token = bearerToken(c);
  if (!token) return null;
  return looksLikeJwt(token) ? viewerFromAccessToken(c, token) : viewerFromApiKey(c, token);
}

// Browser session → viewer, or null. Refreshes an expired access token and,
// when `organizationId` names another workspace the user belongs to, moves
// the session there. Updated cookies are set on the response.
export async function sessionViewer(c, { organizationId } = {}) {
  const sealed = readCookie(c, SESSION_COOKIE);
  if (!sealed) return null;
  const config = c.get("config");
  const secure = isSecure(c);
  const session = workos(config).client.userManagement.loadSealedSession({
    sessionData: sealed,
    cookiePassword: config.cookiePassword
  });

  let auth = await session.authenticate().catch(() => ({ authenticated: false }));
  const wantsSwitch =
    organizationId &&
    auth.authenticated &&
    auth.organizationId !== organizationId &&
    Boolean(await activeMembership(c, auth.user.id, organizationId));
  if (!auth.authenticated || wantsSwitch) {
    const refreshed = await session
      .refresh(wantsSwitch ? { organizationId } : undefined)
      .catch(() => ({ authenticated: false }));
    if (refreshed.authenticated && refreshed.sealedSession) {
      c.header("Set-Cookie", sessionCookie(refreshed.sealedSession, secure), { append: true });
      auth = refreshed;
    } else if (!auth.authenticated) {
      c.header("Set-Cookie", clearSessionCookie(secure), { append: true });
      return null;
    }
  }

  const { user } = auth;
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
export async function canReadDraft(c, draft) {
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
export async function activeMembership(c, userId, organizationId) {
  const config = c.get("config");
  const cached = await hasFreshMembership(c.env.DB, userId, organizationId, config.workos.membershipCacheSeconds);
  if (cached) return cached;
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
export async function ensureWorkspace(c, organizationId) {
  const existing = await findWorkspace(c.env.DB, organizationId);
  if (existing) return existing;
  const organization = await workos(c.get("config")).client.organizations.getOrganization(organizationId);
  await saveWorkspace(c.env.DB, {
    organizationId,
    handle: workspaceHandle(organization.name),
    name: organization.name
  });
  return findWorkspace(c.env.DB, organizationId);
}

export function isSecure(c) {
  return new URL(c.req.url).protocol === "https:";
}

async function viewerFromAccessToken(c, token) {
  let claims;
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

async function viewerFromApiKey(c, value) {
  let key;
  try {
    key = await validateApiKey(c.get("config"), value);
  } catch (error) {
    console.error("WorkOS API key validation failed:", error.message);
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

async function buildViewer(c, { accountId, organizationId, credentialId, ownedByOrganization = false }) {
  const db = c.env.DB;
  let role = null;
  // Deleted users, revoked sessions and revoked keys: no access at all.
  if (await isRevoked(db, [accountId, credentialId], "*")) return null;
  if (organizationId) {
    // Removed from this workspace: still signed in, just not a member.
    if (await isRevoked(db, [accountId, credentialId], organizationId)) organizationId = null;
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

async function ensureAccount(c, userId) {
  if (await findAccount(c.env.DB, userId, PROFILE_CACHE_SECONDS)) return;
  const user = await workos(c.get("config")).client.userManagement.getUser(userId);
  await saveAccount(c.env.DB, {
    id: user.id,
    name: displayName(user),
    email: user.email,
    pictureUrl: user.profilePictureUrl
  });
}

function bearerToken(c) {
  const match = (c.req.header("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function looksLikeJwt(token) {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token);
}
