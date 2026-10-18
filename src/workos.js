import { WorkOS } from "@workos-inc/node";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

// One WorkOS client for the server. WORKOS_API_URL only changes for the
// WorkOS emulator (tests, local dev).
let client;
let jwks;

export function workos() {
  if (client) return client;
  const url = new URL(config.workos.apiUrl);
  client = new WorkOS(config.workos.apiKey, {
    clientId: config.workos.clientId,
    apiHostname: url.hostname,
    https: url.protocol === "https:",
    port: url.port ? Number(url.port) : undefined
  });
  return client;
}

// Verifies a WorkOS access token (the CLI's bearer token) against this
// client's JWKS and returns its claims: sub, sid, org_id, role, permissions.
// The token must have been issued to THIS application: WorkOS environments
// can hold several applications sharing users and signing keys.
export async function verifyAccessToken(token) {
  jwks ||= createRemoteJWKSet(new URL(`${config.workos.apiUrl}/sso/jwks/${config.workos.clientId}`));
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ["RS256"],
    ...(config.workos.issuer ? { issuer: config.workos.issuer } : {})
  });
  const audiences = [payload.aud].flat().filter(Boolean);
  const forUs =
    payload.client_id === config.workos.clientId ||
    (payload.client_id === undefined && audiences.includes(config.workos.clientId));
  if (!forUs) throw new Error("Access token was issued to another application.");
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.sid !== "string") {
    throw new Error("Access token has no sub or sid.");
  }
  return payload;
}

// WorkOS API key (CI) → { id, name, organizationId, userId, permissions }, or
// null. Validation is an API call, so results are cached briefly; a revoked
// key stops working within KEY_CACHE_MS.
const KEY_CACHE_MS = 60_000;
const keyCache = new Map();

export async function validateApiKey(value) {
  const cached = keyCache.get(value);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const { apiKey } = await workos().apiKeys.createValidation({ value });
  const key = apiKey
    ? {
        id: apiKey.id,
        name: apiKey.name,
        organizationId: apiKey.owner.type === "organization" ? apiKey.owner.id : apiKey.owner.organizationId,
        userId: apiKey.owner.type === "user" ? apiKey.owner.id : null,
        permissions: apiKey.permissions || []
      }
    : null;
  if (keyCache.size > 10_000) keyCache.clear();
  keyCache.set(value, { key, expiresAt: Date.now() + KEY_CACHE_MS });
  return key;
}

export function displayName(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || user.id;
}

// Best-effort WorkOS Audit Logs event; never fails the request.
export function audit(organizationId, event) {
  if (!config.workos.auditLogs) return;
  workos()
    .auditLogs.createEvent(organizationId, { occurredAt: new Date(), ...event })
    .catch((error) => console.error(`audit log ${event.action} failed:`, error.message));
}

// Test hook.
export function resetWorkosClient() {
  client = undefined;
  jwks = undefined;
  keyCache.clear();
}
