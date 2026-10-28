import type { Context, Hono } from "hono";
import { draftAccess } from "./auth.ts";
import { mintCapability } from "./capability.ts";
import { findWorkspaceByHandle } from "./db.ts";
import { draftUrl } from "./public-url.ts";
import { renderNotFound } from "./render.ts";
import { renderArtifactFrame } from "./render-web.ts";
import { getObject } from "./storage.ts";
import type { StoredBody } from "./gzip.ts";
import type { AppEnv, DraftRow, PageRow, VersionRow } from "./types.ts";

// An artifact by its draft ID, or by workspace handle + custom URL.
type DraftRef = { id: string } | { handle: string; slug: string };

// Artifact URLs serve the uploaded HTML to members only: browsers with a
// session, CLI/agents with a bearer token.
//   /d/<draft id>[/...]            /w/<workspace handle>/<slug>[/...]
// Below the root: "v/<n>/" pins a version, "raw" names the index page (its
// source, in a browser), and anything else names a page of a multi-page
// artifact.
//
// With a sandbox origin configured, browsers get a wrapper page that frames
// the artifact from that cross-site origin (src/sandbox.ts), so artifact HTML
// never runs on the app origin. Bearer requests get the raw HTML, byte for
// byte; without a sandbox origin (local dev) browsers get it too.
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
  const segments = belowRoot(c, ref);
  if (!segments) return notFound(c);
  let parts = segments;
  let versionNumber: number | undefined;
  if (parts[0] === "v") {
    if (!/^[1-9]\d{0,8}$/.test(parts[1] || "")) return notFound(c);
    versionNumber = Number(parts[1]);
    parts = parts.slice(2);
  }

  const draft = await findDraft(c, ref);
  // Signed out → sign in. Signed in elsewhere, or missing → the same 404, so
  // URLs reveal nothing to outsiders.
  const { access, viewer, bearer } = await draftAccess(c, draft);
  if (access === "anonymous") return requireSignIn(c);
  if (!draft || !viewer || access !== "member") return notFound(c);

  const version = await findVersion(c, draft, versionNumber);
  if (!version) return versionNumber ? missingVersion(c, draft, versionNumber, bearer) : notFound(c);
  const raw = parts[0] === "raw" && (parts.length === 1 || (parts.length === 2 && parts[1] === ""));
  const resolved = await resolvePage(c, version, parts);
  if (!resolved) return notFound(c);
  if ("redirect" in resolved) return resolved.redirect;

  const sandboxOrigin = c.get("config").sandboxOrigin;
  if (bearer) return sendPage(c, draft, version, resolved.page);
  if (raw) return sendSource(c, draft, version, resolved.page);
  if (!sandboxOrigin) return sendPage(c, draft, version, resolved.page);

  const token = mintCapability(c.get("config").cookiePassword, {
    d: draft.id,
    v: version.id,
    o: draft.organization_id,
    u: viewer.account_id,
    s: viewer.credential_id
  });
  // "/t/<token>/" is the artifact root on the sandbox, so relative links
  // between pages resolve there exactly as they do here.
  const src = `${sandboxOrigin}/t/${token}/${resolved.parts.map(encodeURIComponent).join("/")}`;
  c.header("Content-Security-Policy", frameContentSecurityPolicy(sandboxOrigin));
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "private, no-store");
  // Who published this version, for the bar ("Maya · 2 hours ago").
  const by = await c.env.DB.prepare("SELECT name FROM accounts WHERE id = ?").bind(version.created_by).first<{ name: string }>();
  return c.html(
    renderArtifactFrame({
      by: by?.name ?? null,
      at: version.created_at,
      title: draft.title,
      src,
      id: draft.id,
      workspace: viewer.workspace?.name ?? null,
      version: version.version_number,
      latest: version.id === draft.current_version_id,
      latestUrl: draftUrl("", draft, viewer.workspace?.handle),
      historyUrl: `/history/${encodeURIComponent(draft.id)}`,
      feedUrl: "/"
    })
  );
}

// The page that `parts` (path segments below the artifact or version root)
// names in `version`: the page with its normalized parts, a redirect to the
// canonical URL, or null for not found.
export async function resolvePage(
  c: Context<AppEnv>,
  version: VersionRow,
  segments: string[]
): Promise<{ page: VersionRow | PageRow; parts: string[] } | { redirect: Response } | null> {
  let parts = segments;
  const rawWithSlash = parts[0] === "raw" && parts.length === 2 && parts[1] === "";
  if (parts[0] === "raw" && (parts.length === 1 || rawWithSlash)) parts = [""];
  const multiPage = Number(version.page_count || 1) > 1;
  const pagePath = parts.join("/");
  const path = new URL(c.req.url).pathname;

  if (rawWithSlash && multiPage) return { redirect: c.redirect(path.slice(0, -1) + query(c), 302) };
  if (pagePath === "" || pagePath === "index.html") {
    // Relative links between pages only resolve from a URL ending in "/".
    if (parts.length === 0 && multiPage) return { redirect: c.redirect(`${path}/${query(c)}`, 302) };
    return { page: version, parts };
  }
  if (!multiPage) return null;

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
  if (!page) return null;
  if (page.path === `${pagePath}/index.html`) return { redirect: c.redirect(`${path}/${query(c)}`, 302) };
  return { page, parts };
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
// `frameAncestors` is set on the sandbox origin: the app origin that may
// frame the page. Without it the page may not be framed at all.
export async function sendPage(
  c: Context<AppEnv>,
  draft: DraftRow,
  version: VersionRow,
  page: VersionRow | PageRow,
  frameAncestors?: string
): Promise<Response> {
  const body = await getObject(c.env, page.object_key);
  c.header("Content-Security-Policy", contentSecurityPolicy(Boolean(page.has_inline_script), frameAncestors));
  c.header("X-Htmlartifact-Draft-Id", draft.id);
  c.header("X-Htmlartifact-Draft-Version", String(version.version_number));
  // Artifacts are private: never let a shared cache keep one.
  c.header("Cache-Control", "private, no-store");
  return sendBody(c, body, "text/html; charset=utf-8");
}

// "Raw HTML" opened in a browser: the page's source, as stored. As text/plain
// with nosniff it never runs on the app origin, and the sandbox CSP holds
// even if a browser rendered it anyway. (Bearer requests get the HTML.)
async function sendSource(c: Context<AppEnv>, draft: DraftRow, version: VersionRow, page: VersionRow | PageRow): Promise<Response> {
  const body = await getObject(c.env, page.object_key);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "default-src 'none'; sandbox");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Htmlartifact-Draft-Id", draft.id);
  c.header("X-Htmlartifact-Draft-Version", String(version.version_number));
  c.header("Cache-Control", "private, no-store");
  return sendBody(c, body, "text/plain; charset=utf-8");
}

