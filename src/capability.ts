// Sandbox capabilities: short-lived, HMAC-signed tokens that let the sandbox
// origin (htmlartifact-usercontent.pages.dev) serve exactly one artifact
// version to exactly one viewer. The app mints them after its own access check;
// the sandbox verifies the signature and then re-checks membership, revocation
// and deletion before serving anything.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Capability {
  /** draft id */
  d: string;
  /** version id */
  v: string;
  /** WorkOS organization id that owns the draft */
  o: string;
  /** viewer: WorkOS user id */
  u: string;
  /** viewer's credential (WorkOS session or API key id), so revoking it ends the capability too */
  s: string | null;
  /** expiry, unix seconds */
  exp: number;
}

const CAPABILITY_TTL_SECONDS = 60 * 60;
const CONTEXT = "htmlartifact:sandbox-capability:v1";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", `${CONTEXT}:${secret}`).update(payload).digest("base64url");
}

export function mintCapability(
  secret: string,
  claims: Omit<Capability, "exp">,
  now = Math.floor(Date.now() / 1000)
): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: now + CAPABILITY_TTL_SECONDS })).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyCapability(secret: string, token: string, now = Math.floor(Date.now() / 1000)): Capability | null {
  const claims = verifySignedCapability(secret, token);
  return claims && claims.exp > now ? claims : null;
}

// Genuine but past its expiry: the viewer just left the page open too long.
export function capabilityExpired(secret: string, token: string, now = Math.floor(Date.now() / 1000)): boolean {
  const claims = verifySignedCapability(secret, token);
  return Boolean(claims && claims.exp <= now);
}

function verifySignedCapability(secret: string, token: string): Capability | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  return isCapability(claims) ? claims : null;
}

function isCapability(value: unknown): value is Capability {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.d === "string" &&
    typeof c.v === "string" &&
    typeof c.o === "string" &&
    typeof c.u === "string" &&
    (typeof c.s === "string" || c.s === null) &&
    typeof c.exp === "number" &&
    Number.isFinite(c.exp)
  );
}
