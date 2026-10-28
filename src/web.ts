import { createHash } from "node:crypto";
import type { Context, Hono, Next } from "hono";
import {
  createInvite,
  inOpsBudget,
  deleteWorkspace,
  GRANT_ROWS,
  joinWithCode,
  leaveWorkspace,
  listInvites,
  listMembers,
  MEMBER_CHANGE_ROWS,
  removeMember,
  revokeInvite,
  setMemberRole,
  userWorkspaces,
  workspaceUsage,
  writeBudget,
  WORKSPACE_ROWS,
  type MemberInfo
} from "./api.ts";
import { activeMembership, isSecure, sessionViewer } from "./auth.ts";
import { randomToken } from "./crypto.ts";
import { findAccount, findWorkspace, saveWorkspace } from "./db.ts";
import { getDraftWithVersions, listMyDrafts, listWorkspaceDrafts } from "./drafts.ts";
import { normalizeInviteCode, workspaceHandle } from "./ids.ts";
import { safeNext } from "./public-url.ts";
import { checkLimit, clientIp, rateLimit } from "./rate-limit.ts";
import type { Confirmation, InviteLink, JoinFailure, Notice, Page, Person, Session, WorkspaceChoice } from "../web/app/page.ts";
import { renderPage, repoName, toArtifacts, toSession, toVersions } from "./frontend.ts";
import { isMember, type AppEnv, type MemberEnv, type UserEnv, type Viewer } from "./types.ts";
import {
  authStateCookie,
  clearAuthStateCookie,
  clearSessionCookie,
  noticeCookie,
  readAuthState,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  takeNotice
} from "./web-auth.ts";
import { workos } from "./workos.ts";

