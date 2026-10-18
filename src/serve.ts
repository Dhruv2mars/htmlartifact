import type { Context, Hono } from "hono";
import { canReadDraft } from "./auth.ts";
import { findWorkspaceByHandle } from "./db.ts";
import { renderNotFound } from "./render.ts";
import { getHtmlObject } from "./storage.ts";
import type { AppEnv, DraftRow, PageRow, VersionRow } from "./types.ts";

// An artifact by its draft ID, or by workspace handle + custom URL.
type DraftRef = { id: string } | { handle: string; slug: string };

// Artifact URLs serve the exact uploaded HTML, byte for byte, to members
// only: browsers with a session, CLI/agents with a bearer token.
//   /d/<draft id>[/...]            /w/<workspace handle>/<slug>[/...]
// Below the root: "v/<n>/" pins a version, "raw" names the index page, and
// anything else names a page of a multi-page artifact.
export function registerServing(app: Hono<AppEnv>): void {
  app.get("/d/:id{[a-z0-9]{12}}/*", (c) => serve(c, { id: c.req.param("id") }));
  app.get("/d/:id{[a-z0-9]{12}}", (c) => serve(c, { id: c.req.param("id") }));
  app.get("/w/:handle/:slug/*", (c) => serve(c, slugRef(c.req.param("handle"), c.req.param("slug"))));
  app.get("/w/:handle/:slug", (c) => serve(c, slugRef(c.req.param("handle"), c.req.param("slug"))));
}

function slugRef(handle: string, slug: string): DraftRef {
  return { handle: handle.toLowerCase(), slug: slug.toLowerCase() };
}

async function serve(c: Context<AppEnv>, ref: DraftRef) {
  const segments = belowRoot(c);
  if (!segments) return notFound(c);
  let parts = segments;
  let versionNumber: number | undefined;
  if (parts[0] === "v") {
    if (!/^[1-9]\d{0,8}$/.test(parts[1] || "")) return notFound(c);
    versionNumber = Number(parts[1]);
    parts = parts.slice(2);
  }
  const rawWithSlash = parts[0] === "raw" && parts.length === 2 && parts[1] === "";
  if (parts[0] === "raw" && (parts.length === 1 || rawWithSlash)) parts = [""];

  const draft = await findDraft(c, ref);
  // Signed out → sign in. Signed in elsewhere, or missing → the same 404, so
  // URLs reveal nothing to outsiders.
  const access = await canReadDraft(c, draft);
  if (access === "anonymous") return requireSignIn(c);
  if (!draft || access !== "member") return notFound(c);

  const version = await findVersion(c, draft, versionNumber);
  if (!version) return notFound(c);
  const multiPage = Number(version.page_count || 1) > 1;
  const pagePath = parts.join("/");
  const path = new URL(c.req.url).pathname;

  if (rawWithSlash && multiPage) return c.redirect(path.slice(0, -1) + query(c), 302);
  if (pagePath === "" || pagePath === "index.html") {
    // Relative links between pages only resolve from a URL ending in "/".
    if (parts.length === 0 && multiPage) return c.redirect(`${path}/${query(c)}`, 302);
    return sendPage(c, draft, version, version);
  }
  if (!multiPage) return notFound(c);

  const candidates = pagePath.endsWith("/")
    ? [`${pagePath}index.html`]
    : pagePath.endsWith(".html")
      ? [pagePath]
      : [`${pagePath}.html`, `${pagePath}/index.html`];
  const marks = candidates.map(() => "?").join(", ");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM draft_pages WHERE draft_version_id = ? AND path IN (${marks})`
  )
    .bind(version.id, ...candidates)
    .all<PageRow>();
  const page = candidates.map((p) => results.find((row) => row.path === p)).find(Boolean);
  if (!page) return notFound(c);
  if (page.path === `${pagePath}/index.html`) return c.redirect(`${path}/${query(c)}`, 302);
  return sendPage(c, draft, version, page);
}

async function findDraft(c: Context<AppEnv>, ref: DraftRef): Promise<DraftRow | null> {
  const db = c.env.DB;
  if ("id" in ref) {
    return db.prepare("SELECT * FROM drafts WHERE id = ? AND deleted_at IS NULL").bind(ref.id).first<DraftRow>();
  }
  const workspace = await findWorkspaceByHandle(db, ref.handle);
  if (!workspace) return null;
  return db
    .prepare("SELECT * FROM drafts WHERE organization_id = ? AND slug = ? AND deleted_at IS NULL")
    .bind(workspace.organization_id, ref.slug)
    .first<DraftRow>();
}

function findVersion(c: Context<AppEnv>, draft: DraftRow, versionNumber: number | undefined): Promise<VersionRow | null> {
  return versionNumber
    ? c.env.DB.prepare("SELECT * FROM draft_versions WHERE draft_id = ? AND version_number = ?")
        .bind(draft.id, versionNumber)
        .first<VersionRow>()
    : c.env.DB.prepare("SELECT * FROM draft_versions WHERE id = ?").bind(draft.current_version_id).first<VersionRow>();
}

// `page` is the version row for index.html, or a draft_pages row.
async function sendPage(c: Context<AppEnv>, draft: DraftRow, version: VersionRow, page: VersionRow | PageRow): Promise<Response> {
  const html = await getHtmlObject(c.env.ARTIFACTS, page.object_key);
  c.header("Content-Security-Policy", contentSecurityPolicy(Boolean(page.has_inline_script)));
  c.header("X-Htmlartifact-Draft-Id", draft.id);
  c.header("X-Htmlartifact-Draft-Version", String(version.version_number));
  // Artifacts are private: never let a shared cache keep one.
  c.header("Cache-Control", "private, no-store");
  return c.html(html);
}

// Script-free pages get script-src 'none'. Scripted pages run sandboxed
// without allow-same-origin: their code gets an opaque origin and can never
// read htmlartifact's session cookie or act as the app. Assets may load from
// any https host.
function contentSecurityPolicy(allowInlineScripts: boolean): string {
  const inline = allowInlineScripts ? "'unsafe-inline'" : "'none'";
  const directives = [
    "default-src 'none'",
    `script-src ${inline}`,
    `script-src-attr ${inline}`,
    "style-src 'unsafe-inline' https:",
    "img-src https: data:",
    "media-src https: data:",
    "font-src https: data:",
    "connect-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri https:",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ];
  if (allowInlineScripts) directives.push("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
  return directives.join("; ");
}

// Browsers go to sign-in and come back; agents and curl get a plain 401.
function requireSignIn(c: Context<AppEnv>): Response {
  const url = new URL(c.req.url);
  if (/\btext\/html\b/.test(c.req.header("accept") || "")) {
    return c.redirect(`/auth/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  }
  c.header("WWW-Authenticate", 'Bearer realm="htmlartifact"');
  return c.text("Sign in required. Use `htmlartifact read <url>`.\n", 401);
}

function notFound(c: Context<AppEnv>): Response | Promise<Response> {
  return c.html(renderNotFound(), 404);
}

// Path segments below the artifact root, decoded once; null if malformed.
function belowRoot(c: Context<AppEnv>): string[] | null {
  const path = new URL(c.req.url).pathname;
  const raw = path.split("/").slice(1);
  const rootLength = raw[0] === "d" ? 2 : 3;
  const segments: string[] = [];
  for (const part of raw.slice(rootLength)) {
    let segment: string;
    try {
      segment = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (segment.includes("/")) return null;
    segments.push(segment);
  }
  return segments;
}

function query(c: Context<AppEnv>): string {
  return new URL(c.req.url).search;
}
