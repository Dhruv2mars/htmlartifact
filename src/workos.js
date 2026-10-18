import { WorkOS } from "@workos-inc/node";
import { createRemoteJWKSet, jwtVerify } from "jose";

// One WorkOS client (and JWKS cache) per configuration, reused across
// requests within an isolate.
const clients = new Map();

export function workos(config) {
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
export async function verifyAccessToken(config, token) {
  const { jwks } = workos(config);
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

// A WorkOS organization API key (CI) → { id, name, organizationId, userId },
// or null. Validation is an API call, so results are cached for a minute.
const KEY_CACHE_MS = 60_000;

export async function validateApiKey(config, value) {
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

export function displayName(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || user.id;
}
