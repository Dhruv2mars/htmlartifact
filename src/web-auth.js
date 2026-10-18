import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "htmlartifact_session";
export const AUTH_STATE_COOKIE = "htmlartifact_auth_state";
// The cookie only carries the WorkOS sealed session; WorkOS decides how long
// the session really lives.
const SESSION_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_STATE_TTL_SECONDS = 10 * 60;

// Compact HMAC-signed tokens (base64url(JSON) + "." + HMAC-SHA256) for the
// short-lived sign-in state (OAuth state, PKCE verifier, return path).
export function signToken(payload, secret, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: nowSeconds() + ttlSeconds })).toString(
    "base64url"
  );
  return `${body}.${hmac(body, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const a = Buffer.from(signature || "");
  const b = Buffer.from(hmac(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(sealedSession, secure) {
  return serializeCookie(SESSION_COOKIE, sealedSession, SESSION_COOKIE_TTL_SECONDS, secure);
}

export function clearSessionCookie(secure) {
  return serializeCookie(SESSION_COOKIE, "", 0, secure);
}

export function authStateCookie(payload, secret, secure) {
  return serializeCookie(
    AUTH_STATE_COOKIE,
    signToken(payload, secret, AUTH_STATE_TTL_SECONDS),
    AUTH_STATE_TTL_SECONDS,
    secure
  );
}

export function clearAuthStateCookie(secure) {
  return serializeCookie(AUTH_STATE_COOKIE, "", 0, secure);
}

export function readAuthState(c, secret) {
  const token = readCookie(c, AUTH_STATE_COOKIE);
  return token ? verifyToken(token, secret) : null;
}

export function readCookie(c, name) {
  const header = c.req.header("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      // A malformed value must read as "no cookie", not throw.
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function serializeCookie(name, value, maxAge, secure) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

function hmac(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
