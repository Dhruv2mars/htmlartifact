import type { Context, Hono, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { randomToken, sha256 } from "./crypto.ts";
import { FLAGS, bumpMembershipEpoch, databaseUsage, findWorkspace, findWorkspaceByHandle, isRevoked, now, revokeAllInvites, revokeInvitesUpTo, saveWorkspace, setRevoked, setRevokedAtEpoch, workspaceStoredBytes } from "./db.ts";
import { listMyDrafts, listWorkspaceDrafts } from "./drafts.ts";
// The Worker validates with the native HTMLRewriter (Workers Free CPU limits);
// parse5 (src/html-policy.ts) stays in the CLI.
import { formatBytes, type Issue, type PageInput } from "./html-policy-rules.ts";
import { validateUpload } from "./html-policy-server.ts";
import { CI_KEY_PREFIX, newCiKeyId, newDraftId, newInternalId, newInviteCode, normalizeInviteCode, workspaceHandle } from "./ids.ts";
import { draftUrl, slugProblem } from "./public-url.ts";
import { checkLimit, clientIp, rateLimit, tooMany } from "./rate-limit.ts";
import { activeMembership, bearerViewer, userStillMember } from "./auth.ts";
import { deleteWorkspaceStatements, draftPrefix, isWorkspaceDeleted, membershipBeingUndone, pruneVersions, purgeDraft, queueDeletion, runDeletion, runWorkspaceDeletions, undoJoin, versionPrefix } from "./purge.ts";
import { reserveBudget, secondsUntilUtcMidnight } from "./budget.ts";
import { reserveR2Writes, stageObjects, storageKind } from "./storage.ts";
import {
  isMember,
  type AppEnv,
  type Config,
  type DraftRow,
  type LimitKind,
  type MemberEnv,
  type MemberViewer,
  type UserEnv,
  type VersionRow,
  type Viewer,
  type WorkspaceRow
} from "./types.ts";
import { displayName, portalLink, revokePortalLinks, workos } from "./workos.ts";

// A request body, before validation: any field may hold anything.
type JsonBody = Record<string, unknown>;

// What /api/uploads reads from its body. Only `metadata` is assumed to be an
// object; everything else is checked where it is used.
interface UploadBody extends JsonBody {
  metadata?: Record<string, unknown>;
}

// The result of joinWithCode, for both the API and the browser page.
type JoinResult =
  | { status: ContentfulStatusCode; body: { ok: false; error: string } }
  | {
      status: ContentfulStatusCode;
      body: {
        ok: true;
        alreadyMember: boolean;
        workspace: { id: string; name: string | undefined; handle: string | undefined };
      };
    };

// An Error carrying the HTTP status app.onError should answer with.
export interface HttpError extends Error {
  status: ContentfulStatusCode;
}

// The /api/check report.
interface CheckReport {
  ok: boolean;
  account: { id: string; name: string };
  workspace: ReturnType<typeof workspaceJson>;
  limits: { maxBytes: number; maxPages: number };
  usage: WorkspaceUsage;
  capabilities: {
    inlineScripts: boolean;
    multiPage: boolean;
    customUrls: boolean;
    externalAssets: string;
    blockedInSandbox: string[];
  };
  totalBytes?: number;
  pages?: { path: string; bytes: number; title: string | null; hasScripts: boolean }[];
  issues?: Issue[];
  errors?: string[];
  warnings?: string[];
  slug?: { slug: string; status: "available" | "yours" | "taken" | "unavailable"; message?: string };
}

// The workspace's storage (src/config.ts: limits.workspaceBytes), as /api/check,
// /api/drafts and pruning report it.
interface WorkspaceUsage {
  storedBytes: number;
  limitBytes: number;
  remainingBytes: number;
}

// What scripted artifacts cannot do, reported by /api/check so agents can
// plan around the sandbox before they build a page.
const SANDBOX_LIMITS = [
  "script src (external scripts)",
  "fetch, XHR, WebSocket, and EventSource",
  "localStorage, sessionStorage, indexedDB, and cookies",
  "alert, confirm, and prompt",
  "workers",
  "forms",
  "iframes, embeds, and objects",
  "meta refresh",
  "file downloads",
  "plain links to other sites (open them in a new tab with target=\"_blank\")"
];

// Live workspace CI keys per workspace.
const MAX_CI_KEYS = 20;

// JSON API used by the CLI (and so by agents). Every route takes a bearer
// credential; nothing here reads cookies.
export function registerApi(app: Hono<AppEnv>): void {
  const perUser = (keyPrefix: string, max: number, kind: LimitKind = "upload") =>
    rateLimit({ windowMs: 60_000, max, keyPrefix, kind, key: (c) => c.get("viewer")?.account_id || clientIp(c) });
  const perIp = (keyPrefix: string, max: number, kind: LimitKind = "auth") =>
    rateLimit({ windowMs: 60_000, max, keyPrefix, kind, key: clientIp });

  // ---- CLI sign-in: the WorkOS device flow, relayed so the CLI holds no
  // WorkOS credentials. A new user signs up on the same WorkOS page.
  //
  // Limits: a loose per-IP ceiling over every step ("auth-ip", so an office
  // behind one NAT can sign in together), and a tight one per credential
  // ("auth": per device code, refresh token or pending token, by hash).
  // Device polling alone is ~12 calls a minute per sign-in.
  app.post("/api/cli/device", perIp("cli-device", 30), async (c) => {
    const config = c.get("config");
    return relayWorkos(c, "/user_management/authorize/device", { client_id: config.workos.clientId });
  });

  app.post("/api/cli/token", perIp("cli-auth-ip", 120, "auth-ip"), async (c) => {
    const config = c.get("config");
    const body = await readJson(c, 16 * 1024);
    let grant: Record<string, string>;
    let credential: string;
    if (typeof body.device_code === "string") {
      grant = { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: body.device_code };
      credential = `device:${body.device_code}`;
    } else if (typeof body.refresh_token === "string") {
      grant = { grant_type: "refresh_token", refresh_token: body.refresh_token };
      credential = `refresh:${body.refresh_token}`;
    } else if (typeof body.pending_authentication_token === "string") {
      grant = {
        grant_type: "urn:workos:oauth:grant-type:organization-selection",
        pending_authentication_token: body.pending_authentication_token
      };
      credential = `pending:${body.pending_authentication_token}`;
    } else {
      return c.json({ error: "invalid_request" }, 400);
    }
    const verdict = await checkLimit(c, { windowMs: 60_000, max: 30, keyPrefix: "cli-token", kind: "auth" }, sha256(credential));
    if (!verdict.ok) return tooMany(c, verdict.retryAfter);
    if (typeof body.organization_id === "string") grant.organization_id = body.organization_id;
    return relayWorkos(c, "/user_management/authenticate", {
      ...grant,
      client_id: config.workos.clientId,
      client_secret: config.workos.apiKey
    });
  });

  // `htmlartifact logout`: ends the caller's own WorkOS session (the access
  // token's sid), so the saved refresh token stops working too. Revoked here
  // first, so this app refuses the session at once even if WorkOS is down.
  // Nothing in the body is read: only the caller's session can be ended.
  app.post("/api/cli/logout", requireUser, perUser("cli-logout", 20, "auth"), async (c) => {
    const viewer = c.get("viewer");
    const sessionId = viewer.credential_id;
    if (viewer.is_api_key || !sessionId) {
      return c.json({ ok: false, error: "Only a CLI sign-in can be signed out. Revoke API keys in the WorkOS dashboard." }, 400);
    }
    await setRevoked(c.env.DB, sessionId, "*", true);
    try {
      await workos(c.get("config")).client.userManagement.revokeSession({ sessionId });
    } catch (error) {
      // 404: WorkOS has already ended it.
      if ((error as { status?: unknown })?.status !== 404) {
        console.error("WorkOS session revocation failed:", error instanceof Error ? error.message : error);
        return c.json({ ok: false, error: "Signed out here, but WorkOS could not end the session. It expires on its own." }, 502);
      }
    }
    return c.json({ ok: true });
  });

  // ---- Who am I. Works before joining any workspace.
  app.get("/api/me", requireUser, async (c) => {
    const viewer = c.get("viewer");
    return c.json({
      ok: true,
      userId: viewer.account_id,
      name: viewer.account_name,
      email: viewer.email,
      workspace: viewer.workspace ? workspaceJson(viewer.workspace, viewer.role) : null,
      removedFrom: await removedFromName(c.env.DB, viewer)
    });
  });

  // ---- Workspaces
  app.get("/api/workspaces", requireUser, async (c) => {
    const viewer = c.get("viewer");
    if (viewer.is_api_key) {
      return c.json({ ok: true, workspaces: [{ ...workspaceJson(viewer.workspace), current: true }] });
    }
    const page = await workos(c.get("config")).client.userManagement.listOrganizationMemberships({
      userId: viewer.account_id,
      statuses: ["active"],
      limit: 100
    });
    const workspaces: { id: string; name: string; handle: string | null; role: string | null; current: boolean }[] = [];
    for (const m of page.data) {
      // WorkOS deletes the organization after ours is gone (and can lag, or
      // fail and be retried by the cron): a deleted workspace is not listed.
      if (await isWorkspaceDeleted(c.env.DB, m.organizationId)) continue;
      const workspace = await findWorkspace(c.env.DB, m.organizationId);
      workspaces.push({
        id: m.organizationId,
        name: workspace?.name || m.organizationName || m.organizationId,
        handle: workspace?.handle || null,
        role: m.role?.slug || null,
        current: m.organizationId === viewer.organization_id
      });
    }
    return c.json({ ok: true, workspaces });
  });

  // Creates a WorkOS organization with the caller as its admin. The CLI then
  // refreshes its token into the new workspace.
  app.post("/api/workspaces", requireUser, perUser("workspace-create", 10), async (c) => {
    const viewer = c.get("viewer");
    if (viewer.is_api_key) return c.json({ ok: false, error: "API keys cannot create workspaces." }, 403);
    const body = await readJson(c, 16 * 1024);
    const name = cleanText(body.name, 100);
    if (!name) return c.json({ ok: false, error: "Give the workspace a name." }, 422);

    const { client } = workos(c.get("config"));
    const organization = await client.organizations.createOrganization({ name });
    await client.userManagement.createOrganizationMembership({
      organizationId: organization.id,
      userId: viewer.account_id,
      roleSlug: "admin"
    });
    const handle = workspaceHandle(name);
    await saveWorkspace(c.env.DB, { organizationId: organization.id, handle, name, createdBy: viewer.account_id });
    return c.json({ ok: true, workspace: { id: organization.id, name, handle, role: "admin" } }, 201);
  });

  // An invite code for the caller's current workspace. Admins only: a code
  // is a key to every artifact in the workspace.
  app.post("/api/workspaces/invites", requireMember, requireAdmin, perUser("invite", 30), async (c) => {
    const viewer = c.get("viewer");
    const { invites } = c.get("config");
    const body = await readJson(c, 16 * 1024);
    const maxUses = rangeInt(body.maxUses, 1, invites.maxUses, invites.maxUses);
    const ttlDays = rangeInt(body.ttlDays, 1, MAX_INVITE_DAYS, invites.ttlDays);
    if (maxUses === null) return c.json({ ok: false, error: `maxUses must be a whole number from 1 to ${invites.maxUses}.` }, 422);
    if (ttlDays === null) return c.json({ ok: false, error: `ttlDays must be a whole number from 1 to ${MAX_INVITE_DAYS}.` }, 422);
    const code = newInviteCode();
    const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 86400;
    await c.env.DB.prepare(
      "INSERT INTO invites (code, organization_id, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(code, viewer.organization_id, viewer.account_id, expiresAt, maxUses)
      .run();
    return c.json(
      {
        ok: true,
        code,
        workspace: workspaceJson(viewer.workspace),
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        maxUses,
        joinUrl: `${c.get("origin")}/join/${code}`
      },
      201
    );
  });

  // The workspace's live invite codes (admins only). ?all=1 adds spent,
  // expired and revoked codes, each with its status and who joined with it.
  app.get("/api/workspaces/invites", requireMember, requireAdmin, async (c) => {
    const viewer = c.get("viewer");
    const db = c.env.DB;
    const all = c.req.query("all") === "1";
    const { results } = await db
      .prepare(
        `SELECT code, created_at, expires_at, max_uses, uses, revoked_at FROM invites
         WHERE organization_id = ?${all ? "" : " AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses"}
         ORDER BY created_at DESC LIMIT 100`
      )
      .bind(viewer.organization_id)
      .all<{ code: string; created_at: number; expires_at: number; max_uses: number; uses: number; revoked_at: number | null }>();
    const joined = new Map<string, { name: string | null; email: string | null; joinedAt: string }[]>();
    if (all) {
      const { results: rows } = await db
        .prepare(
          `SELECT j.code, j.joined_at, a.name, a.email FROM invite_joins j LEFT JOIN accounts a ON a.id = j.user_id
           WHERE j.organization_id = ? ORDER BY j.joined_at`
        )
        .bind(viewer.organization_id)
        .all<{ code: string; joined_at: number; name: string | null; email: string | null }>();
      for (const row of rows) {
        joined.set(row.code, [...(joined.get(row.code) || []), { name: row.name, email: row.email, joinedAt: iso(row.joined_at) }]);
      }
    }
    const status = (i: (typeof results)[number]) =>
      i.revoked_at ? "revoked" : i.uses >= i.max_uses ? "used up" : i.expires_at <= now() ? "expired" : "live";
    return c.json({
      ok: true,
      invites: results.map((i) => ({
        code: i.code,
        createdAt: iso(i.created_at),
        expiresAt: iso(i.expires_at),
        uses: i.uses,
        maxUses: i.max_uses,
        ...(all ? { status: status(i), joined: joined.get(i.code) || [] } : {})
      }))
    });
  });

  // Revokes one invite code (admins only); "all" revokes every live code.
  app.delete("/api/workspaces/invites/:code", requireMember, requireAdmin, async (c) => {
    const viewer = c.get("viewer");
    const param = c.req.param("code") || "";
    if (param.toLowerCase() === "all") {
      await revokeAllInvites(c.env.DB, viewer.organization_id);
      return c.json({ ok: true });
    }
    const code = normalizeInviteCode(param);
    const result = code
      ? await c.env.DB.prepare("UPDATE invites SET revoked_at = unixepoch() WHERE code = ? AND organization_id = ? AND revoked_at IS NULL")
          .bind(code, viewer.organization_id)
          .run()
      : null;
    if (!result?.meta.changes) return c.json({ ok: false, error: "No such live invite code in this workspace." }, 404);
    return c.json({ ok: true });
  });

  // Workspace CI keys (admins only): HTMLARTIFACT_TOKEN for CI. The secret is
  // returned once, at creation; only its hash is stored (src/db.ts).
  app.post("/api/workspaces/api-keys", requireMember, requireAdmin, perUser("api-key", 10), async (c) => {
    const viewer = c.get("viewer");
    const body = await readJson(c, 16 * 1024);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "CI";
    const live = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM ci_keys WHERE organization_id = ? AND revoked_at IS NULL")
      .bind(viewer.organization_id)
      .first<{ n: number }>();
    if ((live?.n || 0) >= MAX_CI_KEYS) {
      return c.json({ ok: false, error: `A workspace can have at most ${MAX_CI_KEYS} live API keys. Revoke one first.` }, 409);
    }
    const id = newCiKeyId();
    const token = CI_KEY_PREFIX + randomToken(32);
    await c.env.DB.prepare("INSERT INTO ci_keys (id, organization_id, name, token_hash, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(id, viewer.organization_id, name, sha256(token), viewer.account_id)
      .run();
    return c.json(
      { ok: true, key: { id, name, createdAt: new Date().toISOString(), createdBy: viewer.account_id }, token, workspace: workspaceJson(viewer.workspace) },
      201
    );
  });

  app.get("/api/workspaces/api-keys", requireMember, requireAdmin, async (c) => {
    const viewer = c.get("viewer");
    const { results } = await c.env.DB.prepare(
      `SELECT k.id, k.name, k.created_by, a.name AS creator_name, k.created_at, k.last_used_at FROM ci_keys k
       LEFT JOIN accounts a ON a.id = k.created_by
       WHERE k.organization_id = ? AND k.revoked_at IS NULL ORDER BY k.created_at DESC`
    )
      .bind(viewer.organization_id)
      .all<{ id: string; name: string; created_by: string; creator_name: string | null; created_at: number; last_used_at: number | null }>();
    const iso = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);
    return c.json({
      ok: true,
      keys: results.map((k) => ({
        id: k.id,
        name: k.name,
        createdBy: { id: k.created_by, name: k.creator_name },
        createdAt: iso(k.created_at),
        lastUsedAt: iso(k.last_used_at)
      }))
    });
  });

  app.delete("/api/workspaces/api-keys/:id", requireMember, requireAdmin, async (c) => {
    const viewer = c.get("viewer");
    const result = await c.env.DB.prepare(
      "UPDATE ci_keys SET revoked_at = unixepoch() WHERE id = ? AND organization_id = ? AND revoked_at IS NULL"
    )
      .bind(c.req.param("id") || "", viewer.organization_id)
      .run();
    if (!result.meta.changes) return c.json({ ok: false, error: "No such live API key in this workspace." }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/workspaces/join", requireUser, perUser("join", 20, "auth"), async (c) => {
    const viewer = c.get("viewer");
    if (viewer.is_api_key) return c.json({ ok: false, error: "API keys cannot join workspaces." }, 403);
    const body = await readJson(c, 16 * 1024);
    const result = await joinWithCode(c, viewer, body.code);
    return c.json(result.body, result.status);
  });

  app.get("/api/workspaces/members", requireMember, async (c) => {
    const viewer = c.get("viewer");
    const { client } = workos(c.get("config"));
    const [users, memberships] = await Promise.all([
      client.userManagement.listUsers({ organizationId: viewer.organization_id, limit: 100 }),
      client.userManagement.listOrganizationMemberships({
        organizationId: viewer.organization_id,
        statuses: ["active"],
        limit: 100
      })
    ]);
    const roles = new Map(memberships.data.map((m) => [m.userId, m.role?.slug || null]));
    return c.json({
      ok: true,
      members: users.data
        .filter((u) => roles.has(u.id))
        .map((u) => ({ id: u.id, name: displayName(u), email: u.email, role: roles.get(u.id) }))
    });
  });

  // Removes a member (admins only). Access ends on their next request, and
  // every invite code issued until now is revoked (they may hold one).
  app.delete("/api/workspaces/members/:userId", requireMember, requireAdmin, async (c) => {
    const viewer = c.get("viewer");
    const userId = c.req.param("userId");
    // The route always captures :userId; the check satisfies the types.
    if (!userId) return c.json({ ok: false, error: "Not a member." }, 404);
    if (userId === viewer.account_id) {
      return c.json({ ok: false, error: "You cannot remove yourself. To leave this workspace, run: htmlartifact workspace leave" }, 422);
    }
    const membership = await workosMembership(c, userId, viewer.organization_id);
    if (!membership) return c.json({ ok: false, error: "Not a member." }, 404);
    await endMembership(c, userId, viewer.organization_id, membership.id);
    return c.json({ ok: true, invitesRevoked: true });
  });

  // Makes a member an admin, or an admin a member (admins only). A workspace
  // always keeps at least one admin.
  app.patch("/api/workspaces/members/:userId", requireMember, requireAdmin, perUser("member-role", 30), async (c) => {
    const viewer = c.get("viewer");
    const userId = c.req.param("userId");
    if (!userId) return c.json({ ok: false, error: "Not a member." }, 404);
    const body = await readJson(c, 16 * 1024);
    const role = body.role;
    if (role !== "admin" && role !== "member") return c.json({ ok: false, error: 'role must be "admin" or "member".' }, 422);
    const membership = await workosMembership(c, userId, viewer.organization_id);
    if (!membership) return c.json({ ok: false, error: "Not a member." }, 404);
    if ((membership.role?.slug || "member") === role) return c.json({ ok: true, role, unchanged: true });
    if (role === "member" && (await isLastAdmin(c, userId, viewer.organization_id))) {
      return c.json({ ok: false, error: "That is the workspace's last admin. Make someone else an admin first." }, 422);
    }
    const config = c.get("config");
    await workos(config).client.userManagement.updateOrganizationMembership(membership.id, { roleSlug: role });
    // After the change: a re-check that started earlier may not cache the old role.
    await bumpMembershipEpoch(c.env.DB, userId, viewer.organization_id);
    if (role === "member") await revokePortalLinks(config, viewer.organization_id, userId);
    return c.json({ ok: true, role, unchanged: false });
  });

  // Leaves the caller's current workspace. Its last admin cannot leave: they
  // make someone else an admin first, or delete the workspace.
  app.post("/api/workspaces/leave", requireMember, perUser("leave", 10), async (c) => {
    const viewer = c.get("viewer");
    if (viewer.is_api_key) return c.json({ ok: false, error: "API keys cannot leave workspaces." }, 403);
    const membership = await workosMembership(c, viewer.account_id, viewer.organization_id);
    if (!membership) return c.json({ ok: false, error: "Not a member." }, 404);
    if (membership.role?.slug === "admin" && (await isLastAdmin(c, viewer.account_id, viewer.organization_id))) {
      return c.json(
        {
          ok: false,
          error: `You are the last admin of "${viewer.workspace.name}". Make someone else an admin first (htmlartifact workspace promote <email>), or delete the workspace (htmlartifact workspace delete).`
        },
        422
      );
    }
    await endMembership(c, viewer.account_id, viewer.organization_id, membership.id);
    return c.json({ ok: true, workspace: workspaceJson(viewer.workspace) });
  });

  // Deletes the caller's current workspace (admins only), confirmed by its
  // exact name: access ends at once (the tombstone is written in the same D1
  // transaction that drops every row), then R2 and the WorkOS organization
  // are deleted in this request. Anything that fails stays queued for the
  // ops Worker's cron.
  app.delete("/api/workspaces/current", requireMember, requireAdmin, perUser("workspace-delete", 5), async (c) => {
    const viewer = c.get("viewer");
    const { workspace } = viewer;
    const body = await readJson(c, 16 * 1024);
    if (body.confirm !== workspace.name) {
      return c.json(
        {
          ok: false,
          error: `To delete this workspace and every artifact in it, send {"confirm": ${JSON.stringify(workspace.name)}} (its exact name). This cannot be undone.`
        },
        400
      );
    }
    await c.env.DB.batch(deleteWorkspaceStatements(c.env.DB, viewer.organization_id));
    await runWorkspaceDeletions(c.env, viewer.organization_id);
    return c.json({ ok: true, workspace: workspaceJson(workspace) });
  });

  // A WorkOS Admin Portal link for the caller's workspace (admins only): an IT
  // admin opens it to connect SSO, a SCIM directory, or verify a domain.
  app.post("/api/workspaces/portal", requireMember, requireAdmin, perUser("portal", 10), async (c) => {
    const viewer = c.get("viewer");
    const body = await readJson(c, 16 * 1024);
    const intent = body.intent;
    if (intent !== "sso" && intent !== "dsync" && intent !== "domain_verification") {
      return c.json({ ok: false, error: 'intent must be "sso", "dsync", or "domain_verification".' }, 422);
    }
    // Deprovisioning relies on AuthKit Directory Provisioning: WorkOS links
    // directory users to accounts and deactivates the membership (and revokes
    // sessions) when the directory removes someone; the membership webhook
    // ends access here. Without it a directory would sync but never offboard.
    // SSO and directory connections are billed by WorkOS per connection: a
    // customer's admin could otherwise start a bill by opening this link.
    if ((intent === "sso" || intent === "dsync") && !c.get("config").workos.enterpriseConnections) {
      return c.json(
        { ok: false, error: `${intent === "sso" ? "SSO" : "Directory Sync"} isn't available on this deployment yet. Contact support to enable it.` },
        409
      );
    }
    if (intent === "dsync" && !c.get("config").workos.directoryProvisioning) {
      return c.json({ ok: false, error: "Directory Sync isn't available yet. Contact support to enable it." }, 409);
    }
    const config = c.get("config");
    const url = await portalLink(config, viewer.organization_id, intent, viewer.account_id);
    // The admin check above may be from cache or from before this request's
    // body arrived. Re-check live now that the link exists: if they were
    // offboarded or demoted meanwhile, revoke it. (Any later change revokes
    // it through the membership webhook.)
    const live = await workos(config).client.userManagement.listOrganizationMemberships({
      userId: viewer.account_id,
      organizationId: viewer.organization_id,
      statuses: ["active"],
      limit: 1
    });
    if (live.data.find((m) => m.organizationId === viewer.organization_id)?.role?.slug !== "admin") {
      await revokePortalLinks(config, viewer.organization_id, viewer.account_id);
      return c.json({ ok: false, error: "Only workspace admins can do that." }, 403);
    }
    return c.json({ ok: true, url });
  });

  // ---- Artifacts
  app.post("/api/uploads", requireMember, perUser("upload", 30), handleUpload);
  app.post("/api/check", requireMember, perUser("check", 60), handleCheck);

  // ?workspace=<id or handle> lists another workspace the caller is an active
  // member of (CLI sign-ins only; API keys stay in their own workspace).
  app.get("/api/drafts", requireUser, async (c, next) => {
    const wanted = c.req.query("workspace");
    const viewer = c.get("viewer");
    if (!wanted) return isMember(viewer) ? next() : notMember(c, viewer);
    const workspace = await readableWorkspace(c, viewer, wanted);
    if (!workspace) return c.json({ ok: false, error: "You are not in that workspace. See: htmlartifact workspace list" }, 404);
    c.set("viewer", { ...viewer, organization_id: workspace.organization_id, workspace });
    return next();
  }, async (c) => {
    const viewer = c.get("viewer") as MemberViewer;
    const options = { origin: c.get("origin"), handle: viewer.workspace.handle, organizationId: viewer.organization_id };
    const drafts =
      c.req.query("scope") === "workspace"
        ? await listWorkspaceDrafts(c.env.DB, options)
        : await listMyDrafts(c.env.DB, { ...options, accountId: viewer.account_id });
    return c.json({ ok: true, drafts, usage: await workspaceUsage(c, viewer.organization_id) });
  });

  // Deletes an artifact for real: every version and page in R2 (one key
  // prefix) and every row in D1, which frees its custom URL. Its author or a
  // workspace admin may delete it. Other members already see it in the
  // workspace list, so they get a 403 that says why; outside the workspace it
  // does not exist (404).
  app.delete("/api/drafts/:draftId", requireMember, async (c) => {
    const viewer = c.get("viewer");
    const draftId = c.req.param("draftId");
    const draft = draftId
      ? await c.env.DB.prepare("SELECT id, account_id FROM drafts WHERE id = ? AND organization_id = ?")
          .bind(draftId, viewer.organization_id)
          .first<Pick<DraftRow, "id" | "account_id">>()
      : null;
    if (!draft) return c.json({ ok: false, error: "Artifact not found." }, 404);
    if (draft.account_id !== viewer.account_id && viewer.role !== "admin") {
      const former = await isRevoked(c.env.DB, [draft.account_id], viewer.organization_id) || (await isRevoked(c.env.DB, [draft.account_id], "*"));
      return c.json(
        {
          ok: false,
          error: former
            ? "That artifact's author is no longer in this workspace; only a workspace admin can delete it."
            : "That artifact belongs to a teammate; only they or a workspace admin can delete it."
        },
        403
      );
    }
    // R2 is purged before responding; if it fails, the queued prefix is retried by the cron.
    await purgeDraft(c.env, viewer.organization_id, draft.id);
    return c.json({ ok: true, draftId: draft.id });
  });

  // Prunes an artifact's history to its latest `keepLatest` versions, freeing
  // their storage; the URL and the current version stay. Same rights as
  // delete. A long history is pruned in steps: `more` asks for another call.
  app.delete("/api/drafts/:draftId/versions", requireMember, perUser("prune", 30), async (c) => {
    const viewer = c.get("viewer");
    const draftId = c.req.param("draftId");
    const draft = draftId
      ? await c.env.DB.prepare("SELECT id, account_id FROM drafts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
          .bind(draftId, viewer.organization_id)
          .first<Pick<DraftRow, "id" | "account_id">>()
      : null;
    if (!draft) return c.json({ ok: false, error: "Artifact not found." }, 404);
    if (draft.account_id !== viewer.account_id && viewer.role !== "admin") {
      return c.json({ ok: false, error: "That artifact belongs to a teammate; only they or a workspace admin can prune it." }, 403);
    }
    const keep = Number(c.req.query("keepLatest"));
    if (!Number.isInteger(keep) || keep < 1 || keep > 10_000) {
      return c.json({ ok: false, error: "keepLatest must be a whole number of versions to keep, at least 1. To remove every version, delete the artifact." }, 422);
    }
    const pruned = await pruneVersions(c.env, viewer.organization_id, draft.id, keep);
    const left = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM draft_versions WHERE draft_id = ?")
      .bind(draft.id)
      .first<{ n: number }>();
    return c.json({ ok: true, draftId: draft.id, ...pruned, versionCount: left?.n ?? 0, usage: await workspaceUsage(c, viewer.organization_id) });
  });
}

// Shared by POST /api/workspaces/join and the browser /join/<code> page.
// A use is reserved atomically before WorkOS is touched, so concurrent joins
// can never exceed max_uses; it is released if nobody new was admitted.
export async function joinWithCode<E extends AppEnv>(c: Context<E>, viewer: Viewer, rawCode: unknown): Promise<JoinResult> {
  const db = c.env.DB;
  const code = normalizeInviteCode(rawCode);
  const reserved = code
    ? await db
        .prepare(
          `UPDATE invites SET uses = uses + 1
           WHERE code = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses
           RETURNING organization_id, created_at`
        )
        .bind(code)
        .first<{ organization_id: string; created_at: number }>()
    : null;
  if (!reserved) {
    // Spent, revoked or expired, but they are already in its workspace: say so.
    const invite = code
      ? await db.prepare("SELECT organization_id FROM invites WHERE code = ?").bind(code).first<{ organization_id: string }>()
      : null;
    if (invite && !viewer.is_api_key && (await userStillMember(c, viewer.account_id, invite.organization_id, viewer.credential_id))) {
      const workspace = await findWorkspace(db, invite.organization_id);
      return {
        status: 200,
        body: { ok: true, alreadyMember: true, workspace: { id: invite.organization_id, name: workspace?.name, handle: workspace?.handle } }
      };
    }
    return { status: 404, body: { ok: false, error: "That invite code is invalid, expired, or used up." } };
  }
  const organizationId = reserved.organization_id;
  const release = () => db.prepare("UPDATE invites SET uses = uses - 1 WHERE code = ? AND uses > 0").bind(code).run();

  let alreadyMember: boolean;
  try {
    alreadyMember = Boolean(await activeMembership(c, viewer.account_id, organizationId));
    // A deactivated membership (the company's directory, or WorkOS, offboarded
    // them) must not come back through an old invite: creating a membership
    // reactivates an inactive one. Only the directory or an admin restores it.
    const inactive = alreadyMember
      ? null
      : (
          await workos(c.get("config")).client.userManagement.listOrganizationMemberships({
            userId: viewer.account_id,
            organizationId,
            statuses: ["inactive"],
            limit: 1
          })
        ).data.find((m) => m.organizationId === organizationId);
    if (inactive) {
      await release();
      return { status: 403, body: { ok: false, error: "Your access to this workspace was removed. Ask your IT admin." } };
    }
    if (alreadyMember) {
      await release();
    } else {
      const epoch = await bumpMembershipEpoch(db, viewer.account_id, organizationId);
      const { userManagement } = workos(c.get("config")).client;
      // A membership whose undo is still queued (WorkOS was failing deletes)
      // is taken back by this valid code instead of colliding with it.
      const live = (
        await userManagement.listOrganizationMemberships({ userId: viewer.account_id, organizationId, statuses: ["active"], limit: 1 })
      ).data.find((m) => m.organizationId === organizationId);
      const reclaimed = live && (await membershipBeingUndone(db, live.id)) ? live : null;
      if (reclaimed) {
        await db.prepare("DELETE FROM pending_deletions WHERE kind = 'workos_membership' AND target = ?").bind(reclaimed.id).run();
      }
      const membershipId =
        reclaimed?.id ?? (await userManagement.createOrganizationMembership({ organizationId, userId: viewer.account_id, roleSlug: "member" })).id;
      try {
        // Which code let them in: a removal processed later undoes joins made
        // with codes that were already due for revocation (src/webhooks.ts).
        await db
          .prepare(
            `INSERT INTO joins (membership_id, user_id, organization_id, code_created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (membership_id) DO UPDATE SET code_created_at = excluded.code_created_at, undone = 0`
          )
          .bind(membershipId, viewer.account_id, organizationId, reserved.created_at)
          .run();
        // A removal revokes codes before it deletes the membership, so a code
        // revoked while this join ran means someone was removed meanwhile (maybe
        // this person): undo the join rather than race it.
        const revoked = await db.prepare("SELECT revoked_at FROM invites WHERE code = ?").bind(code).first<{ revoked_at: number | null }>();
        if (revoked?.revoked_at) {
          await undoJoin(c.env, membershipId);
          return { status: 404, body: { ok: false, error: "That invite code is invalid, expired, or used up." } };
        }
        await setRevokedAtEpoch(db, viewer.account_id, organizationId, false, epoch);
        // Who joined with which code, for `workspace invites --all`.
        await db
          .prepare("INSERT INTO invite_joins (code, user_id, organization_id) VALUES (?, ?, ?) ON CONFLICT (code, user_id) DO UPDATE SET joined_at = unixepoch()")
          .bind(code, viewer.account_id, organizationId)
          .run();
      } catch (error) {
        // Never leave a membership behind that no join row accounts for.
        await undoJoin(c.env, membershipId).catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    await release();
    throw error;
  }
  const workspace = await findWorkspace(db, organizationId);
  return {
    status: 200,
    body: {
      ok: true,
      alreadyMember,
      workspace: { id: organizationId, name: workspace?.name, handle: workspace?.handle }
    }
  };
}

// requireUser and requireMember set `viewer`; their context types tell the
// handlers after them that it is there (UserEnv, MemberEnv).
async function requireUser(c: Context<UserEnv>, next: Next): Promise<Response | void> {
  const viewer = await bearerViewer(c);
  if (!viewer) return notSignedIn(c);
  c.set("viewer", viewer);
  return next();
}

async function requireMember(c: Context<MemberEnv>, next: Next): Promise<Response | void> {
  const viewer = await bearerViewer(c);
  if (!viewer) return notSignedIn(c);
  if (!isMember(viewer)) return notMember(c, viewer);
  c.set("viewer", viewer);
  return next();
}

// A signed-in caller with no current workspace: a removed member is told
// which workspace they lost, not to start a new one.
async function notMember<E extends AppEnv>(c: Context<E>, viewer: Viewer): Promise<Response> {
  const removedFrom = await removedFromName(c.env.DB, viewer);
  return c.json(
    {
      ok: false,
      error: removedFrom
        ? `You no longer have access to "${removedFrom}". Ask one of its admins for a new invite, or see your other workspaces: htmlartifact workspace list`
        : "You are not in a workspace yet. Create one (htmlartifact workspace create <name>) or join one (htmlartifact workspace join <code>)."
    },
    403
  );
}

// A workspace (by organization ID or handle) the caller may read: their
// current one, or for a CLI sign-in any they are an active member of.
async function readableWorkspace<E extends AppEnv>(c: Context<E>, viewer: Viewer, wanted: string): Promise<WorkspaceRow | null> {
  const db = c.env.DB;
  const workspace = (await findWorkspace(db, wanted)) ?? (await findWorkspaceByHandle(db, wanted.toLowerCase()));
  if (!workspace) return null;
  if (workspace.organization_id === viewer.organization_id) return workspace;
  if (viewer.is_api_key) return null;
  return (await userStillMember(c, viewer.account_id, workspace.organization_id, viewer.credential_id)) ? workspace : null;
}

function notSignedIn<E extends AppEnv>(c: Context<E>): Response {
  c.header("WWW-Authenticate", 'Bearer realm="htmlartifact"');
  return c.json({ ok: false, error: "Not signed in. Run: htmlartifact login" }, 401);
}

// The name of the workspace the caller's credential names but they were
// removed from (or left), or null.
async function removedFromName(db: D1Database, viewer: Viewer): Promise<string | null> {
  if (!viewer.removed_from) return null;
  return (await findWorkspace(db, viewer.removed_from))?.name ?? null;
}

// userId's WorkOS membership of organizationId with one of these statuses, live.
async function workosMembership<E extends AppEnv>(
  c: Context<E>,
  userId: string,
  organizationId: string,
  statuses: ("active" | "inactive")[] = ["active"]
) {
  const page = await workos(c.get("config")).client.userManagement.listOrganizationMemberships({
    userId,
    organizationId,
    statuses,
    limit: 1
  });
  return page.data.find((m) => m.organizationId === organizationId) ?? null;
}

// True when userId is the only active admin of organizationId.
async function isLastAdmin<E extends AppEnv>(c: Context<E>, userId: string, organizationId: string): Promise<boolean> {
  const page = await workos(c.get("config")).client.userManagement.listOrganizationMemberships({
    organizationId,
    statuses: ["active"],
    limit: 100
  });
  return !page.data.some((m) => m.role?.slug === "admin" && m.userId !== userId);
}

// Ends a membership (a removal, or leaving). Access ends on the next request,
// and every invite code the workspace issued until now is revoked: whoever
// leaves may hold one.
async function endMembership<E extends AppEnv>(c: Context<E>, userId: string, organizationId: string, membershipId: string): Promise<void> {
  const db = c.env.DB;
  // Portal sessions outlive AuthKit sessions: end them first (a failure
  // here changes nothing, so the request can simply be retried).
  await revokePortalLinks(c.get("config"), organizationId, userId);
  await revokeInvitesUpTo(db, organizationId, now());
  const epoch = await bumpMembershipEpoch(db, userId, organizationId);
  await workos(c.get("config")).client.userManagement.deleteOrganizationMembership(membershipId);
  await setRevokedAtEpoch(db, userId, organizationId, true, epoch);
  // Again, for a code an in-flight request of theirs created meanwhile.
  await revokeInvitesUpTo(db, organizationId, now());
}

// Who may publish a new version of an artifact: its author, a workspace
// admin (so artifacts outlive the people who made them), or, for artifacts
// published by an organization API key or workspace CI key, any such key of
// the workspace (so rotating a CI key doesn't freeze its artifacts).
function canUpdateDraft(viewer: Viewer, draft: DraftRow): boolean {
  if (draft.account_id === viewer.account_id || viewer.role === "admin") return true;
  const organizationKey = viewer.is_api_key && viewer.account_id === viewer.credential_id;
  return organizationKey && draft.account_id.startsWith("api_key_");
}

async function requireAdmin(c: Context<MemberEnv>, next: Next): Promise<Response | void> {
  if (c.get("viewer").role !== "admin") {
    return c.json({ ok: false, error: "Only workspace admins can do that." }, 403);
  }
  return next();
}

async function handleUpload(c: Context<MemberEnv>): Promise<Response> {
  const viewer = c.get("viewer");
  const db = c.env.DB;
  const capabilities = uploadCapabilities(viewer, c.get("config"));
  const body = await readJson<UploadBody, MemberEnv>(c, uploadBodyLimit(capabilities.maxBytes));
  const { filename, metadata = {}, draftId, description } = body;
  const validation = await validateUpload(requestPages(body), capabilities);
  if (!validation.ok) {
    return c.json(
      { ok: false, errors: validation.errors, warnings: validation.warnings, issues: validation.issues },
      422
    );
  }

  const slug = normalizeSlug(body.slug);
  const slugError = slug === null ? null : slugProblem(slug);
  if (slugError) return c.json({ ok: false, error: slugError }, 422);

  // A slug is the artifact's portable identity within the workspace: the
  // same slug updates the same artifact from any machine.
  const slugDraft = slug
    ? await db
        .prepare("SELECT * FROM drafts WHERE organization_id = ? AND slug = ? AND deleted_at IS NULL")
        .bind(viewer.organization_id, slug)
        .first<DraftRow>()
    : null;
  if (slugDraft && !canUpdateDraft(viewer, slugDraft)) {
    return c.json({ ok: false, error: `The custom URL "${slug}" belongs to a teammate's artifact; only they or a workspace admin can update it.` }, 403);
  }
  if (slugDraft && draftId && slugDraft.id !== draftId) {
    return c.json(
      { ok: false, error: `The custom URL "${slug}" already names artifact ${slugDraft.id}. Upload with --slug alone to update it.` },
      409
    );
  }
  const existing =
    slugDraft ||
    (draftId
      ? await db
          .prepare("SELECT * FROM drafts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
          .bind(draftId, viewer.organization_id)
          .first<DraftRow>()
      : null);
  if (draftId && !existing) return c.json({ ok: false, error: "Artifact not found." }, 404);
  if (existing && !canUpdateDraft(viewer, existing)) {
    return c.json({ ok: false, error: "That artifact belongs to a teammate; only they or a workspace admin can update it." }, 403);
  }

  const current = existing?.current_version_id
    ? await db
        .prepare("SELECT id, version_number, content_hash FROM draft_versions WHERE id = ?")
        .bind(existing.current_version_id)
        .first<Pick<VersionRow, "id" | "version_number" | "content_hash">>()
    : null;
  // Re-sending identical content (a blind retry) keeps the current version.
  const unchanged = current?.content_hash === validation.contentHash;
  const id = existing?.id || newDraftId();
  const observedVersionId = existing?.current_version_id ?? null;
  const title = validation.title || existing?.title || filename || "Untitled";
  const cleanDescription = cleanText(description, 1000);
  let versionId = current?.id;
  // Prefix of the R2 objects this upload writes; deleted again if its rows are
  // not committed. Queued first, so a failed delete is retried by the cron.
  let written: string | null = null;
  const discard = async () => {
    if (!written) return;
    await queueDeletion(db, "r2_prefix", written).run().catch(() => undefined);
    await runDeletion(c.env, "r2_prefix", written);
  };

  // Free-tier storage guards (src/config.ts): the workspace's share, then the
  // whole database's headroom (D1 Free caps a database at 500 MB), and on R2
  // the HTML the bucket may hold (R2 Free stores 10 GB). Checked
  // here for a clear answer, and again inside the batch (`fits`), where the
  // check and the counter's increment are one transaction: concurrent uploads
  // cannot all pass on the same reading.
  const { workspaceBytes, databaseBytes: databaseLimit, storageBytes } = c.get("config").limits;
  let fits = "1";
  let fitsParams: (string | number)[] = [];
  if (!unchanged) {
    const reading = await storageFull(c, validation.totalBytes);
    if (reading instanceof Response) return reading;
    // Bytes counted after this reading are not in `size` yet: the batch adds
    // the counters' growth since then (all workspaces) to the measured size.
    const { size, countedBytes } = reading;
    fits = `COALESCE((SELECT stored_bytes FROM workspace_usage WHERE organization_id = ?), 0) + ? <= ?
      AND (SELECT COALESCE(SUM(stored_bytes), 0) FROM workspace_usage) + ? <= ?`;
    fitsParams = [
      viewer.organization_id,
      validation.totalBytes,
      workspaceBytes,
      validation.totalBytes,
      size === null ? Number.MAX_SAFE_INTEGER : databaseLimit - size + countedBytes
    ];
    if (storageBytes !== null) {
      fits += " AND (SELECT COALESCE(SUM(stored_bytes), 0) FROM workspace_usage) + ? <= ?";
      fitsParams.push(validation.totalBytes, storageBytes);
    }
  }

  const statements: D1PreparedStatement[] = [];
  let blobStatements: D1PreparedStatement[] = [];
  if (!unchanged) {
    versionId = newInternalId();
    const { pages } = validation;
    const index = pages.find((page) => page.path === "index.html");
    // Validation guarantees an index.html page.
    if (!index) throw new Error("Upload has no index.html page.");
    const extraPages = pages.filter((page) => page !== index);
    const prefix = draftPrefix(viewer.organization_id, id);
    const objectKey = `${prefix}versions/${versionId}.html`;
    const pageKey = (page: { path: string }) => `${prefix}versions/${versionId}/${page.path}`;
    // Daily budgets (src/budget.ts): D1 rows written (D1 Free locks every
    // workspace out for the rest of the day past 100,000), the workspace's
    // share first; then, on R2, one Class A operation per object.
    const over = await overDailyBudget(c, pages);
    if (over) {
      c.header("Retry-After", String(secondsUntilUtcMidnight()));
      return c.json({ ok: false, error: `${over} Try again after 00:00 UTC.` }, 429);
    }
    written = versionPrefix(viewer.organization_id, id, versionId);
    // R2: written now. D1: chunk inserts that join this batch after the
    // version row (each conditional on it), so they commit together.
    try {
      blobStatements = await stageObjects(c.env, versionId, [
        { key: objectKey, html: index.html },
        ...extraPages.map((page) => ({ key: pageKey(page), html: page.html }))
      ]);
    } catch (error) {
      await discard();
      throw error;
    }

    if (!existing) {
      statements.push(
        db
          .prepare(
            `INSERT INTO drafts (id, account_id, organization_id, title, description, repo_org, repo_name, repo_host, slug)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM deleted_workspaces WHERE organization_id = ?) AND ${fits}`
          )
          .bind(
            id,
            viewer.account_id,
            viewer.organization_id,
            title,
            cleanDescription,
            cleanText(metadata.repoOrg),
            cleanText(metadata.repoName),
            cleanText(metadata.repoHost),
            slug,
            viewer.organization_id,
            ...fitsParams
          )
      );
    }
    // The version number is computed inside the INSERT, and the row is only
    // written if the artifact's current version is still the one this upload
    // started from (compare-and-swap; see the final UPDATE) and it fits the
    // storage guards; the counter's increment below then commits with it.
    statements.push(
      db
        .prepare(
          `INSERT INTO draft_versions (
             id, draft_id, version_number, object_key, content_hash, file_size, page_count,
             has_inline_script, created_by, credential_id, source_ip, user_agent, cli_version,
             git_branch, git_commit_sha, git_commit_subject, git_dirty, original_filename, ci_run_url)
           SELECT ?, ?, (SELECT COALESCE(MAX(version_number), 0) + 1 FROM draft_versions WHERE draft_id = ?),
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT current_version_id FROM drafts WHERE id = ?) IS ?
             AND NOT EXISTS (SELECT 1 FROM deleted_workspaces WHERE organization_id = ?)
             AND ${fits}`
        )
        .bind(
          versionId,
          id,
          id,
          objectKey,
          validation.contentHash,
          validation.totalBytes,
          pages.length,
          index.hasScripts ? 1 : 0,
          viewer.account_id,
          viewer.credential_id,
          clientIp(c),
          cleanText(c.req.header("user-agent")),
          cleanText(metadata.cliVersion),
          cleanText(metadata.gitBranch),
          cleanText(metadata.gitCommitSha),
          cleanText(metadata.gitCommitSubject),
          typeof metadata.gitDirty === "boolean" ? Number(metadata.gitDirty) : null,
          cleanText(filename),
          cleanText(metadata.ciRunUrl),
          id,
          observedVersionId,
          viewer.organization_id,
          ...fitsParams
        )
    );
    for (const page of extraPages) {
      statements.push(
        db
          .prepare(
            `INSERT INTO draft_pages (draft_version_id, path, object_key, content_hash, file_size, title, has_inline_script)
             SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM draft_versions WHERE id = ?)`
          )
          .bind(versionId, page.path, pageKey(page), sha256(page.html), page.bytes, page.title, page.hasScripts ? 1 : 0, versionId)
      );
    }
    statements.push(...blobStatements);
    // Count the new version's bytes, only if the version row committed.
    statements.push(
      db
        .prepare(
          `INSERT INTO workspace_usage (organization_id, stored_bytes)
           SELECT ?, ? WHERE EXISTS (SELECT 1 FROM draft_versions WHERE id = ?)
           ON CONFLICT (organization_id) DO UPDATE SET stored_bytes = stored_bytes + excluded.stored_bytes`
        )
        .bind(viewer.organization_id, validation.totalBytes, versionId)
    );
  }
  // Metadata applies even when the content is unchanged; only new content
  // moves updated_at.
  statements.push(
    db
      .prepare(
        `UPDATE drafts SET current_version_id = ?, title = ?, description = COALESCE(?, description),
           repo_org = COALESCE(?, repo_org), repo_name = COALESCE(?, repo_name), repo_host = COALESCE(?, repo_host),
           slug = COALESCE(?, slug), updated_at = CASE WHEN ? THEN updated_at ELSE unixepoch() END
         WHERE id = ? AND current_version_id IS ? AND EXISTS (SELECT 1 FROM draft_versions WHERE id = ?)`
      )
      .bind(
        versionId,
        title,
        cleanDescription,
        cleanText(metadata.repoOrg),
        cleanText(metadata.repoName),
        cleanText(metadata.repoHost),
        slug,
        unchanged ? 1 : 0,
        id,
        observedVersionId,
        versionId
      )
  );

  // Nothing references the objects of an upload whose rows did not commit
  // (lost race, artifact or workspace deleted meanwhile): discard() them.
  try {
    const results = await db.batch(statements);
    // Another upload to this artifact landed after we read it (or it was
    // deleted): nothing of ours became current. Safe to retry.
    if (!results.at(-1)?.meta.changes) {
      await discard();
      // Concurrent uploads filled the storage after the first check.
      const full = unchanged ? null : await storageFull(c, validation.totalBytes);
      if (full instanceof Response) return full;
      return c.json({ ok: false, error: "Another upload to this artifact landed at the same moment. Retry." }, 409);
    }
  } catch (error) {
    await discard();
    const message = error instanceof Error ? error.message : "";
    if (/UNIQUE constraint failed: drafts\.organization_id, drafts\.slug/.test(message)) {
      return c.json({ ok: false, error: "That custom URL was just taken. Pick another." }, 409);
    }
    if (/UNIQUE constraint failed: draft_versions/.test(message)) {
      return c.json({ ok: false, error: "Another upload to this artifact landed at the same moment. Retry." }, 409);
    }
    throw error;
  }

  const draft = await db.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<DraftRow>();
  const version = await db
    .prepare("SELECT version_number FROM draft_versions WHERE id = ?")
    .bind(versionId)
    .first<Pick<VersionRow, "version_number">>();
  if (!draft || !version) throw new Error(`Artifact ${id} vanished after upload.`);
  const origin = c.get("origin");
  const publicUrl = draftUrl(origin, draft, viewer.workspace.handle);
  const multiPage = validation.pages.length > 1;
  const warnings = [...validation.warnings];
  // An admin (or a CI key) publishing over a teammate's artifact: say so,
  // since the artifact keeps its author.
  if (existing && !unchanged && existing.account_id !== viewer.account_id) {
    const author = await db.prepare("SELECT name FROM accounts WHERE id = ?").bind(existing.account_id).first<{ name: string }>();
    const name = author?.name || "a teammate";
    warnings.push(`This artifact is ${name}'s: you published version ${version.version_number} over their work. It stays theirs; list shows you as the last to update it.`);
  }
  return c.json(
    {
      ok: true,
      created: !existing,
      unchanged,
      draftId: id,
      slug: draft.slug,
      versionId,
      versionNumber: version.version_number,
      title,
      contentHash: validation.contentHash,
      totalBytes: validation.totalBytes,
      account: { id: viewer.account_id, name: viewer.account_name },
      workspace: workspaceJson(viewer.workspace),
      publicUrl,
      rawUrl: `${publicUrl}/raw`,
      // Built from the draft ID, which never moves: a slug can be renamed.
      versionUrl: `${origin}/d/${id}/v/${version.version_number}${multiPage ? "/" : ""}`,
      pages: multiPage ? validation.pages.map((p) => ({ path: p.path, url: `${publicUrl}/${p.path}` })) : undefined,
      warnings
    },
    existing ? 200 : 201
  );
}

// A read-only preflight: what the caller can publish, and whether a given
// upload body would pass. Never creates anything.
async function handleCheck(c: Context<MemberEnv>): Promise<Response> {
  const viewer = c.get("viewer");
  const capabilities = uploadCapabilities(viewer, c.get("config"));
  const body = await readJson(c, uploadBodyLimit(capabilities.maxBytes));
  const report: CheckReport = {
    ok: true,
    account: { id: viewer.account_id, name: viewer.account_name },
    workspace: workspaceJson(viewer.workspace),
    limits: { maxBytes: capabilities.maxBytes, maxPages: capabilities.maxPages },
    usage: await workspaceUsage(c, viewer.organization_id),
    capabilities: {
      inlineScripts: true,
      multiPage: true,
      customUrls: true,
      externalAssets: "https images, video, audio, fonts, and stylesheets",
      blockedInSandbox: SANDBOX_LIMITS
    }
  };
  if (body.html !== undefined || body.files !== undefined) {
    const validation = await validateUpload(requestPages(body), capabilities);
    Object.assign(report, {
      ok: validation.ok,
      totalBytes: validation.totalBytes,
      pages: validation.pages.map((p) => ({ path: p.path, bytes: p.bytes, title: p.title, hasScripts: p.hasScripts })),
      issues: validation.issues,
      errors: validation.errors,
      warnings: validation.warnings
    });
  }
  const slug = normalizeSlug(body.slug);
  if (slug !== null) {
    const problem = slugProblem(slug);
    if (problem) {
      report.slug = { slug, status: "unavailable", message: problem };
    } else {
      const owner = await c.env.DB.prepare(
        "SELECT account_id FROM drafts WHERE organization_id = ? AND slug = ? AND deleted_at IS NULL"
      )
        .bind(viewer.organization_id, slug)
        .first<{ account_id: string }>();
      report.slug = !owner
        ? { slug, status: "available" }
        : owner.account_id === viewer.account_id
          ? { slug, status: "yours" }
          : { slug, status: "taken", message: `The custom URL "${slug}" is used by a teammate's artifact.` };
    }
    if (report.slug.status === "unavailable" || report.slug.status === "taken") report.ok = false;
  }
  return c.json(report);
}

// A 507 if `bytes` more would overflow the workspace's share or the
// database's headroom; otherwise the database reading it checked.
// D1 rows an upload writes, doubled for index entries: the artifact, version,
// usage counter and final update, plus a row per extra page and, on D1
// storage, per ≤ 1 MB chunk.
function uploadRows(c: Context<MemberEnv>, pages: { bytes: number }[]): number {
  const chunks = storageKind(c.env) === "d1" ? pages.reduce((n, page) => n + Math.max(1, Math.ceil(page.bytes / 1_000_000)), 0) : 0;
  return 2 * (4 + pages.length + chunks);
}

/** Why an upload doesn't fit today's budgets, or null once they are reserved. */
async function overDailyBudget(c: Context<MemberEnv>, pages: { bytes: number }[]): Promise<string | null> {
  const { workspaceRowsPerDay, rowsPerDay } = c.get("config").limits;
  const rows = uploadRows(c, pages);
  const db = c.env.DB;
  if (!(await reserveBudget(db, `d1:rows:${c.get("viewer").organization_id}`, rows, workspaceRowsPerDay))) {
    return "This workspace has reached today's upload limit.";
  }
  if (!(await reserveBudget(db, "d1:rows", rows, rowsPerDay)) || !(await reserveR2Writes(c.env, pages.length))) {
    return "This htmlartifact deployment has reached today's upload limit.";
  }
  return null;
}

async function storageFull(c: Context<MemberEnv>, bytes: number): Promise<Response | Awaited<ReturnType<typeof databaseUsage>>> {
  const { workspaceBytes, databaseBytes: databaseLimit } = c.get("config").limits;
  const used = await workspaceStoredBytes(c.env.DB, c.get("viewer").organization_id);
  if (used + bytes > workspaceBytes) {
    return c.json(
      {
        ok: false,
        error: `This workspace's storage is full (${formatBytes(used)} of ${formatBytes(workspaceBytes)}, every version counts). Free space with htmlartifact prune <artifact> --keep <n> (old versions) or htmlartifact delete, then upload again.`
      },
      507
    );
  }
  const { storageBytes } = c.get("config").limits;
  const reading = await databaseUsage(c.env.DB);
  if (
    (reading.size !== null && reading.size + bytes > databaseLimit) ||
    (storageBytes !== null && reading.countedBytes + bytes > storageBytes)
  ) {
    return c.json({ ok: false, error: "This htmlartifact deployment's storage is full. Ask an admin to delete old artifacts." }, 507);
  }
  return reading;
}

async function workspaceUsage<E extends AppEnv>(c: Context<E>, organizationId: string): Promise<WorkspaceUsage> {
  const limitBytes = c.get("config").limits.workspaceBytes;
  const storedBytes = await workspaceStoredBytes(c.env.DB, organizationId);
  return { storedBytes, limitBytes, remainingBytes: Math.max(0, limitBytes - storedBytes) };
}

function uploadCapabilities(viewer: Viewer, config: Config): { maxBytes: number; maxPages: number } {
  const { limits } = config;
  return {
    maxBytes: viewer.flags.includes(FLAGS.largeUploads) ? limits.largeBytes : limits.accountBytes,
    maxPages: limits.maxPages
  };
}

// The largest upload or check body worth reading. Bodies carry the HTML as
// JSON strings, and the CLI encodes them with JSON.stringify, which writes
// non-ASCII as raw UTF-8 (no growth) and escapes only `"`, `\`, and control
// characters. Every escape but one is two characters for one byte (\" \\ \n
// \r \t \b \f; lone surrogates count as 3 UTF-8 bytes and escape to 6), so
// HTML within maxBytes encodes to at most 2 × maxBytes. Agents also post
// directly with encoders that escape all non-ASCII (Python's json.dumps:
// \uXXXX, 6 characters for 2–3 UTF-8 bytes), so allow 3 ×. Only raw C0
// control characters (\u00XX, 6 for 1) exceed that, and real HTML has none. 64 KiB
// covers the rest of the body: up to 50 page paths of 200 characters, slug,
// filename, description (1000 characters), and metadata. Anything larger
// cannot pass validateUpload, so it is refused before it is read into memory.
function uploadBodyLimit(maxBytes: number): number {
  return maxBytes * 3 + 64 * 1024;
}

// An upload is one document (`html`) or a folder of pages (`files`).
function requestPages(body: JsonBody): PageInput[] {
  if (Array.isArray(body?.files)) {
    return body.files.map((file: PageInput | null | undefined) => ({ path: file?.path, html: file?.html }));
  }
  return [{ path: "index.html", html: body?.html }];
}

// Returns null when no slug was sent; anything else goes through slugProblem.
function normalizeSlug(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// The parsed body is typed as T: callers still check each field they use.
async function readJson<T extends JsonBody = JsonBody, E extends AppEnv = AppEnv>(
  c: Context<E>,
  maxBytes: number
): Promise<T> {
  const tooLarge = () => httpError(413, `Request is over the ${formatBytes(maxBytes)} limit.`);
  const length = Number(c.req.header("content-length") || 0);
  if (length > maxBytes) throw tooLarge();
  // Count bytes as they arrive: a chunked body has no Content-Length, and
  // must never be buffered whole before its size is known.
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = c.req.raw.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    // An empty body, or anything but a JSON object, reads as {}.
    const value = JSON.parse(text || "{}");
    const body: T = value && typeof value === "object" ? value : {};
    return body;
  } catch {
    throw httpError(400, "Request body is not valid JSON.");
  }
}

async function relayWorkos<E extends AppEnv>(c: Context<E>, pathname: string, body: Record<string, string>): Promise<Response> {
  const config = c.get("config");
  const response = await fetch(`${config.workos.apiUrl}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.workos.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });
  const json: unknown = await response.json().catch(() => ({ error: "bad_gateway" }));
  // WorkOS's own rate limit: tell the CLI when to come back.
  const retryAfter = response.headers.get("retry-after");
  if (response.status === 429 && retryAfter && /^\d{1,4}$/.test(retryAfter)) c.header("Retry-After", retryAfter);
  return c.json(json, isContentfulStatus(response.status) ? response.status : 502);
}

function workspaceJson(
  workspace: WorkspaceRow | null,
  role?: string | null
): { id: string; name: string; handle: string; role?: string | null } | null {
  if (!workspace) return null;
  return {
    id: workspace.organization_id,
    name: workspace.name,
    handle: workspace.handle,
    ...(role !== undefined ? { role } : {})
  };
}

function httpError(status: ContentfulStatusCode, message: string): HttpError {
  return Object.assign(new Error(message), { status });
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && "status" in error && typeof error.status === "number";
}

// Hono types response statuses as literals; WorkOS can answer with any.
function isContentfulStatus(status: number): status is ContentfulStatusCode {
  return status >= 200 && status <= 599 && status !== 204 && status !== 205 && status !== 304;
}

// How long an invite code can live.
const MAX_INVITE_DAYS = 30;

// `fallback` when value is absent, the whole number when it is in min..max, else null.
function rangeInt(value: unknown, min: number, max: number, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function cleanText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
