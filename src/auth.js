import { config } from "./config.js";
import {
  findAccount,
  findFreshAccount,
  findFreshOrganization,
  hasFreshMembership,
  isRevoked,
  saveMembership,
  saveAccount,
  saveOrganization
} from "./db.js";
import { clearSessionCookie, createSessionCookie, readSealedSession } from "./web-auth.js";
import { displayName, validateApiKey, verifyAccessToken, workos } from "./workos.js";

// Who is calling, as one member acting in one WorkOS organization. Three
// credentials resolve to the same viewer shape:
//   browser  → WorkOS sealed session cookie (AuthKit sign-in)
//   CLI      → Bearer WorkOS access token (device-flow sign-in)
//   CI       → Bearer WorkOS API key, owned by an organization
//
// viewer = { account_id, account_name, email, picture_url, organization_id,
//            organization_name, role, permissions, flags, credential_id }

const PROFILE_CACHE_SECONDS = 3600;

// For /api routes: bearer credentials only, never cookies, so no API call
// can be driven cross-site.
export async function apiViewer(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return looksLikeJwt(token) ? viewerFromAccessToken(token) : viewerFromApiKey(token);
}

// For browser routes. Refreshes an expired access token, and when
// `organizationId` is given, tries to move the session into that organization
// (WorkOS only allows it for members). Refreshed cookies are set on `res`.
export async function sessionViewer(req, res, { organizationId } = {}) {
  const sealed = readSealedSession(req);
  if (!sealed) return null;

  const session = workos().userManagement.loadSealedSession({
    sessionData: sealed,
    cookiePassword: config.cookiePassword
  });

  let auth = await session.authenticate().catch(() => ({ authenticated: false }));
  // Only members are moved; checking first means a non-member never gets a
  // session for an organization, whatever the refresh endpoint would allow.
  const wantsSwitch =
    organizationId &&
    auth.authenticated &&
    auth.organizationId !== organizationId &&
    (await isActiveMember(auth.user.id, organizationId));
  if (!auth.authenticated || wantsSwitch) {
    const refreshed = await session
      .refresh(wantsSwitch ? { organizationId } : undefined)
      .catch(() => ({ authenticated: false }));
    if (refreshed.authenticated && refreshed.sealedSession) {
      res.append("Set-Cookie", createSessionCookie(refreshed.sealedSession));
      auth = refreshed;
    } else if (!auth.authenticated) {
      // Expired or revoked at WorkOS: forget it so sign-in is not a loop.
      res.append("Set-Cookie", clearSessionCookie());
      return null;
    }
    // A failed switch keeps the current organization; callers compare.
  }

  const { user } = auth;
  await saveAccount({
    id: user.id,
    name: displayName(user),
    email: user.email,
    pictureUrl: user.profilePictureUrl
  });
  return buildViewer({
    accountId: user.id,
    organizationId: auth.organizationId || null,
    role: auth.role,
    permissions: auth.permissions,
    credentialId: auth.sessionId,
    sessionSubject: auth.sessionId
  });
}

// "member" | "anonymous" | "denied" for reading `draft` (may be null). A
// browser signed into another organization it also belongs to is switched
// into the draft's organization transparently.
export async function canReadDraft(req, res, draft) {
  if (bearerToken(req)) {
    const viewer = await apiViewer(req);
    if (!viewer) return "anonymous";
    return draft && viewer.organization_id === draft.organization_id ? "member" : "denied";
  }
  if (!readSealedSession(req)) return "anonymous";
  const viewer = await sessionViewer(req, res, { organizationId: draft?.organization_id });
  if (!viewer) return "anonymous";
  return draft && viewer.organization_id === draft.organization_id ? "member" : "denied";
}

export function canPublish(viewer) {
  return !config.publishPermission || viewer.permissions.includes(config.publishPermission);
}

// Browsers ask for HTML; curl and agent fetchers send */* and get a 401.
export function wantsHtml(req) {
  return /\btext\/html\b/.test(req.get("accept") || "");
}

async function viewerFromAccessToken(token) {
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    return null;
  }
  if (!claims.org_id) return null;
  await ensureAccount(claims.sub);
  return buildViewer({
    accountId: claims.sub,
    organizationId: claims.org_id,
    role: claims.role,
    permissions: claims.permissions,
    credentialId: claims.sid,
    sessionSubject: claims.sid
  });
}

async function viewerFromApiKey(value) {
  let key;
  try {
    key = await validateApiKey(value);
  } catch (error) {
    console.error("WorkOS API key validation failed:", error.message);
    return null;
  }
  if (!key?.organizationId) return null;

  if (key.userId) {
    await ensureAccount(key.userId);
  } else if (!(await findFreshAccount(key.id, PROFILE_CACHE_SECONDS))) {
    await saveAccount({ id: key.id, name: `${key.name} (API key)` });
  }
  return buildViewer({
    accountId: key.userId || key.id,
    organizationId: key.organizationId,
    role: null,
    permissions: key.permissions,
    credentialId: key.id,
    sessionSubject: key.id
  });
}

async function buildViewer({ accountId, organizationId, role, permissions, credentialId, sessionSubject }) {
  // Webhook-driven revocations close the gap before a token expires.
  if (organizationId && (await isRevoked([accountId, sessionSubject], organizationId))) {
    return null;
  }
  // Never trust a token's org claim alone: WorkOS must confirm the person is
  // an active member (cached briefly). API keys are owned by their org.
  if (organizationId && accountId.startsWith("user_") && !(await isActiveMember(accountId, organizationId))) {
    return null;
  }
  const account = await findAccount(accountId);
  const organization = organizationId ? await ensureOrganization(organizationId) : null;
  return {
    account_id: accountId,
    account_name: account?.name || accountId,
    email: account?.email || null,
    picture_url: account?.picture_url || null,
    organization_id: organizationId,
    organization_name: organization?.name || null,
    role: role || null,
    permissions: Array.isArray(permissions) ? permissions : [],
    flags: account?.flags || [],
    credential_id: credentialId || null
  };
}

async function isActiveMember(userId, organizationId) {
  if (await hasFreshMembership(userId, organizationId, config.workos.membershipCacheSeconds)) return true;
  const page = await workos().userManagement.listOrganizationMemberships({
    userId,
    organizationId,
    statuses: ["active"],
    limit: 1
  });
  const active = page.data.some((m) => m.organizationId === organizationId && m.status === "active");
  await saveMembership(userId, organizationId, active);
  return active;
}

async function ensureAccount(userId) {
  if (await findFreshAccount(userId, PROFILE_CACHE_SECONDS)) return;
  const user = await workos().userManagement.getUser(userId);
  await saveAccount({
    id: user.id,
    name: displayName(user),
    email: user.email,
    pictureUrl: user.profilePictureUrl
  });
}

async function ensureOrganization(organizationId) {
  const cached = await findFreshOrganization(organizationId, PROFILE_CACHE_SECONDS);
  if (cached) return cached;
  const organization = await workos().organizations.getOrganization(organizationId);
  await saveOrganization({ id: organization.id, name: organization.name });
  return organization;
}

function bearerToken(req) {
  const match = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function looksLikeJwt(token) {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token);
}
