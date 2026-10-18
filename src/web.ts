import { createHash } from "node:crypto";
import type { Context, Hono, Next } from "hono";
import { joinWithCode } from "./api.ts";
import { isSecure, sessionViewer } from "./auth.ts";
import { randomToken } from "./crypto.ts";
import { findWorkspace, saveWorkspace } from "./db.ts";
import { getMyDraftWithVersions, listMyDrafts, listWorkspaceDrafts } from "./drafts.ts";
import { normalizeInviteCode, workspaceHandle } from "./ids.ts";
import { safeNext } from "./public-url.ts";
import { clientIp, rateLimit } from "./rate-limit.ts";
import {
  renderAuthError,
  renderDraftDetail,
  renderJoin,
  renderMine,
  renderSignIn,
  renderWorkspace,
  renderWorkspaces,
  type WorkspaceChoice
} from "./render-web.ts";
import { isMember, type AppEnv, type MemberEnv, type UserEnv, type Viewer } from "./types.ts";
import {
  authStateCookie,
  clearAuthStateCookie,
  clearSessionCookie,
  readAuthState,
  readCookie,
  SESSION_COOKIE,
  sessionCookie
} from "./web-auth.ts";
import { workos } from "./workos.ts";

// Browser pages. Thin on purpose: agents do everything through the CLI; the
// web is for signing in, browsing the workspace, and joining via a link.
export function registerWeb(app: Hono<AppEnv>): void {
  const writes = rateLimit({
    windowMs: 3_600_000,
    max: 30,
    keyPrefix: "web-write",
    key: (c) => c.get("viewer")?.account_id || clientIp(c)
  });

  app.get("/", signedIn, async (c) => {
    const viewer = c.get("viewer");
    if (!isMember(viewer)) return c.redirect("/workspaces");
    const drafts = await listWorkspaceDrafts(c.env.DB, {
      organizationId: viewer.organization_id,
      origin: c.get("origin"),
      handle: viewer.workspace.handle
    });
    return c.html(renderWorkspace({ session: viewer, drafts }));
  });

  app.get("/mine", signedIn, inWorkspace, async (c) => {
    const viewer = c.get("viewer");
    const drafts = await listMyDrafts(c.env.DB, {
      accountId: viewer.account_id,
      organizationId: viewer.organization_id,
      origin: c.get("origin"),
      handle: viewer.workspace.handle
    });
    return c.html(renderMine({ session: viewer, drafts }));
  });

  app.get("/mine/:draftId", signedIn, inWorkspace, async (c) => {
    const viewer = c.get("viewer");
    const draftId = c.req.param("draftId");
    if (!draftId) return c.notFound();
    const result = await getMyDraftWithVersions(c.env.DB, {
      accountId: viewer.account_id,
      organizationId: viewer.organization_id,
      draftId,
      origin: c.get("origin"),
      handle: viewer.workspace.handle
    });
    if (!result) return c.notFound();
    return c.html(renderDraftDetail({ session: viewer, ...result }));
  });

  app.get("/workspaces", signedIn, async (c) => {
    const viewer = c.get("viewer");
    const next = safeNext(c.req.query("next"));
    return c.html(
      renderWorkspaces({ session: viewer, workspaces: await listWorkspaces(c, viewer), next: next === "/" ? null : next })
    );
  });

  app.post("/workspaces", sameOrigin, signedIn, writes, async (c) => {
    const viewer = c.get("viewer");
    const name = String((await c.req.parseBody()).name || "").trim().slice(0, 100);
    if (!name) return c.redirect("/workspaces");
    const { client } = workos(c.get("config"));
    const organization = await client.organizations.createOrganization({ name });
    await client.userManagement.createOrganizationMembership({
      organizationId: organization.id,
      userId: viewer.account_id,
      roleSlug: "admin"
    });
    await saveWorkspace(c.env.DB, {
      organizationId: organization.id,
      handle: workspaceHandle(name),
      name,
      createdBy: viewer.account_id
    });
    return switchTo(c, organization.id);
  });

  app.post("/workspaces/switch", sameOrigin, signedIn, async (c) => {
    return switchTo(c, String((await c.req.parseBody()).id || ""));
  });

  // A shareable join link: /join/HA-XXXX-XXXX-XXXX.
  app.get("/join/:code", async (c) => {
    const code = normalizeInviteCode(c.req.param("code"));
    const viewer = await sessionViewer(c);
    if (!viewer) return c.html(renderSignIn({ next: c.req.path }), 401);
    const invite = code
      ? await c.env.DB.prepare(
          "SELECT organization_id FROM invites WHERE code = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses"
        )
          .bind(code)
          .first<{ organization_id: string }>()
      : null;
    if (!code || !invite) {
      return c.html(
        renderAuthError({ title: "Invite not valid", message: "That invite is invalid, expired, or used up.", retry: false }),
        404
      );
    }
    const workspace = await findWorkspace(c.env.DB, invite.organization_id);
    return c.html(renderJoin({ session: viewer, code, workspaceName: workspace?.name || "workspace" }));
  });

  app.post("/join", sameOrigin, signedIn, writes, async (c) => {
    const form = await c.req.parseBody();
    const result = await joinWithCode(c, c.get("viewer"), String(form.code || ""));
    if (!result.body.ok) {
      return c.html(renderAuthError({ title: "Invite not valid", message: result.body.error, retry: false }), result.status);
    }
    return switchTo(c, result.body.workspace.id, safeNext(form.next));
  });

  // ?org= forces sign-in into one workspace (when a switch needs a fresh
  // login, e.g. an organization that enforces SSO).
  app.get("/auth/sign-in", (c) => {
    const config = c.get("config");
    const verifier = randomToken(32);
    const state = randomToken(24);
    c.header(
      "Set-Cookie",
      authStateCookie({ state, verifier, next: safeNext(c.req.query("next")) }, config.cookiePassword, isSecure(c)),
      { append: true }
    );
    return c.redirect(
      workos(config).client.userManagement.getAuthorizationUrl({
        provider: "authkit",
        clientId: config.workos.clientId,
        redirectUri: `${c.get("origin")}/auth/callback`,
        state,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        codeChallengeMethod: "S256",
        organizationId: c.req.query("org") || undefined
      })
    );
  });

  app.get("/auth/callback", async (c) => {
    const config = c.get("config");
    const secure = isSecure(c);
    c.header("Set-Cookie", clearAuthStateCookie(secure), { append: true });
    if (c.req.query("error")) {
      return c.html(renderAuthError({ message: "Sign-in was cancelled or denied." }), 403);
    }
    const authState = readAuthState(c, config.cookiePassword);
    const { code, state } = c.req.query();
    if (!authState || !state || state !== authState.state) {
      return c.html(renderAuthError({ message: "Sign-in expired or state mismatch. Please retry." }), 400);
    }
    if (!code) return c.html(renderAuthError({ message: "Missing authorization code." }), 400);

    let sealedSession: string | undefined;
    let organizationId: string | undefined;
    try {
      ({ sealedSession, organizationId } = await workos(config).client.userManagement.authenticateWithCode({
        clientId: config.workos.clientId,
        code,
        codeVerifier: authState.verifier,
        session: { sealSession: true, cookiePassword: config.cookiePassword }
      }));
    } catch (error) {
      console.error("WorkOS sign-in failed:", error instanceof Error ? error.message : error);
      return c.html(renderAuthError({ message: "Sign-in could not be completed. Please retry." }), 502);
    }
    // sealSession: true always returns one; without it there is no session.
    if (!sealedSession) {
      return c.html(renderAuthError({ message: "Sign-in could not be completed. Please retry." }), 502);
    }
    c.header("Set-Cookie", sessionCookie(sealedSession, secure), { append: true });
    const next = safeNext(authState.next);
    if (organizationId || next.startsWith("/join/")) return c.redirect(next);
    // Not in a workspace yet: remember where they were going, so joining
    // takes them straight back to the link they opened.
    return c.redirect(next === "/" ? "/workspaces" : `/workspaces?next=${encodeURIComponent(next)}`);
  });

  app.post("/auth/sign-out", sameOrigin, async (c) => {
    const config = c.get("config");
    c.header("Set-Cookie", clearSessionCookie(isSecure(c)), { append: true });
    const sealed = readCookie(c, SESSION_COOKIE);
    let target = "/";
    if (sealed) {
      try {
        target = await workos(config)
          .client.userManagement.loadSealedSession({ sessionData: sealed, cookiePassword: config.cookiePassword })
          .getLogoutUrl({ returnTo: c.get("origin") });
      } catch {
        // Already expired: clearing the cookie is all there is to do.
      }
    }
    return c.redirect(target);
  });
}

