const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;
// Custom URLs ("slugs") are one DNS label: 3-40 characters of a-z, 0-9, and
// inner hyphens. A slug can never look like a generated draft ID.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "assets", "auth", "blog", "cdn", "cli", "d", "dashboard",
  "docs", "files", "help", "login", "mail", "postplan", "raw", "signin", "static",
  "status", "support", "www"
]);

// Returns why a slug cannot be used, or null when the format is fine.
export function slugProblem(slug) {
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    return "Custom URLs are 3-40 characters of a-z, 0-9, and inner hyphens.";
  }
  // DNS reserves "--" in the third and fourth characters for punycode
  // (xn--); such a label may not be a valid hostname at all.
  if (slug.slice(2, 4) === "--") {
    return "Custom URLs cannot have hyphens as the third and fourth characters.";
  }
  if (DRAFT_ID_PATTERN.test(slug)) {
    return "Custom URLs cannot be 12 letters and numbers; that is the draft ID format.";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return `"${slug}" is reserved.`;
  }
  return null;
}

export function getRequestBaseUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : req.protocol || "http";
  return `${protocol}://${req.get("host")}`;
}

export function getHomeUrl({ publicBaseUrl, requestBaseUrl }) {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = wildcard.hostname.slice(2);
    wildcard.pathname = "/";
    wildcard.search = "";
    wildcard.hash = "";
    return stripTrailingSlash(wildcard.toString());
  }

  return configured || normalizeUrl(requestBaseUrl);
}

// `draftId` may also be a custom URL slug; both name the same draft.
export function getDraftPublicUrl({ draftId, publicBaseUrl, requestBaseUrl }) {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = `${draftId}.${wildcard.hostname.slice(2)}`;
    wildcard.pathname = "/";
    wildcard.search = "";
    wildcard.hash = "";
    return stripTrailingSlash(wildcard.toString());
  }

  const baseUrl = configured || normalizeUrl(requestBaseUrl);
  return `${baseUrl}/d/${draftId}`;
}

export function getDraftRawUrl({ draftId, publicBaseUrl, requestBaseUrl }) {
  const configured = normalizeUrl(publicBaseUrl);
  const wildcard = parseWildcardBaseUrl(configured);

  if (wildcard) {
    wildcard.hostname = wildcard.hostname.slice(2);
    wildcard.pathname = `/d/${draftId}/raw`;
    wildcard.search = "";
    wildcard.hash = "";
    return wildcard.toString();
  }

  const baseUrl = configured || normalizeUrl(requestBaseUrl);
  return `${baseUrl}/d/${draftId}/raw`;
}

// Returns the draft ID or custom URL slug named by a wildcard subdomain host,
// or null for the apex, nested hosts, and reserved names such as www.
export function getDraftRefFromHost({ publicBaseUrl, host }) {
  const wildcard = parseWildcardBaseUrl(publicBaseUrl);
  if (!wildcard) return null;

  const rootHost = wildcard.hostname.slice(2).toLowerCase();
  const requestHost = parseHost(host);
  if (!requestHost || !requestHost.endsWith(`.${rootHost}`)) return null;

  const label = requestHost.slice(0, -(rootHost.length + 1));
  if (DRAFT_ID_PATTERN.test(label) || !slugProblem(label)) return label;
  return null;
}

function parseWildcardBaseUrl(value) {
  const url = parseUrl(value);
  if (!url || !url.hostname.startsWith("*.")) return null;
  return url;
}

function parseHost(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  try {
    return new URL(`http://${normalized}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
