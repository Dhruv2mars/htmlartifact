// Worker configuration, read from bindings (wrangler.toml vars + secrets).
// Built once per isolate and per env object.

const cache = new WeakMap();

export function getConfig(env) {
  let config = cache.get(env);
  if (config) return config;

  config = {
    // Optional: the public origin. Defaults to the origin of each request.
    publicBaseUrl: trimSlash(env.HTMLARTIFACT_PUBLIC_BASE_URL) || null,
    cookiePassword: env.HTMLARTIFACT_COOKIE_PASSWORD,
    limits: {
      accountBytes: Number(env.MAX_ACCOUNT_HTML_BYTES || 4 * 1024 * 1024),
      largeBytes: Number(env.MAX_LARGE_HTML_BYTES || 16 * 1024 * 1024),
      maxPages: Number(env.MAX_PAGES_PER_UPLOAD || 50)
    },
    workos: {
      apiKey: env.WORKOS_API_KEY,
      clientId: env.WORKOS_CLIENT_ID,
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

  const missing = [
    ["HTMLARTIFACT_COOKIE_PASSWORD", config.cookiePassword],
    ["WORKOS_API_KEY", config.workos.apiKey],
    ["WORKOS_CLIENT_ID", config.workos.clientId]
  ].filter(([, value]) => !value);
  if (missing.length) {
    throw new Error(`Missing configuration: ${missing.map(([name]) => name).join(", ")}`);
  }
  if (config.cookiePassword.length < 32) {
    throw new Error("HTMLARTIFACT_COOKIE_PASSWORD must be at least 32 characters.");
  }

  cache.set(env, config);
  return config;
}

function trimSlash(value) {
  return typeof value === "string" && value ? value.replace(/\/+$/, "") : value;
}