async function signedIn(c: Context<UserEnv>, next: Next): Promise<Response | void> {
  const viewer = await sessionViewer(c);
  if (!viewer) return c.html(renderSignIn({ next: c.req.path }), 401);
  c.set("viewer", viewer);
  return next();
}

async function inWorkspace(c: Context<MemberEnv>, next: Next): Promise<Response | void> {
  const viewer: Viewer = c.get("viewer");
  if (!isMember(viewer)) return c.redirect("/workspaces");
  c.set("viewer", viewer);
  return next();
}

// CSRF defence for every state-changing browser route: SameSite=Lax stops
// cross-site posts but not ones from a sibling subdomain, so the browser-set
// Origin (or Referer) must be exactly this app.
async function sameOrigin<E extends AppEnv>(c: Context<E>, next: Next): Promise<Response | void> {
  const source = c.req.header("origin") || refererOrigin(c.req.header("referer"));
  if (source && source === new URL(c.get("origin")).origin) return next();
  return c.text("Cross-origin form submission refused.\n", 403);
}

function refererOrigin(value: string | undefined): string | null {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

// Moves the browser session into a workspace the user belongs to; one that
// needs a fresh login (SSO) gets one.
async function switchTo<E extends AppEnv>(c: Context<E>, organizationId: string, next = "/"): Promise<Response> {
  if (!organizationId) return c.redirect("/workspaces");
  const viewer = await sessionViewer(c, { organizationId });
  if (viewer?.organization_id === organizationId) return c.redirect(next);
  return c.redirect(`/auth/sign-in?org=${encodeURIComponent(organizationId)}&next=${encodeURIComponent(next)}`);
}

async function listWorkspaces<E extends AppEnv>(c: Context<E>, viewer: Viewer): Promise<WorkspaceChoice[]> {
  const page = await workos(c.get("config")).client.userManagement.listOrganizationMemberships({
    userId: viewer.account_id,
    statuses: ["active"],
    limit: 100
  });
  const workspaces: WorkspaceChoice[] = [];
  for (const m of page.data) {
    const workspace = await findWorkspace(c.env.DB, m.organizationId);
    workspaces.push({
      id: m.organizationId,
      name: workspace?.name || m.organizationName || m.organizationId,
      current: m.organizationId === viewer.organization_id
    });
  }
  return workspaces;
}
