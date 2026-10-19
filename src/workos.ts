import { createHash } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "./types.ts";

// A validated organization API key, as the server uses it.
export interface ApiKeyInfo {
  id: string;
  name: string;
  organizationId: string | null;
  userId: string | null;
}

// The access-token claims the server reads.
export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  sid: string;
  org_id?: string;
  role?: string;
  client_id?: string;
}

interface ClientEntry {
  client: WorkOS;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  keyCache: Map<string, { key: ApiKeyInfo; expiresAt: number }>; // by keyId()
  rejectedKeys: Map<string, number>; // keyId() → expiresAt
  knownValidKeys: Map<string, number>; // keyId() → expiresAt: valid recently
}

// One WorkOS client (and JWKS cache) per configuration, reused across
// requests within an isolate.
const clients = new Map<string, ClientEntry>();

export function workos(config: Config): ClientEntry {
  const key = `${config.workos.apiUrl}|${config.workos.clientId}`;
  let entry = clients.get(key);
  if (!entry) {
    const url = new URL(config.workos.apiUrl);
    entry = {
      client: new WorkOS(config.workos.apiKey, {
        clientId: config.workos.clientId,
        apiHostname: url.hostname,
        https: url.protocol === "https:",
        port: url.port ? Number(url.port) : undefined
      }),
      jwks: createRemoteJWKSet(new URL(`${config.workos.apiUrl}/sso/jwks/${config.workos.clientId}`)),
      keyCache: new Map(),
      rejectedKeys: new Map(),
      knownValidKeys: new Map()
    };
    clients.set(key, entry);
  }
  return entry;
}

// Verifies a WorkOS access token (the CLI's bearer token) and returns its
// claims (sub, sid, org_id, role). It must have been issued to THIS app:
// a WorkOS environment can hold several apps sharing users and keys.
export async function verifyAccessToken(config: Config, token: string): Promise<AccessTokenClaims> {
  const { jwks } = workos(config);
  const { payload } = await jwtVerify<Partial<AccessTokenClaims>>(token, jwks, {
    algorithms: ["RS256"],
    ...(config.workos.issuer ? { issuer: config.workos.issuer } : {})
  });
  const audiences = [payload.aud].flat().filter(Boolean);
  const forUs =
    payload.client_id === config.workos.clientId ||
    (payload.client_id === undefined && audiences.includes(config.workos.clientId));
  if (!forUs) throw new Error("Access token was issued to another application.");
  const { sub, sid } = payload;
  if (typeof sub !== "string" || !sub || typeof sid !== "string") {
    throw new Error("Access token has no sub or sid.");
  }
  return { ...payload, sub, sid };
}

// A WorkOS organization API key (CI) → { id, name, organizationId, userId },
// or null. Validation is an API call to WorkOS, whose rate limit every tenant
// shares, so:
//   - looksLikeApiKey() turns away anything not shaped like a WorkOS secret
//     key ("sk_...") without a call;
//   - valid keys are cached for a minute, rejected ones for five, both keyed
//     by a SHA-256 of the value (raw keys are never kept) and bounded in size;
//   - callers rate-limit cache misses per IP (src/auth.ts).
// WorkOS errors (5xx, 429) are thrown and never cached.
const KEY_CACHE_MS = 60_000;
const REJECTED_KEY_CACHE_MS = 5 * 60_000;
const KEY_CACHE_MAX = 10_000;
const REJECTED_KEY_CACHE_MAX = 10_000;

// WorkOS secret and organization API keys are "sk_" + URL-safe characters.
export function looksLikeApiKey(value: string): boolean {
  return /^sk_[A-Za-z0-9_-]{8,256}$/.test(value);
}

// The cached verdict for `value`: ApiKeyInfo, null (rejected), or undefined
// when WorkOS has to be asked.
export function cachedApiKey(config: Config, value: string): ApiKeyInfo | null | undefined {
  const { keyCache, rejectedKeys } = workos(config);
  const id = keyId(value);
  const now = Date.now();
  const valid = keyCache.get(id);
  if (valid && valid.expiresAt > now) return valid.key;
  const rejected = rejectedKeys.get(id);
  if (rejected && rejected > now) return null;
  return undefined;
}

export async function validateApiKey(config: Config, value: string): Promise<ApiKeyInfo | null> {
  const cached = cachedApiKey(config, value);
  if (cached !== undefined) return cached;

  const { client, keyCache, rejectedKeys, knownValidKeys } = workos(config);
  const { apiKey } = await client.apiKeys.createValidation({ value });
  const id = keyId(value);
  if (!apiKey) {
    remember(rejectedKeys, REJECTED_KEY_CACHE_MAX, id, Date.now() + REJECTED_KEY_CACHE_MS);
    return null;
  }
  const key = {
    id: apiKey.id,
    name: apiKey.name,
    organizationId: apiKey.owner.type === "organization" ? apiKey.owner.id : apiKey.owner.organizationId,
    userId: apiKey.owner.type === "user" ? apiKey.owner.id : null
  };
  rejectedKeys.delete(id);
  remember(keyCache, KEY_CACHE_MAX, id, { key, expiresAt: Date.now() + KEY_CACHE_MS });
  remember(knownValidKeys, KEY_CACHE_MAX, id, Date.now() + KNOWN_VALID_MS);
  return key;
}

// A key that validated within the last day: re-validating it (its 60 s cache
// entry lapsed) is not charged to the caller's IP, so junk keys from a shared
// NAT or CI egress cannot get a real CI key answered with 429.
const KNOWN_VALID_MS = 24 * 60 * 60 * 1000;
export function recentlyValidApiKey(config: Config, value: string): boolean {
  const expiresAt = workos(config).knownValidKeys.get(keyId(value));
  return expiresAt !== undefined && expiresAt > Date.now();
}

// Bounded: at the cap the oldest entry goes (a Map keeps insertion order).
// Separate maps, so a flood of junk keys cannot evict valid ones.
function remember<V>(cache: Map<string, V>, max: number, id: string, value: V): void {
  cache.delete(id);
  while (cache.size >= max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(id, value);
}

function keyId(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function displayName(user: {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || user.id;
}

async function workosPost(
  config: Config,
  path: string,
  body: object,
  { okStatuses = [] as number[] } = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.workos.apiUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.workos.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (okStatuses.includes(response.status)) return {};
  if (!response.ok) throw new Error(`WorkOS ${path} -> ${response.status}`);
  const text = await response.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// An Admin Portal link tied to the admin who asked, so it (and any portal
// session opened from it) can be revoked when they leave.
export async function portalLink(config: Config, organizationId: string, intent: string, userId: string): Promise<string> {
  const { link } = await workosPost(config, "/portal/generate_link", {
    organization: organizationId,
    intent,
    external_user_id: userId
  });
  if (typeof link !== "string") throw new Error("WorkOS returned no portal link");
  return link;
}

// Ends every Admin Portal link and session `userId` has for this organization.
export async function revokePortalLinks(config: Config, organizationId: string, userId: string): Promise<void> {
  // 404: the organization is gone, so there is nothing left to revoke.
  await workosPost(config, "/portal/revoke_link", { organization: organizationId, external_user_id: userId }, { okStatuses: [404] });
}
