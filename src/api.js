import { sha256 } from "./crypto.js";
import { FLAGS, bumpMembershipEpoch, findWorkspace, saveWorkspace, setRevoked, setRevokedAtEpoch } from "./db.js";
import { listMyDrafts, listWorkspaceDrafts } from "./drafts.js";
import { formatBytes, validateUpload } from "./html-policy.js";
import { newDraftId, newInternalId, newInviteCode, normalizeInviteCode, workspaceHandle } from "./ids.js";
import { draftUrl, slugProblem } from "./public-url.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import { activeMembership, bearerViewer } from "./auth.js";
import { putHtmlObject } from "./storage.js";
import { displayName, workos } from "./workos.js";

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
  "meta refresh"
];

// JSON API used by the CLI (and so by agents). Every route takes a bearer
// credential; nothing here reads cookies.
export function registerApi(app) {
  const perUser = (keyPrefix, max) =>
    rateLimit({ windowMs: 60_000, max, keyPrefix, key: (c) => c.get("viewer")?.account_id || clientIp(c) });
  const perIp = (keyPrefix, max) => rateLimit({ windowMs: 60_000, max, keyPrefix, key: clientIp });

  // ---- CLI sign-in: the WorkOS device flow, relayed so the CLI holds no
  // WorkOS credentials. A new user signs up on the same WorkOS page.
  app.post("/api/cli/device", perIp("cli-auth", 60), async (c) => {
    const config = c.get("config");
    return relayWorkos(c, "/user_management/authorize/device", { client_id: config.workos.clientId });
  });

  app.post("/api/cli/token", perIp("cli-auth", 60), async (c) => {
    const config = c.get("config");
    const body = await readJson(c, 16 * 1024);
    let grant;
    if (typeof body.device_code === "string") {
      grant = { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: body.device_code };
    } else if (typeof body.refresh_token === "string") {
      grant = { grant_type: "refresh_token", refresh_token: body.refresh_token };
    } else if (typeof body.pending_authentication_token === "string") {
      grant = {
        grant_type: "urn:workos:oauth:grant-type:organization-selection",
        pending_authentication_token: body.pending_authentication_token
      };
    } else {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (typeof body.organization_id === "string") grant.organization_id = body.organization_id;
    return relayWorkos(c, "/user_management/authenticate", {
      ...grant,
      client_id: config.workos.clientId,
      client_secret: config.workos.apiKey
    });
  });

  // ---- Who am I. Works before joining any workspace.
  app.get("/api/me", requireUser, (c) => {
    const viewer = c.get("viewer");
    return c.json({
      ok: true,
      userId: viewer.account_id,
      name: viewer.account_name,
      email: viewer.email,
      workspace: viewer.workspace ? workspaceJson(viewer.workspace, viewer.role) : null
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
    const workspaces = [];
    for (const m of page.data) {
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
    const maxUses = clampInt(body.maxUses, 1, invites.maxUses, invites.maxUses);
    const ttlDays = clampInt(body.ttlDays, 1, 30, invites.ttlDays);
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

  app.post("/api/workspaces/join", requireUser, perUser("join", 20), async (c) => {
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

  // Removes a member (admins only). Access ends on their next request.
  app.delete("/api/workspaces/members/:userId", requireMember, requireAdmin, async (c) => {
    const viewer = c.get("viewer");
    const userId = c.req.param("userId");
    if (userId === viewer.account_id) {
      return c.json({ ok: false, error: "You cannot remove yourself." }, 422);
    }
    const { client } = workos(c.get("config"));
    const page = await client.userManagement.listOrganizationMemberships({
      userId,
      organizationId: viewer.organization_id,
      limit: 1
    });
    if (!page.data.length) return c.json({ ok: false, error: "Not a member." }, 404);
    const epoch = await bumpMembershipEpoch(c.env.DB, userId, viewer.organization_id);
    await client.userManagement.deleteOrganizationMembership(page.data[0].id);
    await setRevokedAtEpoch(c.env.DB, userId, viewer.organization_id, true, epoch);
    return c.json({ ok: true });
  });

  // ---- Artifacts
  app.post("/api/uploads", requireMember, perUser("upload", 30), handleUpload);
  app.post("/api/check", requireMember, perUser("check", 60), handleCheck);

  app.get("/api/drafts", requireMember, async (c) => {
    const viewer = c.get("viewer");
    const options = { origin: c.get("origin"), handle: viewer.workspace.handle, organizationId: viewer.organization_id };
    const drafts =
      c.req.query("scope") === "workspace"
        ? await listWorkspaceDrafts(c.env.DB, options)
        : await listMyDrafts(c.env.DB, { ...options, accountId: viewer.account_id });
    return c.json({ ok: true, drafts });
  });

  // Deleting an artifact frees its custom URL.
  app.delete("/api/drafts/:draftId", requireMember, async (c) => {
    const viewer = c.get("viewer");
    const result = await c.env.DB.prepare(
      `UPDATE drafts SET deleted_at = unixepoch(), slug = NULL, updated_at = unixepoch()
       WHERE id = ? AND account_id = ? AND organization_id = ? AND deleted_at IS NULL`
    )
      .bind(c.req.param("draftId"), viewer.account_id, viewer.organization_id)
      .run();
    if (!result.meta.changes) return c.json({ ok: false, error: "Artifact not found." }, 404);
    return c.json({ ok: true });
  });
}

// Shared by POST /api/workspaces/join and the browser /join/<code> page.
// A use is reserved atomically before WorkOS is touched, so concurrent joins
// can never exceed max_uses; it is released if nobody new was admitted.
export async function joinWithCode(c, viewer, rawCode) {
  const db = c.env.DB;
  const code = normalizeInviteCode(rawCode);
  const reserved = code
    ? await db
        .prepare(
          `UPDATE invites SET uses = uses + 1
           WHERE code = ? AND revoked_at IS NULL AND expires_at > unixepoch() AND uses < max_uses
           RETURNING organization_id`
        )
        .bind(code)
        .first()
    : null;
  if (!reserved) {
    return { status: 404, body: { ok: false, error: "That invite code is invalid, expired, or used up." } };
  }
  const organizationId = reserved.organization_id;
  const release = () => db.prepare("UPDATE invites SET uses = uses - 1 WHERE code = ? AND uses > 0").bind(code).run();

  let alreadyMember;
  try {
    alreadyMember = Boolean(await activeMembership(c, viewer.account_id, organizationId));
    if (alreadyMember) {
      await release();
    } else {
      const epoch = await bumpMembershipEpoch(db, viewer.account_id, organizationId);
      await workos(c.get("config")).client.userManagement.createOrganizationMembership({
        organizationId,
        userId: viewer.account_id,
        roleSlug: "member"
      });
      await setRevokedAtEpoch(db, viewer.account_id, organizationId, false, epoch);
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

async function requireUser(c, next) {
  const viewer = await bearerViewer(c);
  if (!viewer) {
    c.header("WWW-Authenticate", 'Bearer realm="htmlartifact"');
    return c.json({ ok: false, error: "Not signed in. Run: htmlartifact login" }, 401);
  }
  c.set("viewer", viewer);
  return next();
}

async function requireMember(c, next) {
  return requireUser(c, async () => {
    if (!c.get("viewer").organization_id) {
      return c.json(
        {
          ok: false,
          error:
            "You are not in a workspace yet. Create one (htmlartifact workspace create <name>) or join one (htmlartifact workspace join <code>)."
        },
        403
      );
    }
    return next();
  });
}

async function requireAdmin(c, next) {
  if (c.get("viewer").role !== "admin") {
    return c.json({ ok: false, error: "Only workspace admins can do that." }, 403);
  }
  return next();
}

async function handleUpload(c) {
  const viewer = c.get("viewer");
  const db = c.env.DB;
  const capabilities = uploadCapabilities(viewer, c.get("config"));
  const body = await readJson(c, capabilities.maxBytes * 6 + 1024 * 1024);
  const { filename, metadata = {}, draftId, description } = body;
  const validation = validateUpload(requestPages(body), capabilities);
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
        .first()
    : null;
  if (slugDraft && slugDraft.account_id !== viewer.account_id) {
    return c.json({ ok: false, error: `The custom URL "${slug}" belongs to a teammate's artifact.` }, 409);
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
          .prepare(
            "SELECT * FROM drafts WHERE id = ? AND account_id = ? AND organization_id = ? AND deleted_at IS NULL"
          )
          .bind(draftId, viewer.account_id, viewer.organization_id)
          .first()
      : null);
  if (draftId && !existing) return c.json({ ok: false, error: "Artifact not found." }, 404);

  const current = existing?.current_version_id
    ? await db
        .prepare("SELECT id, version_number, content_hash FROM draft_versions WHERE id = ?")
        .bind(existing.current_version_id)
        .first()
    : null;
  // Re-sending identical content (a blind retry) keeps the current version.
  const unchanged = current?.content_hash === validation.contentHash;
  const id = existing?.id || newDraftId();
  const observedVersionId = existing?.current_version_id ?? null;
  const title = validation.title || existing?.title || filename || "Untitled";
  const cleanDescription = cleanText(description, 1000);
  let versionId = current?.id;

  const statements = [];
  if (!unchanged) {
    versionId = newInternalId();
    const { pages } = validation;
    const index = pages.find((page) => page.path === "index.html");
    const extraPages = pages.filter((page) => page !== index);
    const objectKey = `drafts/${id}/versions/${versionId}.html`;
    const pageKey = (page) => `drafts/${id}/versions/${versionId}/${page.path}`;
    await Promise.all([
      putHtmlObject(c.env.ARTIFACTS, objectKey, index.html),
      ...extraPages.map((page) => putHtmlObject(c.env.ARTIFACTS, pageKey(page), page.html))
    ]);

    if (!existing) {
      statements.push(
        db
          .prepare(
            `INSERT INTO drafts (id, account_id, organization_id, title, description, repo_org, repo_name, repo_host, slug)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            slug
          )
      );
    }
    // The version number is computed inside the INSERT, and the row is only
    // written if the artifact's current version is still the one this upload
    // started from (compare-and-swap; see the final UPDATE).
    statements.push(
      db
        .prepare(
          `INSERT INTO draft_versions (
             id, draft_id, version_number, object_key, content_hash, file_size, page_count,
             has_inline_script, created_by, credential_id, source_ip, user_agent, cli_version,
             git_branch, git_commit_sha, git_commit_subject, git_dirty, original_filename, ci_run_url)
           SELECT ?, ?, (SELECT COALESCE(MAX(version_number), 0) + 1 FROM draft_versions WHERE draft_id = ?),
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT current_version_id FROM drafts WHERE id = ?) IS ?`
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
          observedVersionId
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
  }
  // Metadata applies even when the content is unchanged; only new content
  // moves updated_at.
  statements.push(
    db
      .prepare(
        `UPDATE drafts SET current_version_id = ?, title = ?, description = COALESCE(?, description),
           repo_org = COALESCE(?, repo_org), repo_name = COALESCE(?, repo_name), repo_host = COALESCE(?, repo_host),
           slug = COALESCE(?, slug), updated_at = CASE WHEN ? THEN updated_at ELSE unixepoch() END
         WHERE id = ? AND current_version_id IS ?`
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
        observedVersionId
      )
  );

  try {
    const results = await db.batch(statements);
    // Another upload to this artifact landed after we read it: nothing of
    // ours became current. Safe to retry.
    if (!results.at(-1).meta.changes) {
      return c.json({ ok: false, error: "Another upload to this artifact landed at the same moment. Retry." }, 409);
    }
  } catch (error) {
    if (/UNIQUE constraint failed: drafts\.organization_id, drafts\.slug/.test(error.message)) {
      return c.json({ ok: false, error: "That custom URL was just taken. Pick another." }, 409);
    }
    if (/UNIQUE constraint failed: draft_versions/.test(error.message)) {
      return c.json({ ok: false, error: "Another upload to this artifact landed at the same moment. Retry." }, 409);
    }
    throw error;
  }

  const draft = await db.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first();
  const version = await db.prepare("SELECT version_number FROM draft_versions WHERE id = ?").bind(versionId).first();
  const origin = c.get("origin");
  const publicUrl = draftUrl(origin, draft, viewer.workspace.handle);
  const multiPage = validation.pages.length > 1;
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
      warnings: validation.warnings
    },
    existing ? 200 : 201
  );
}

// A read-only preflight: what the caller can publish, and whether a given
// upload body would pass. Never creates anything.
async function handleCheck(c) {
  const viewer = c.get("viewer");
  const capabilities = uploadCapabilities(viewer, c.get("config"));
  const body = await readJson(c, capabilities.maxBytes * 6 + 1024 * 1024);
  const report = {
    ok: true,
    account: { id: viewer.account_id, name: viewer.account_name },
    workspace: workspaceJson(viewer.workspace),
    limits: { maxBytes: capabilities.maxBytes, maxPages: capabilities.maxPages },
    capabilities: {
      inlineScripts: true,
      multiPage: true,
      customUrls: true,
      externalAssets: "https images, video, audio, fonts, and stylesheets",
      blockedInSandbox: SANDBOX_LIMITS
    }
  };
  if (body.html !== undefined || body.files !== undefined) {
    const validation = validateUpload(requestPages(body), capabilities);
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
        .first();
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

function uploadCapabilities(viewer, config) {
  const { limits } = config;
  return {
    maxBytes: viewer.flags.includes(FLAGS.largeUploads) ? limits.largeBytes : limits.accountBytes,
    maxPages: limits.maxPages
  };
}

// An upload is one document (`html`) or a folder of pages (`files`).
function requestPages(body) {
  if (Array.isArray(body?.files)) {
    return body.files.map((file) => ({ path: file?.path, html: file?.html }));
  }
  return [{ path: "index.html", html: body?.html }];
}

// Returns null when no slug was sent; anything else goes through slugProblem.
function normalizeSlug(value) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function readJson(c, maxBytes) {
  const length = Number(c.req.header("content-length") || 0);
  if (length > maxBytes) throw httpError(413, `Request is over the ${formatBytes(maxBytes)} limit.`);
  const text = await c.req.text();
  if (text.length > maxBytes) throw httpError(413, `Request is over the ${formatBytes(maxBytes)} limit.`);
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    throw httpError(400, "Request body is not valid JSON.");
  }
}

async function relayWorkos(c, pathname, body) {
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
  const json = await response.json().catch(() => ({ error: "bad_gateway" }));
  return c.json(json, response.status);
}

export function workspaceJson(workspace, role) {
  if (!workspace) return null;
  return {
    id: workspace.organization_id,
    name: workspace.name,
    handle: workspace.handle,
    ...(role !== undefined ? { role } : {})
  };
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanText(value, maxLength = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
