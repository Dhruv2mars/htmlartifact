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

  const config: Config = {
    // Optional: the public origin. Defaults to the origin of each request.
    publicBaseUrl: trimSlash(env.HTMLARTIFACT_PUBLIC_BASE_URL) || null,
    cookiePassword,
    limits: {
      accountBytes: Number(env.MAX_ACCOUNT_HTML_BYTES || 4 * 1024 * 1024),
      largeBytes: Number(env.MAX_LARGE_HTML_BYTES || 16 * 1024 * 1024),
      maxPages: Number(env.MAX_PAGES_PER_UPLOAD || 50)
    },
    workos: {
      apiKey,
      clientId,
      // Override only for the WorkOS emulator.
      apiUrl: trimSlash(env.WORKOS_API_URL) || "https://api.workos.com",
      // Optional: pin the access-token issuer (e.g. a custom auth domain).
      issuer: env.WORKOS_ISSUER || null,
      webhookSecret: env.WORKOS_WEBHOOK_SECRET || null,
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

function trimSlash(value: string | undefined): string | undefined {
  return typeof value === "string" && value ? value.replace(/\/+$/, "") : value;
}
