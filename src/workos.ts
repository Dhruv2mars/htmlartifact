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
  keyCache: Map<string, { key: ApiKeyInfo | null; expiresAt: number }>;
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
      keyCache: new Map()
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
// or null. Validation is an API call, so results are cached for a minute.
const KEY_CACHE_MS = 60_000;

export async function validateApiKey(config: Config, value: string): Promise<ApiKeyInfo | null> {
  const { client, keyCache } = workos(config);
  const cached = keyCache.get(value);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const { apiKey } = await client.apiKeys.createValidation({ value });
  const key = apiKey
    ? {
        id: apiKey.id,
        name: apiKey.name,
        organizationId: apiKey.owner.type === "organization" ? apiKey.owner.id : apiKey.owner.organizationId,
        userId: apiKey.owner.type === "user" ? apiKey.owner.id : null
      }
    : null;
  if (keyCache.size > 10_000) keyCache.clear();
  keyCache.set(value, { key, expiresAt: Date.now() + KEY_CACHE_MS });
  return key;
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
