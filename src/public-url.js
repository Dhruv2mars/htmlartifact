const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;
// Custom URLs ("slugs") are one DNS label: 3-40 characters of a-z, 0-9, and
// inner hyphens. A slug can never look like a generated draft ID.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "assets", "auth", "blog", "cdn", "cli", "d", "dashboard",
  "docs", "files", "help", "htmlartifact", "login", "mail", "raw", "signin", "static",
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

// Artifact URLs are paths on the service's own origin:
//   /d/<draft id>             any artifact, by its permanent ID
//   /w/<workspace>/<slug>     a custom URL, unique within its workspace
export function draftUrl(origin, draft, workspaceHandle) {
  return draft.slug && workspaceHandle
    ? `${origin}/w/${workspaceHandle}/${draft.slug}`
    : `${origin}/d/${draft.id}`;
}

// Post-sign-in destinations: same-site relative paths only, never an open
// redirect.
export function safeNext(value) {
  if (typeof value !== "string") return "/";
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  return "/";
}
