import type { Context, Hono } from "hono";
import { userStillMember } from "./auth.ts";
import { verifyCapability } from "./capability.ts";
import { notFound, resolvePage, segmentsBelow, sendPage } from "./serve.ts";
import type { AppEnv, DraftRow, VersionRow } from "./types.ts";

// The sandbox origin (HTMLARTIFACT_SANDBOX_ORIGIN, e.g.
// https://htmlartifact-usercontent.pages.dev) serves artifact HTML and nothing
// else. It is cross-site from the app (pages.dev is on the Public Suffix
// List), has no session cookie, and runs none of the app's routes:
//   /t/<capability>/[<page path>]   one artifact version, for one viewer
// The app mints the capability after its own access check (src/serve.ts);
// here it is verified and access is re-checked before every response.

// True when `url` is on the sandbox origin, or on a subdomain of its host
// (Pages per-deployment aliases such as <hash>.htmlartifact-usercontent.pages.dev,
// which must never serve the app either).
export function isSandboxRequest(url: URL, sandboxOrigin: string | null): boolean {
  if (!sandboxOrigin) return false;
  const sandbox = new URL(sandboxOrigin);
  if (url.origin === sandbox.origin) return true;
  return url.protocol === sandbox.protocol && url.hostname.endsWith(`.${sandbox.hostname}`);
}

export function registerSandbox(app: Hono<AppEnv>): void {
  app.get("/t/:token/*", (c) => serveCapability(c, c.req.param("token")));
  app.get("/t/:token", (c) => serveCapability(c, c.req.param("token")));
}

// Every failure is the same 404: a token URL never says why it stopped working.
async function serveCapability(c: Context<AppEnv>, token: string): Promise<Response> {
  const config = c.get("config");
  const claims = verifyCapability(config.cookiePassword, token);
  if (!claims || !config.publicBaseUrl) return notFound(c);
  const segments = segmentsBelow(c, 2);
  if (!segments) return notFound(c);

  const db = c.env.DB;
  const draft = await db
    .prepare("SELECT * FROM drafts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
    .bind(claims.d, claims.o)
    .first<DraftRow>();
  if (!draft) return notFound(c);
  const version = await db
    .prepare("SELECT * FROM draft_versions WHERE id = ? AND draft_id = ?")
    .bind(claims.v, draft.id)
    .first<VersionRow>();
  if (!version) return notFound(c);
  if (!(await userStillMember(c, claims.u, claims.o))) return notFound(c);

  const resolved = await resolvePage(c, version, segments);
  if (!resolved) return notFound(c);
  if ("redirect" in resolved) return resolved.redirect;
  c.header("Referrer-Policy", "no-referrer");
  return sendPage(c, draft, version, resolved.page, new URL(config.publicBaseUrl).origin);
}