// A stored page: text as is; gzip bytes (src/gzip.ts) as received, with
// Content-Encoding: gzip, so the bytes the client inflates are the ones
// validated. A client that doesn't accept gzip gets them inflated (natively,
// streamed: no CPU per byte in JavaScript).
function sendBody(c: Context<AppEnv>, body: StoredBody, contentType: string): Response {
  c.header("Content-Type", contentType);
  if (typeof body === "string") return c.body(body);
  c.header("Vary", "Accept-Encoding");
  if (!acceptsGzip(c.req.header("accept-encoding"))) {
    return c.body(new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip")));
  }
  c.header("Content-Encoding", "gzip");
  const response = c.body(body as Uint8Array<ArrayBuffer>);
  // "manual": the body is already encoded; the runtime must not encode it again.
  return new Response(response.body, { status: response.status, headers: response.headers, encodeBody: "manual" });
}

// Whether an Accept-Encoding header allows gzip: named (or "*") with q > 0,
// and not refused by name.
function acceptsGzip(header: string | undefined): boolean {
  let gzip: boolean | null = null;
  let any = false;
  for (const part of (header || "").toLowerCase().split(",")) {
    const [name = "", ...params] = part.split(";").map((piece) => piece.trim());
    const q = params.find((param) => param.startsWith("q="));
    const allowed = q === undefined || Number(q.slice(2)) > 0;
    if (name === "gzip" || name === "x-gzip") gzip = allowed;
    else if (name === "*") any = allowed;
  }
  return gzip ?? any;
}

// A member asked for a version that isn't there, so the 404 that suggests
// asking for an invite would mislead. Version numbers only grow and pruning
// keeps the latest, so one below it was pruned. Browsers go to the history
// page, which lists the versions left; agents get the reason as text.
async function missingVersion(c: Context<AppEnv>, draft: DraftRow, wanted: number, bearer: boolean): Promise<Response> {
  if (!bearer) return c.redirect(`/history/${encodeURIComponent(draft.id)}?missing=${wanted}`, 302);
  const latest = await c.env.DB.prepare("SELECT version_number, page_count FROM draft_versions WHERE id = ?")
    .bind(draft.current_version_id)
    .first<Pick<VersionRow, "version_number" | "page_count">>();
  if (!latest) return notFound(c);
  const number = Number(latest.version_number);
  const url = `${c.get("origin")}/d/${draft.id}/v/${number}${Number(latest.page_count || 1) > 1 ? "/" : ""}`;
  const why = wanted < number ? `Version ${wanted} of ${draft.id} was deleted (pruned).` : `${draft.id} has no version ${wanted}.`;
  c.header("X-Htmlartifact-Latest-Version", String(number));
  c.header("Cache-Control", "private, no-store");
  return c.text(`${why} The latest is version ${number}: ${url}\n`, 404);
}

// Script-free pages get script-src 'none'. Scripted pages run sandboxed
// without allow-same-origin: their code gets an opaque origin and can never
// read htmlartifact's session cookie or act as the app. Assets may load from
// any https host. On the sandbox origin every page is sandboxed, and only the
// app may frame it.
function contentSecurityPolicy(allowInlineScripts: boolean, frameAncestors?: string): string {
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
    `frame-ancestors ${frameAncestors || "'none'"}`
  ];
  if (allowInlineScripts || frameAncestors) {
    directives.push("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
  }
  return directives.join("; ");
}

// The wrapper page: htmlartifact's own markup, no script, one frame from the
// sandbox origin, and never framed itself.
function frameContentSecurityPolicy(sandboxOrigin: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    `frame-src ${sandboxOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join("; ");
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

// Off the app's own origin (the sandbox), the page links back to the app.
export function notFound(c: Context<AppEnv>): Response | Promise<Response> {
  const app = c.get("config").publicBaseUrl;
  const elsewhere = app && new URL(c.req.url).origin !== new URL(app).origin;
  return c.html(renderNotFound(elsewhere ? app : null), 404);
}

// Path segments below the first `rootLength` segments, decoded once; null if
// malformed.
export function segmentsBelow(c: Context<AppEnv>, rootLength: number): string[] | null {
  const path = new URL(c.req.url).pathname;
  const raw = path.split("/").slice(1);
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

function belowRoot(c: Context<AppEnv>, ref: DraftRef): string[] | null {
  return segmentsBelow(c, "id" in ref ? 2 : 3);
}

function query(c: Context<AppEnv>): string {
  return new URL(c.req.url).search;
}
