import type { Config, Env } from "./types.ts";

// Worker configuration, read from bindings (wrangler.toml vars + secrets).
// Built once per isolate and per env object.

const cache = new WeakMap<Env, Config>();

export function getConfig(env: Env): Config {
  const cached = cache.get(env);
  if (cached) return cached;

  const cookiePassword = env.HTMLARTIFACT_COOKIE_PASSWORD;
  const apiKey = env.WORKOS_API_KEY;
  const clientId = env.WORKOS_CLIENT_ID;
  if (!cookiePassword || !apiKey || !clientId) {
    const missing = [
      ["HTMLARTIFACT_COOKIE_PASSWORD", cookiePassword],
      ["WORKOS_API_KEY", apiKey],
      ["WORKOS_CLIENT_ID", clientId]
    ].filter(([, value]) => !value);
    throw new Error(`Missing configuration: ${missing.map(([name]) => name).join(", ")}`);
  }
  if (cookiePassword.length < 32) {
    throw new Error("HTMLARTIFACT_COOKIE_PASSWORD must be at least 32 characters.");
  }

  const publicBaseUrl = trimSlash(env.HTMLARTIFACT_PUBLIC_BASE_URL) || null;
  const sandboxOrigin = parseSandboxOrigin(env.HTMLARTIFACT_SANDBOX_ORIGIN, publicBaseUrl);

  const config: Config = {
    // Optional: the public origin. Defaults to the origin of each request.
    publicBaseUrl,
    // Optional: the cross-site origin that serves artifact HTML (see
    // src/sandbox.ts). Unset (local dev): the app serves artifacts itself,
    // under the CSP sandbox.
    sandboxOrigin,
    cookiePassword,
    // Defaults depend on where HTML is stored. D1 (no R2 bucket bound, the
    // zero-cost setup on Workers Free): an upload is one D1 batch of ~2
    // statements per page plus one per MB (50 D1 queries per request allowed),
    // and Workers Free allows 10 ms of CPU per request with a burst allowance.
    // Measured in production: 1 MB pages pass even after the burst allowance
    // is spent; back-to-back 2 MB uploads do not. So 1 MiB (2 MiB flagged) and
    // 10 pages. R2 (not used: no hard spending cap; see README): 50 pages, 4 MiB.
    limits: {
      // D1 Free caps one database at 500 MB, and a full database refuses every
      // write (metadata included): uploads stop at 450 MB, and each workspace
      // holds at most 50 MiB of HTML (all versions), so no single workspace
      // fills it for everyone.
      workspaceBytes: Number(env.HTMLARTIFACT_WORKSPACE_QUOTA_BYTES || 50 * 1024 * 1024),
      databaseBytes: Number(env.HTMLARTIFACT_DATABASE_LIMIT_BYTES || 450_000_000),
      ...(env.ARTIFACTS
      ? {
          accountBytes: Number(env.MAX_ACCOUNT_HTML_BYTES || 4 * 1024 * 1024),
          largeBytes: Number(env.MAX_LARGE_HTML_BYTES || 16 * 1024 * 1024),
          maxPages: Number(env.MAX_PAGES_PER_UPLOAD || 50)
        }
      : {
          accountBytes: Number(env.MAX_ACCOUNT_HTML_BYTES || 1024 * 1024),
          largeBytes: Number(env.MAX_LARGE_HTML_BYTES || 2 * 1024 * 1024),
          maxPages: Number(env.MAX_PAGES_PER_UPLOAD || 10)
        })
    },
    workos: {
      apiKey,
      clientId,
      // Override only for the WorkOS emulator.
      apiUrl: trimSlash(env.WORKOS_API_URL) || "https://api.workos.com",
      // Optional: pin the access-token issuer (e.g. a custom auth domain).
      issuer: env.WORKOS_ISSUER || null,
      webhookSecret: env.WORKOS_WEBHOOK_SECRET || null,
      directoryProvisioning: env.HTMLARTIFACT_DIRECTORY_PROVISIONING === "on",
      enterpriseConnections: env.HTMLARTIFACT_ENTERPRISE_CONNECTIONS === "on",
      // How long a confirmed membership is trusted before asking WorkOS again.
      membershipCacheSeconds: Number(env.HTMLARTIFACT_MEMBERSHIP_CACHE_SECONDS || 300)
    },
    invites: {
      ttlDays: Number(env.HTMLARTIFACT_INVITE_TTL_DAYS || 7),
      maxUses: Number(env.HTMLARTIFACT_INVITE_MAX_USES || 50)
    }
  };

  cache.set(env, config);
  return config;
}

// The sandbox origin must be a bare origin (scheme://host[:port]) distinct
// from the app's, and needs the app's origin pinned: the sandbox only lets
// that origin frame artifacts.
function parseSandboxOrigin(value: string | undefined, publicBaseUrl: string | null): string | null {
  const raw = trimSlash(value);
  if (!raw) return null;
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    throw new Error("HTMLARTIFACT_SANDBOX_ORIGIN must be an origin like https://htmlartifact-usercontent.pages.dev.");
  }
  if (origin !== raw) {
    throw new Error("HTMLARTIFACT_SANDBOX_ORIGIN must be an origin like https://htmlartifact-usercontent.pages.dev.");
  }
  if (!publicBaseUrl) throw new Error("HTMLARTIFACT_SANDBOX_ORIGIN requires HTMLARTIFACT_PUBLIC_BASE_URL.");
  if (new URL(publicBaseUrl).origin === origin) {
    throw new Error("HTMLARTIFACT_SANDBOX_ORIGIN must differ from HTMLARTIFACT_PUBLIC_BASE_URL.");
  }
  return origin;
}

function trimSlash(value: string | undefined): string | undefined {
  if (typeof value !== "string") return value;
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
