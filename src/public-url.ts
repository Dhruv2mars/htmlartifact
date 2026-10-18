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
export function slugProblem(slug: unknown): string | null {
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
export function draftUrl(
  origin: string,
  draft: { id: string; slug: string | null },
  workspaceHandle: string | null | undefined
): string {
  return draft.slug && workspaceHandle
    ? `${origin}/w/${workspaceHandle}/${draft.slug}`
    : `${origin}/d/${draft.id}`;
}

// Post-sign-in destinations: a same-site path only, never an open redirect.
// Resolved against a fixed base and re-serialized, so tricks like "/\t/evil"
// or "/\\evil" (which browsers normalize to "//evil") cannot escape.
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\u0000-\u0020\u007f\\]/.test(value)) return "/";
  try {
    const base = "https://htmlartifact.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