// Browser pages: signing in, browsing the workspace, joining via a link, and
// running the workspace (people, invite links, leaving, deleting) for the
// people who never open a terminal. Agents do everything through the CLI.
export function registerWeb(app: Hono<AppEnv>): void {
  const writes = rateLimit({
    windowMs: 3_600_000,
    max: 30,
    keyPrefix: "web-write",
    kind: "auth",
    key: (c) => c.get("viewer")?.account_id || clientIp(c)
  });

  // Pages that call WorkOS on every request: limited so one caller can't use up
  // the WorkOS rate limit every workspace shares.
  const workosReads = rateLimit({
    windowMs: 60_000,
    max: 60,
    keyPrefix: "web-workos",
    kind: "upload",
    key: (c) => c.get("viewer")?.account_id || clientIp(c)
  });
  // Signed out, so per network; loose enough for an office behind one NAT.
  const callbacks = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "web-callback", kind: "auth-ip", key: clientIp });

  // Signed out: the landing page. Signed in: the workspace feed.
  app.get("/", async (c) => {
    const viewer = await sessionViewer(c);
    if (!viewer) return renderPage(c, { kind: "landing", session: null });
    if (!isMember(viewer)) return c.redirect("/workspaces");
    const { drafts, nextCursor } = await listWorkspaceDrafts(c.env.DB, {
      organizationId: viewer.organization_id,
      origin: c.get("origin"),
      handle: viewer.workspace.handle,
      cursor: c.req.query("cursor")
    });
    return renderPage(c, {
      kind: "feed",
      session: await session(c, viewer),
      artifacts: toArtifacts(drafts),
      older: olderLink("/", nextCursor),
      usage: await nearlyFull(c, viewer)
    });
  });

  app.get("/docs", async (c) => renderPage(c, { kind: "docs", session: await session(c, await sessionViewer(c)) }));
  app.get("/privacy", async (c) => renderPage(c, { kind: "privacy", session: await session(c, await sessionViewer(c)) }));

  app.get("/mine", signedIn, inWorkspace, async (c) => {
    const viewer = c.get("viewer");
    const { drafts, nextCursor } = await listMyDrafts(c.env.DB, {
      accountId: viewer.account_id,
      organizationId: viewer.organization_id,
      origin: c.get("origin"),
      handle: viewer.workspace.handle,
      cursor: c.req.query("cursor")
    });
    return renderPage(c, {
      kind: "mine",
      session: await session(c, viewer),
      artifacts: toArtifacts(drafts),
      older: olderLink("/mine", nextCursor),
      usage: await nearlyFull(c, viewer)
    });
  });

  // Version history of any artifact in the workspace, not only your own. A
  // member of the artifact's workspace is switched into it, as artifact URLs
  // do; anyone else gets the same 404 as for a missing artifact.
  app.get("/history/:draftId", async (c, next) => {
    const owner = await c.env.DB.prepare("SELECT organization_id FROM drafts WHERE id = ? AND deleted_at IS NULL")
      .bind(c.req.param("draftId") || "")
      .first<{ organization_id: string }>();
    const viewer = await sessionViewer(c, { organizationId: owner?.organization_id });
    if (!viewer) return renderPage(c, { kind: "sign-in", next: c.req.path }, 401);
    c.set("viewer", viewer);
    return next();
  }, inWorkspace, async (c) => {
    const viewer = c.get("viewer");
    const draftId = c.req.param("draftId");
    if (!draftId) return c.notFound();
    const result = await getDraftWithVersions(c.env.DB, {
      accountId: viewer.account_id,
      organizationId: viewer.organization_id,
      draftId,
      origin: c.get("origin"),
      handle: viewer.workspace.handle
    });
    if (!result) return c.notFound();
    const { draft } = result;
    return renderPage(c, {
      kind: "artifact",
      session: await session(c, viewer),
      artifact: {
        id: draft.draftId,
        title: draft.title,
        description: draft.description,
        url: draft.publicUrl,
        author: draft.author,
        repo: repoName(draft),
        mine: draft.mine
      },
      versions: toVersions(result)
    });
  });

  // The old owner-only history URL; kept so bookmarks still work.
  app.get("/mine/:draftId", signedIn, inWorkspace, (c) => c.redirect(`/history/${encodeURIComponent(c.req.param("draftId") || "")}`, 301));

  app.get("/workspaces", signedIn, workosReads, async (c) => {
    return renderPage(c, await workspacesPage(c, c.get("viewer"), safeNext(c.req.query("next"))));
  });

  app.post("/workspaces", sameOrigin, signedIn, writes, writeBudget(WORKSPACE_ROWS), async (c) => {
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
    say(c, done(`Created ${name}. You're its admin: invite your team from People.`));
    return switchTo(c, organization.id);
  });

  // next: the link they followed, so switching takes them back to it.
  app.post("/workspaces/switch", sameOrigin, signedIn, workosReads, async (c) => {
    const form = await c.req.parseBody();
    return switchTo(c, String(form.id || ""), safeNext(form.next));
  });

  // A shareable join link: /join/HA-XXXX-XXXX-XXXX. Signed out, a live code
  // gets the anonymous sign-in page (it never names the workspace); a dead
  // one says so either way, instead of asking you to sign up first.
  app.get("/join/:code", async (c) => {
    const code = normalizeInviteCode(c.req.param("code"));
    const invite = code
      ? await c.env.DB.prepare(
          `SELECT organization_id, expires_at, max_uses - uses AS uses_left FROM invites
           WHERE code = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses`
        )
          .bind(code)
          .first<{ organization_id: string; expires_at: number; uses_left: number }>()
      : null;
    if (!code || !invite) {
      const text = "That invite link is invalid, expired, or used up. Ask whoever sent it for a new one.";
      return renderPage(c, message("Invite not valid", text, "/workspaces", "Enter another code"), 404);
    }
    const viewer = await sessionViewer(c);
    if (!viewer) return renderPage(c, { kind: "sign-in", next: c.req.path }, 401);
    const workspace = await findWorkspace(c.env.DB, invite.organization_id);
    const current = viewer.organization_id === invite.organization_id;
    const member = current || Boolean(await activeMembership(c, viewer.account_id, invite.organization_id));
    return renderPage(c, {
      kind: "join",
      session: await session(c, viewer),
      code,
      workspace: { id: invite.organization_id, name: workspace?.name || "workspace" },
      expiresAt: new Date(invite.expires_at * 1000).toISOString(),
      usesLeft: Number(invite.uses_left),
      member: current ? "current" : member ? "other" : null
    });
  });

  // A refused code comes back to the form, as typed, with the reason and the
  // link they were heading to.
  app.post("/join", sameOrigin, signedIn, writes, async (c) => {
    const form = await c.req.parseBody();
    const typed = typeof form.code === "string" ? form.code.trim().slice(0, 200) : "";
    const result = await joinWithCode(c, c.get("viewer"), typed);
    if (!result.body.ok) {
      const error =
        result.status === 404 ? "That invite code is invalid, expired, or used up. Check it for typos, or ask whoever sent it for a new one." : result.body.error;
      return renderPage(c, await workspacesPage(c, c.get("viewer"), safeNext(form.next), { code: typed, error }), result.status);
    }
    const joined = result.body.workspace.name || "the workspace";
    say(c, done(result.body.alreadyMember ? `You're already in ${joined}.` : `You joined ${joined}.`));
    return switchTo(c, result.body.workspace.id, safeNext(form.next));
  });

  // ---- People and workspace settings: what `htmlartifact workspace` does.
  // Each change calls the function its API route calls (src/api.ts), so the
  // checks, the admin lock and the revocations are one code path, and counts
  // against the same per-user limit. GET asks (a confirmation page says what
  // will happen), POST does it and redirects with a one-time notice.
  app.get("/people", signedIn, inWorkspace, workosReads, async (c) => {
    const viewer = c.get("viewer");
    const admin = viewer.role === "admin";
    const [members, invites] = await Promise.all([listMembers(c), admin ? listInvites(c) : null]);
    if (!members.body.ok) return renderPage(c, message("Couldn't load people", members.body.error, "/people"), members.status);
    const origin = c.get("origin");
    const { invites: limits } = c.get("config");
    return renderPage(c, {
      kind: "people",
      session: await session(c, viewer),
      people: members.body.members.map((m) => toPerson(m, viewer)).sort(adminsFirst),
      invites:
        invites && invites.body.ok
          ? invites.body.invites.map(
              (i): InviteLink => ({
                code: i.code,
                url: `${origin}/join/${i.code}`,
                createdAt: i.createdAt,
                expiresAt: i.expiresAt,
                uses: i.uses,
                maxUses: i.maxUses,
                createdBy: i.createdBy.name
              })
            )
          : null,
      // A team link defaults to 10 seats on the web: enough for a team, few
      // enough that a leaked link can't fill the workspace.
      invite: { days: inviteDays(limits.ttlDays), defaultDays: limits.ttlDays, defaultUses: Math.min(10, limits.maxUses), maxUses: limits.maxUses }
    });
  });

  app.post("/people/invites", sameOrigin, signedIn, inWorkspace, adminOnly, async (c) => {
    const viewer = c.get("viewer");
    if (await overLimit(c, "invite", 30)) return back(c, "/people", TOO_FAST);
    const form = await c.req.parseBody();
    const result = await inOpsBudget(c, GRANT_ROWS, "invite", async () => {
      const made = await createInvite(c, { ttlDays: field(form.days) || undefined, maxUses: field(form.uses) || undefined });
      if (!made.body.ok) return back(c, "/people", problem(made.body.error));
      return back(c, "/people#links", { tone: "done", text: "New invite link ready. Copy it and send it to your team.", fresh: made.body.code });
    });
    return typeof result === "string" ? back(c, "/people", problem(result)) : result;
  });

  app.post("/people/invites/revoke", sameOrigin, signedIn, inWorkspace, adminOnly, async (c) => {
    if (await overLimit(c, "invite-revoke", 30)) return back(c, "/people#links", TOO_FAST);
    const code = field((await c.req.parseBody()).code);
    const all = code.toLowerCase() === "all";
    const revoked = await revokeInvite(c, code);
    if (!revoked.body.ok) return back(c, "/people#links", problem("That link had already stopped working."));
    return back(c, "/people#links", done(all ? "Every invite link was revoked. They stop working right away." : "Invite link revoked. It stops working right away."));
  });

  app.get("/people/:userId/:change{make-admin|make-member|remove}", signedIn, inWorkspace, adminOnly, workosReads, async (c) => {
    const viewer = c.get("viewer");
    const members = await listMembers(c);
    const everyone = members.body.ok ? members.body.members : [];
    const person = everyone.find((m) => m.id === c.req.param("userId"));
    if (!person) return back(c, "/people", problem("That person isn't in this workspace anymore."));
    const confirm = await personChange(c, toPerson(person, viewer), everyone, c.req.param("change") as PersonChange);
    return renderPage(c, { kind: "confirm", session: await session(c, viewer), section: "people", confirm });
  });

  app.post("/people/:userId/:change{make-admin|make-member|remove}", sameOrigin, signedIn, inWorkspace, adminOnly, async (c) => {
    const viewer = c.get("viewer");
    const userId = c.req.param("userId") || "";
    const change = c.req.param("change") as PersonChange;
    const you = userId === viewer.account_id;
    const name = you ? "You" : (await findAccount(c.env.DB, userId))?.name || "They";
    if (change === "remove") {
      if (await overLimit(c, "member-remove", 30)) return back(c, "/people", TOO_FAST);
      const removed = await removeMember(c, userId, "web");
      if (!removed.body.ok) return back(c, "/people", problem(removed.body.error));
      return back(
        c,
        "/people#links",
        done(`${name} no longer has access to ${viewer.workspace.name}. Invite links made before now stopped working: make a new one if your team needs it.`)
      );
    }
    if (await overLimit(c, "member-role", 30)) return back(c, "/people", TOO_FAST);
    const role = change === "make-admin" ? "admin" : "member";
    const result = await inOpsBudget(c, MEMBER_CHANGE_ROWS, "member change", async () => {
      const changed = await setMemberRole(c, userId, role);
      if (!changed.body.ok) return back(c, "/people", problem(changed.body.error));
      const now = role === "admin" ? "an admin" : "a member";
      return back(c, you && role === "member" ? "/" : "/people", done(`${name} ${you ? "are" : "is"} now ${now} of ${viewer.workspace.name}.`));
    });
    return typeof result === "string" ? back(c, "/people", problem(result)) : result;
  });

  app.get("/settings", signedIn, inWorkspace, workosReads, async (c) => {
    const viewer = c.get("viewer");
    const [usage, members] = await Promise.all([workspaceUsage(c, viewer.organization_id), listMembers(c)]);
    const admins = members.body.ok ? members.body.members.filter((m) => m.role === "admin").map((m) => m.name) : [];
    return renderPage(c, {
      kind: "settings",
      session: await session(c, viewer),
      usage: { storedBytes: usage.storedBytes, limitBytes: usage.limitBytes },
      admins
    });
  });

  app.get("/settings/:change{leave|delete}", signedIn, inWorkspace, workosReads, async (c) => {
    const viewer = c.get("viewer");
    const change = c.req.param("change") as "leave" | "delete";
    if (change === "delete" && viewer.role !== "admin") return back(c, "/settings", ADMINS_ONLY);
    const members = await listMembers(c);
    const everyone = members.body.ok ? members.body.members : [];
    const confirm = change === "leave" ? await leaving(c, everyone) : await deleting(c, everyone);
    return renderPage(c, { kind: "confirm", session: await session(c, viewer), section: "settings", confirm });
  });

  app.post("/settings/leave", sameOrigin, signedIn, inWorkspace, async (c) => {
    const viewer = c.get("viewer");
    if (await overLimit(c, "leave", 10)) return back(c, "/settings", TOO_FAST);
    const left = await leaveWorkspace(c, "web");
    if (!left.body.ok) return back(c, "/settings", problem(left.body.error));
    // The next page moves the session into the only workspace left, if any.
    return back(c, "/", done(`You left ${viewer.workspace.name}.`));
  });

  app.post("/settings/delete", sameOrigin, signedIn, inWorkspace, adminOnly, async (c) => {
    const viewer = c.get("viewer");
    if (await overLimit(c, "workspace-delete", 5)) return back(c, "/settings/delete", TOO_FAST);
    const gone = await deleteWorkspace(c, field((await c.req.parseBody()).confirm), "web");
    if (!gone.body.ok) return back(c, "/settings/delete", problem(gone.body.error));
    return back(c, "/", done(`${viewer.workspace.name} was deleted, with everything in it.`));
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

  app.get("/auth/callback", callbacks, async (c) => {
    const config = c.get("config");
    const secure = isSecure(c);
    c.header("Set-Cookie", clearAuthStateCookie(secure), { append: true });
    const authState = readAuthState(c, config.cookiePassword);
    const retry = retrySignIn(authState?.next);
    if (c.req.query("error")) {
      return renderPage(c, message("Sign-in problem", "Sign-in was cancelled or denied.", retry), 403);
    }
    const { code, state } = c.req.query();
    if (!authState || !state || state !== authState.state) {
      return renderPage(c, message("Sign-in problem", "Sign-in expired or state mismatch. Please retry.", retry), 400);
    }
    if (!code) return renderPage(c, message("Sign-in problem", "Missing authorization code.", retry), 400);

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
      return renderPage(c, message("Sign-in problem", "Sign-in could not be completed. Please retry.", retry), 502);
    }
    // sealSession: true always returns one; without it there is no session.
    if (!sealedSession) {
      return renderPage(c, message("Sign-in problem", "Sign-in could not be completed. Please retry.", retry), 502);
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

// The page's session, with what to say once: the last change's notice, or
// else that they lost a workspace (and where the server moved them, if it did).
async function session<E extends AppEnv>(c: Context<E>, viewer: Viewer): Promise<Session>;
async function session<E extends AppEnv>(c: Context<E>, viewer: Viewer | null): Promise<Session | null>;
async function session<E extends AppEnv>(c: Context<E>, viewer: Viewer | null): Promise<Session | null> {
  if (!viewer) return null;
  let notice = takeNotice(c, viewer.account_id, c.get("config").cookiePassword, isSecure(c));
  if (!notice && viewer.removed_from) {
    const lost = (await findWorkspace(c.env.DB, viewer.removed_from))?.name || "a workspace you were in";
    notice = problem(
      viewer.workspace
        ? `You no longer have access to ${lost}, so you're now in ${viewer.workspace.name}.`
        : `You no longer have access to ${lost}. Pick another workspace, or ask one of its admins for a new invite link.`
    );
  }
  return toSession(viewer, notice);
}

// The workspace's storage when it is nearly full: admins (who can clean up)
// hear at 80%, everyone at 95%, before uploads and CI start failing.
async function nearlyFull<E extends AppEnv>(c: Context<E>, viewer: Viewer): Promise<{ storedBytes: number; limitBytes: number } | null> {
  if (!viewer.organization_id) return null;
  const { storedBytes, limitBytes } = await workspaceUsage(c, viewer.organization_id);
  const share = limitBytes ? storedBytes / limitBytes : 0;
  return share >= (viewer.role === "admin" ? 0.8 : 0.95) ? { storedBytes, limitBytes } : null;
}

// Sets the notice the next page shows.
function say<E extends UserEnv>(c: Context<E>, notice: Notice): void {
  c.header("Set-Cookie", noticeCookie(notice, c.get("viewer").account_id, c.get("config").cookiePassword, isSecure(c)), { append: true });
}

// After a change: to a page (303, so a reload doesn't post again), which
// says what happened.
function back<E extends UserEnv>(c: Context<E>, to: string, notice: Notice): Response {
  say(c, notice);
  return c.redirect(to, 303);
}

const done = (text: string): Notice => ({ tone: "done", text });
const problem = (text: string): Notice => ({ tone: "problem", text });
const TOO_FAST = problem("That's a lot of changes at once. Wait a minute, then try again.");
const ADMINS_ONLY = problem("Only workspace admins can do that.");

// The API route's per-user limit for the same action, in the same bucket.
async function overLimit<E extends UserEnv>(c: Context<E>, keyPrefix: string, max: number): Promise<boolean> {
  return !(await checkLimit(c, { windowMs: 60_000, max, keyPrefix, kind: "upload" }, c.get("viewer").account_id)).ok;
}

// The cached role hides what members can't do; the change itself re-checks.
async function adminOnly(c: Context<MemberEnv>, next: Next): Promise<Response | void> {
  if (c.get("viewer").role !== "admin") return back(c, c.req.path.startsWith("/settings") ? "/settings" : "/people", ADMINS_ONLY);
  return next();
}

const field = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, 200) : "");

// How long a new invite link can last, in days (the API allows 1 to 30).
const inviteDays = (defaultDays: number): number[] => [...new Set([1, 7, 30, defaultDays])].filter((d) => d >= 1 && d <= 30).sort((a, b) => a - b);

const toPerson = (m: MemberInfo, viewer: Viewer): Person => ({
  id: m.id,
  name: m.name,
  email: m.email,
  role: m.role === "admin" ? "admin" : "member",
  joinedAt: m.joinedAt,
  you: m.id === viewer.account_id
});

const adminsFirst = (a: Person, b: Person): number =>
  Number(b.role === "admin") - Number(a.role === "admin") || a.name.localeCompare(b.name, "en", { sensitivity: "base" });

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

type PersonChange = "make-admin" | "make-member" | "remove";

// What changing one person's place in the workspace will do, from live counts.
async function personChange(c: Context<MemberEnv>, person: Person, everyone: MemberInfo[], change: PersonChange): Promise<Confirmation> {
  const viewer = c.get("viewer");
  const db = c.env.DB;
  const workspace = viewer.workspace.name;
  const name = person.you ? "you" : person.name;
  const Name = person.you ? "You" : person.name;
  const back = { href: "/people", label: "Back to People" };
  const action = `/people/${encodeURIComponent(person.id)}/${change}`;
  const otherAdmins = everyone.filter((m) => m.role === "admin" && m.id !== person.id).length;
  if (change === "make-admin") {
    return {
      title: `Make ${person.name} an admin?`,
      lead: `Admins run ${workspace}. ${person.name} will be able to:`,
      points: [
        "Invite people, and revoke invite links",
        "Make others admins or members, and remove people",
        "Update and delete anyone's artifacts",
        "Create CI keys, and delete the workspace"
      ],
      action,
      fields: {},
      submit: "Make admin",
      tone: "plain",
      back,
      ...(person.role === "admin" ? { blocked: `${person.name} is already an admin.` } : {})
    };
  }
  if (change === "make-member") {
    const [invites, keys] = await Promise.all([
      count(db, "SELECT COUNT(*) AS n FROM invites WHERE organization_id = ? AND created_by = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses", viewer.organization_id, person.id),
      count(db, "SELECT COUNT(*) AS n FROM ci_keys WHERE organization_id = ? AND created_by = ? AND revoked_at IS NULL", viewer.organization_id, person.id)
    ]);
    const points = [
      `${Name} keep${person.you ? "" : "s"} reading and publishing, like every member.`,
      ...(invites ? [`${plural(invites, "invite link")} ${name} made stop${invites === 1 ? "s" : ""} working.`] : []),
      ...(keys ? [`${plural(keys, "CI key")} ${name} made stop${keys === 1 ? "s" : ""} working, so CI using ${keys === 1 ? "it" : "them"} can't publish.`] : [])
    ];
    const blocked =
      person.role !== "admin"
        ? `${person.name} is already a member.`
        : !otherAdmins
          ? `${person.you ? "You're" : `${person.name} is`} the only admin. Make someone else an admin first.`
          : undefined;
    return {
      title: person.you ? "Stop being an admin?" : `Make ${person.name} a member?`,
      lead: person.you
        ? `You become a member of ${workspace} right away. Another admin can make you an admin again.`
        : `${person.name} stops being an admin of ${workspace} right away.`,
      points,
      action,
      fields: {},
      submit: person.you ? "Stop being an admin" : "Make member",
      tone: "plain",
      back,
      ...(blocked ? { blocked } : {})
    };
  }
  const [liveInvites, artifacts] = await Promise.all([
    count(db, "SELECT COUNT(*) AS n FROM invites WHERE organization_id = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses", viewer.organization_id),
    count(db, "SELECT COUNT(*) AS n FROM drafts WHERE organization_id = ? AND account_id = ? AND deleted_at IS NULL", viewer.organization_id, person.id)
  ]);
  return {
    title: `Remove ${person.name} from ${workspace}?`,
    lead: `${person.name} loses access to ${workspace} right away, on the web and in the CLI.`,
    points: [
      ...(liveInvites
        ? [`${liveInvites === 1 ? "The live invite link stops" : liveInvites === 2 ? "Both live invite links stop" : `All ${liveInvites} live invite links stop`} working, because ${person.name} might have one. You can make a new one right after.`]
        : []),
      ...(artifacts ? [`The ${plural(artifacts, "artifact")} they published stay${artifacts === 1 ? "s" : ""}. Admins can still update or delete ${artifacts === 1 ? "it" : "them"}.`] : []),
      `To come back, ${person.name} needs a new invite link.`
    ],
    action,
    fields: {},
    submit: `Remove ${person.name}`,
    tone: "danger",
    back,
    ...(person.you ? { blocked: "To leave the workspace yourself, use Leave workspace in Settings." } : {})
  };
}

async function leaving(c: Context<MemberEnv>, everyone: MemberInfo[]): Promise<Confirmation> {
  const viewer = c.get("viewer");
  const db = c.env.DB;
  const workspace = viewer.workspace.name;
  const admin = viewer.role === "admin";
  const [artifacts, invites] = await Promise.all([
    count(db, "SELECT COUNT(*) AS n FROM drafts WHERE organization_id = ? AND account_id = ? AND deleted_at IS NULL", viewer.organization_id, viewer.account_id),
    admin
      ? count(db, "SELECT COUNT(*) AS n FROM invites WHERE organization_id = ? AND created_by = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses", viewer.organization_id, viewer.account_id)
      : 0
  ]);
  const lastAdmin = admin && !everyone.some((m) => m.role === "admin" && m.id !== viewer.account_id);
  return {
    title: `Leave ${workspace}?`,
    lead: `You lose access to everything in ${workspace} right away.`,
    points: [
      ...(artifacts ? [`Your ${plural(artifacts, "artifact")} stay${artifacts === 1 ? "s" : ""} in ${workspace} for the team. You won't be able to update or delete ${artifacts === 1 ? "it" : "them"}.`] : []),
      ...(invites ? [`${plural(invites, "invite link")} you made stop${invites === 1 ? "s" : ""} working.`] : []),
      "To come back, you need a new invite link from an admin."
    ],
    action: "/settings/leave",
    fields: {},
    submit: `Leave ${workspace}`,
    tone: "danger",
    back: { href: "/settings", label: "Back to Settings" },
    ...(lastAdmin ? { blocked: `You're the only admin of ${workspace}. Make someone else an admin on People first, or delete the workspace.` } : {})
  };
}

async function deleting(c: Context<MemberEnv>, everyone: MemberInfo[]): Promise<Confirmation> {
  const viewer = c.get("viewer");
  const workspace = viewer.workspace.name;
  const artifacts = await count(c.env.DB, "SELECT COUNT(*) AS n FROM drafts WHERE organization_id = ? AND deleted_at IS NULL", viewer.organization_id);
  const others = everyone.filter((m) => m.id !== viewer.account_id).length;
  return {
    title: `Delete ${workspace}?`,
    lead: `This deletes ${workspace} and everything in it, for everyone. It can't be undone.`,
    points: [
      artifacts ? `${plural(artifacts, "artifact")}, with every version, are erased. Their links stop opening.` : "Every artifact link stops opening.",
      ...(others ? [`${plural(others, "other person", "other people")} lose${others === 1 ? "s" : ""} access.`] : []),
      "Every invite link and CI key stops working."
    ],
    action: "/settings/delete",
    fields: {},
    submit: "Delete workspace",
    tone: "danger",
    type: workspace,
    back: { href: "/settings", label: "Back to Settings" }
  };
}

async function count(db: D1Database, sql: string, ...values: string[]): Promise<number> {
  return Number((await db.prepare(sql).bind(...values).first<{ n: number }>())?.n || 0);
}

// A feed shows FEED_PAGE_SIZE artifacts; this links the next, older page.
const olderLink = (path: string, cursor: string | null) => (cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : null);

// `retry` is where the retry button goes: sign-in again, back to the page (or
// invite) the user was on. `retryLabel` names it when "Try again" doesn't fit.
function message(title: string, text: string, retry: string | null = "/auth/sign-in", retryLabel?: string): Page {
  return { kind: "message", title, message: text, retry, ...(retryLabel ? { retryLabel } : {}), session: null };
}

const retrySignIn = (next: string | undefined) => `/auth/sign-in?next=${encodeURIComponent(safeNext(next))}`;

async function signedIn(c: Context<UserEnv>, next: Next): Promise<Response | void> {
  const viewer = await sessionViewer(c);
  if (!viewer) return renderPage(c, { kind: "sign-in", next: c.req.path }, 401);
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
  if (!organizationId) return c.redirect(next === "/" ? "/workspaces" : `/workspaces?next=${encodeURIComponent(next)}`);
  const viewer = await sessionViewer(c, { organizationId });
  if (viewer?.organization_id === organizationId) return c.redirect(next);
  return c.redirect(`/auth/sign-in?org=${encodeURIComponent(organizationId)}&next=${encodeURIComponent(next)}`);
}

// The workspaces page: switch, create, join. `next` (already safeNext'd) is
// where joining or switching goes afterwards; `join`, a refused code.
async function workspacesPage<E extends AppEnv>(c: Context<E>, viewer: Viewer, next: string, join?: JoinFailure): Promise<Page> {
  const workspaces = await userWorkspaces(c, viewer.account_id, viewer.organization_id);
  return {
    kind: "workspaces",
    session: await session(c, viewer),
    workspaces: workspaces.map(({ id, name, current }): WorkspaceChoice => ({ id, name, current })),
    next: next === "/" ? null : next,
    join: join ?? null
  };
}
