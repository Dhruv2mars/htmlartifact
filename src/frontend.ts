import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import * as build from "../web/build/server/index.js";
import staticPages, { ORIGIN_TOKEN } from "../web/build/server/static-pages.js";
import type { ArtifactSummary, ArtifactVersion, Page, Session } from "../web/app/page.ts";
import type { DraftSummary, DraftWithVersions } from "./drafts.ts";
import type { AppEnv, Viewer } from "./types.ts";

// The web app (web/, React Router) renders every htmlartifact page; Hono
// still decides which page, for whom, and with what status. Pages get plain
// data (web/app/page.ts), never rows or viewers.

const serverBuild = build as unknown as ServerBuild;
const handle = createRequestHandler(serverBuild, "production");
type ContextKey = Parameters<RouterContextProvider["set"]>[0];
const { pageContext, originContext } = serverBuild.entry.module as unknown as {
  pageContext: ContextKey;
  originContext: ContextKey;
};

// Files from web/build/client the app host serves: hashed /assets/* plus the
// public files (og.png). Production Pages serves these before the Worker runs
// (_routes.json); this is the same thing for wrangler dev and the tests.
export function registerAssets(app: Hono<AppEnv>): void {
  const serve = (c: Context<AppEnv>) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound());
  app.get("/assets/*", serve);
  app.get("/og.png", serve);
}

export async function renderPage<E extends AppEnv>(c: Context<E>, page: Page, status: number = 200): Promise<Response> {
  // Pages that are the same for everyone were rendered at build time: serve
  // the string (Workers Free allows 10 ms of CPU; a cold React render costs
  // far more). Only the origin differs between deployments.
  const prerendered = staticPage(page);
  if (prerendered) {
    return c.body(prerendered.replaceAll(ORIGIN_TOKEN, c.get("origin")), status as ContentfulStatusCode, {
      "Content-Type": "text/html; charset=utf-8"
    });
  }
  // Always a GET of the current page: a page shown in answer to a form post
  // (an invalid invite, say) must not look like a React Router action, and a
  // path ending in .data must not turn into a React Router data request.
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/(\.data)+$/, "") || "/";
  url.searchParams.delete("_routes");
  const request = new Request(url, { method: "GET", headers: c.req.raw.headers });
  const context = new RouterContextProvider();
  context.set(pageContext, page);
  context.set(originContext, c.get("origin"));
  const response = await handle(request, context);
  const failed = response.status >= 500;
  return c.body(await response.text(), (failed ? response.status : status) as ContentfulStatusCode, {
    "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8"
  });
}

function staticPage(page: Page): string | null {
  if (page.kind === "landing" || page.kind === "not-found") return staticPages[page.kind];
  if (page.kind === "docs" && !page.session) return staticPages.docs;
  return null;
}

export function toSession(viewer: Viewer | null | undefined): Session | null {
  if (!viewer) return null;
  return {
    name: viewer.account_name,
    email: viewer.email,
    workspace: viewer.workspace
      ? { id: viewer.workspace.organization_id, name: viewer.workspace.name, handle: viewer.workspace.handle }
      : null
  };
}

export function toArtifacts(drafts: DraftSummary[]): ArtifactSummary[] {
  return drafts.map((d) => ({
    id: d.draftId,
    title: d.title,
    description: d.description,
    author: d.author,
    url: d.publicUrl,
    repo: d.repoOrg && d.repoName ? `${d.repoOrg}/${d.repoName}` : d.repoName,
    version: d.latestVersionNumber,
    versionCount: d.versionCount,
    updatedAt: d.updatedAt
  }));
}

export function toVersions({ draft, versions }: DraftWithVersions): ArtifactVersion[] {
  return versions.map((v) => ({
    number: Number(v.version_number),
    url: `${draft.versionBaseUrl}/v/${Number(v.version_number)}`,
    subject: v.git_commit_subject || null,
    branch: v.git_branch || null,
    commit: v.git_commit_sha ? v.git_commit_sha.slice(0, 7) : null,
    dirty: Boolean(v.git_dirty),
    size: Number(v.file_size) || 0,
    createdAt: v.created_at
  }));
}
