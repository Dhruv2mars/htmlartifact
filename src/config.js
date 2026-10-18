const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL,
  // The one public origin of this deployment, e.g. https://artifacts.acme.com.
  // A "*." host (https://*.artifacts.acme.com) serves each artifact on its
  // own subdomain; needs wildcard DNS + TLS.
  publicBaseUrl: env.HTMLARTIFACT_PUBLIC_BASE_URL,
  // HTML budget per upload (all pages combined). Accounts get the large limit
  // through the "large-uploads" flag.
  limits: {
    accountBytes: Number(env.MAX_ACCOUNT_HTML_BYTES || 4 * 1024 * 1024),
    largeBytes: Number(env.MAX_LARGE_HTML_BYTES || 16 * 1024 * 1024),
    maxPages: Number(env.MAX_PAGES_PER_UPLOAD || 50)
  },
  // Encrypts the WorkOS sealed-session cookie and signs sign-in state. 32+ chars.
  cookiePassword: env.HTMLARTIFACT_COOKIE_PASSWORD,
  workos: {
    apiKey: env.WORKOS_API_KEY,
    clientId: env.WORKOS_CLIENT_ID,
    // Override only for the WorkOS emulator or a proxy.
    apiUrl: trimSlash(env.WORKOS_API_URL || "https://api.workos.com"),
    // Optional: pin the access-token issuer (e.g. your custom auth domain).
    issuer: env.WORKOS_ISSUER || null,
    // Signing secret of the WorkOS webhook endpoint that points at
    // /webhooks/workos. Optional, but without it removed members keep access
    // until their access token expires (minutes).
    webhookSecret: env.WORKOS_WEBHOOK_SECRET,
    // How long a confirmed membership is trusted before asking WorkOS again.
    // Bounds how long a removed member keeps access when webhooks are off.
    membershipCacheSeconds: Number(env.HTMLARTIFACT_MEMBERSHIP_CACHE_SECONDS || 300),
    // Send artifact.published / artifact.deleted to WorkOS Audit Logs.
    auditLogs: env.HTMLARTIFACT_AUDIT_LOGS === "true"
  },
  // Anyone signed in may create a team (organization) and invite people.
  // Set false for a deployment that serves one company's existing orgs only.
  allowTeamCreation: env.HTMLARTIFACT_ALLOW_TEAM_CREATION !== "false",
  // When set, publishing needs this WorkOS permission (e.g. artifacts:publish)
  // so a "viewer" role can read but not publish. Reading needs membership only.
  publishPermission: env.HTMLARTIFACT_PUBLISH_PERMISSION || null,
  // Set to store artifacts on local disk instead of S3.
  storageDir: env.HTMLARTIFACT_STORAGE_DIR,
  s3: {
    endpoint: env.AWS_ENDPOINT_URL || env.S3_ENDPOINT,
    accessKeyId: env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY,
    bucketName: env.AWS_S3_BUCKET_NAME || env.S3_BUCKET_NAME,
    region: env.AWS_DEFAULT_REGION || env.AWS_REGION || "auto",
    forcePathStyle: (env.AWS_S3_FORCE_PATH_STYLE || "true") !== "false"
  }
};

export function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// The server refuses to start half-configured: a missing secret must never
// fall back to an open deployment.
export function assertAuthConfigured() {
  requireEnv("HTMLARTIFACT_PUBLIC_BASE_URL", config.publicBaseUrl);
  requireEnv("HTMLARTIFACT_COOKIE_PASSWORD", config.cookiePassword);
  if (config.cookiePassword.length < 32) {
    throw new Error("HTMLARTIFACT_COOKIE_PASSWORD must be at least 32 characters.");
  }
  requireEnv("WORKOS_API_KEY", config.workos.apiKey);
  requireEnv("WORKOS_CLIENT_ID", config.workos.clientId);
}

function trimSlash(value) {
  return value ? value.replace(/\/+$/, "") : value;
}
