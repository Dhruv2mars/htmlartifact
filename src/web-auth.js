import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { getCookieDomain } from "./public-url.js";

export const SESSION_COOKIE = "htmlartifact_session";
export const AUTH_STATE_COOKIE = "htmlartifact_auth_state";
// The cookie only carries the WorkOS sealed session; WorkOS decides how long
// the session really lives (dashboard: Authentication > Sessions).
const SESSION_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_STATE_TTL_SECONDS = 10 * 60;

// Compact HMAC-signed tokens (base64url(JSON payload) + "." + HMAC-SHA256) for
// the short-lived sign-in state (OAuth state + PKCE verifier).
export function signToken(payload, secret, ttlSeconds) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: nowSeconds() + ttlSeconds })
  ).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = hmac(body, secret);
  const a = Buffer.from(signature || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionCookie(sealedSession) {
  return serializeCookie(SESSION_COOKIE, sealedSession, { maxAge: SESSION_COOKIE_TTL_SECONDS });
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export function createAuthStateCookie(payload) {
  const token = signToken(payload, config.cookiePassword, AUTH_STATE_TTL_SECONDS);
  return serializeCookie(AUTH_STATE_COOKIE, token, { maxAge: AUTH_STATE_TTL_SECONDS });
}

export function clearAuthStateCookie() {
  return serializeCookie(AUTH_STATE_COOKIE, "", { maxAge: 0 });
}

export function readSealedSession(req) {
  return readCookie(req, SESSION_COOKIE) || null;
}

export function readAuthState(req) {
  const token = readCookie(req, AUTH_STATE_COOKIE);
  return token ? verifyToken(token, config.cookiePassword) : null;
}

export function readCookie(req, name) {
  const header = req.get("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      // A malformed value (bad percent-escape) must read as "no cookie", not
      // throw: otherwise one bad cookie 500s every web page until cleared.
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function serializeCookie(name, value, { maxAge }) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  // With per-artifact subdomains the session must reach every subdomain, or
  // members could never open an artifact URL. Artifact pages cannot read it:
  // it is HttpOnly and scripted pages run in an opaque-origin sandbox.
  const domain = getCookieDomain(config.publicBaseUrl);
  if (domain) attributes.push(`Domain=${domain}`);
  if (config.publicBaseUrl?.startsWith("https:")) attributes.push("Secure");
  return attributes.join("; ");
}

function hmac(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
