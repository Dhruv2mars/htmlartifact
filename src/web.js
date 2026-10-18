import { config } from "./config.js";
import { createRateLimiter } from "./rate-limit.js";
import { clientIp } from "./client-ip.js";
import { sessionViewer } from "./auth.js";
import { randomToken } from "./crypto.js";
import { createHash } from "node:crypto";
import { getAccountDraftWithVersions, listAccountDrafts, listWorkspaceDrafts } from "./drafts.js";
import { getDraftRefFromHost, getHomeUrl, getRequestBaseUrl, isOwnUrl } from "./public-url.js";
import { workos } from "./workos.js";
import {
  clearAuthStateCookie,
  clearSessionCookie,
  createAuthStateCookie,
  createSessionCookie,
  readAuthState,
  readSealedSession
} from "./web-auth.js";
import {
  renderAuthError,
  renderCliSetup,
  renderDashboard,
  renderDraftDetail,
  renderOnboarding,
  renderSignIn,
  renderTeam,
  renderWorkspace
} from "./render-web.js";

const ADMIN_PORTAL_INTENTS = new Set(["sso", "dsync", "domain_verification", "audit_logs"]);

// Server-rendered web UI: AuthKit sign-in, dashboards, team management and
// CLI setup. Apex-domain only: on artifact subdomains these paths fall
// through to the 404 handler so an artifact origin never serves app UI.
export function registerWebRoutes(app) {
  const web = [onlyApex];
  // POSTed HTML forms: same-origin only, then parse, then a signed-in member.
  const form = (extra) => [onlyApex, sameOrigin, formBody, signedIn, ...extra];
  const teamWriteLimit = createRateLimiter({
    windowMs: 3_600_000,
    max: Number(process.env.TEAM_WRITE_RATE_LIMIT_MAX || 30),
    keyPrefix: "team-write",
    key: (req) => req.viewer?.account_id || clientIp(req) || "anonymous"
  });

  app.get("/", ...web, (req, res) => res.redirect("/workspace"));

  // ?org= forces sign-in into one organization (used when a switch needs a
  // fresh login, e.g. an org that enforces SSO).
  app.get("/auth/sign-in", ...web, (req, res) => {
    const verifier = randomToken(32);
    const state = randomToken(24);
    res.append(
      "Set-Cookie",
      createAuthStateCookie({ state, verifier, next: safeNext(req.query.next) })
    );
    res.redirect(
      workos().userManagement.getAuthorizationUrl({
        provider: "authkit",
        clientId: config.workos.clientId,
        redirectUri: callbackUrl(),
        state,
        codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
        codeChallengeMethod: "S256",
        organizationId: typeof req.query.org === "string" ? req.query.org : undefined
      })
    );
  });

  app.get("/auth/callback", ...web, async (req, res, next) => {
    try {
      res.append("Set-Cookie", clearAuthStateCookie());

      if (typeof req.query.error === "string") {
        return res
          .status(403)
          .type("html")
          .send(renderAuthError({ message: "Sign-in was cancelled or denied." }));
      }
      const authState = readAuthState(req);
      const { code, state } = req.query;
      if (!authState || typeof state !== "string" || state !== authState.state) {
        return res
          .status(400)
          .type("html")
          .send(renderAuthError({ message: "Sign-in expired or state mismatch. Please retry." }));
      }
      if (typeof code !== "string" || !code) {
        return res.status(400).type("html").send(renderAuthError({ message: "Missing authorization code." }));
      }

      let auth;
      try {
        auth = await workos().userManagement.authenticateWithCode({
          clientId: config.workos.clientId,
          code,
          codeVerifier: authState.verifier,
          session: { sealSession: true, cookiePassword: config.cookiePassword }
        });
      } catch (error) {
        console.error("WorkOS sign-in failed:", error.message);
        return res
          .status(502)
          .type("html")
          .send(renderAuthError({ message: "Sign-in could not be completed. Please retry." }));
      }

      res.append("Set-Cookie", createSessionCookie(auth.sealedSession));
      res.redirect(auth.organizationId ? safeNext(authState.next) : "/onboarding");
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/sign-out", onlyApex, sameOrigin, async (req, res) => {
    res.append("Set-Cookie", clearSessionCookie());
    const sealed = readSealedSession(req);
    let target = "/workspace";
    if (sealed) {
      try {
        target = await workos()
          .userManagement.loadSealedSession({ sessionData: sealed, cookiePassword: config.cookiePassword })
          .getLogoutUrl({ returnTo: webOrigin() });
      } catch {
        // Already expired: clearing the cookie is all that is left to do.
      }
    }
    res.redirect(target);
  });

  app.get("/workspace", ...web, signedIn, inOrganization, async (req, res, next) => {
    try {
      const drafts = await listWorkspaceDrafts(req.viewer.organization_id, {
        requestBaseUrl: getRequestBaseUrl(req)
      });
      res.type("html").send(renderWorkspace({ session: req.viewer, drafts }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/dashboard", ...web, signedIn, inOrganization, async (req, res, next) => {
    try {
      const drafts = await listAccountDrafts(req.viewer.account_id, req.viewer.organization_id, {
        requestBaseUrl: getRequestBaseUrl(req)
      });
      res.type("html").send(renderDashboard({ session: req.viewer, drafts }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/dashboard/drafts/:draftId", ...web, signedIn, inOrganization, async (req, res, next) => {
    try {
      const result = await getAccountDraftWithVersions(
        req.viewer.account_id,
        req.viewer.organization_id,
        req.params.draftId,
        { requestBaseUrl: getRequestBaseUrl(req) }
      );
      if (!result) return next();
      res.type("html").send(
        renderDraftDetail({ session: req.viewer, draft: result.draft, versions: result.versions })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/onboarding", ...web, signedIn, async (req, res, next) => {
    try {
      res.type("html").send(
        renderOnboarding({
          session: req.viewer,
          memberships: await listMemberships(req.viewer.account_id),
          allowTeamCreation: config.allowTeamCreation
        })
      );
    } catch (error) {
      next(error);
    }
  });

  // Creates a WorkOS organization with the caller as its admin, then moves
  // the session into it.
  app.post("/teams", ...form([teamWriteLimit]), async (req, res, next) => {
    try {
      if (!config.allowTeamCreation) return res.status(403).type("text").send("Team creation is disabled.");
      const name = cleanText(req.body?.name, 100);
      if (!name) return res.redirect("/onboarding");
      const organization = await workos().organizations.createOrganization({ name });
      await workos().userManagement.createOrganizationMembership({
        organizationId: organization.id,
        userId: req.viewer.account_id,
        roleSlug: "admin"
      });
      await switchOrRedirect(req, res, organization.id, "/team");
    } catch (error) {
      next(error);
    }
  });

  app.post("/orgs/switch", ...form([]), async (req, res, next) => {
    try {
      await switchOrRedirect(req, res, cleanText(req.body?.organizationId), "/workspace");
    } catch (error) {
      next(error);
    }
  });

  app.get("/team", ...web, signedIn, inOrganization, async (req, res, next) => {
    try {
      const isAdmin = req.viewer.role === "admin";
      res.type("html").send(
        renderTeam({
          session: req.viewer,
          isAdmin,
          memberships: await listMemberships(req.viewer.account_id),
          apiKeys: isAdmin ? await listApiKeys(req.viewer.organization_id) : [],
          notice: typeof req.query.notice === "string" ? req.query.notice : null
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/team/invitations", ...form([adminOnly, teamWriteLimit]), async (req, res, next) => {
    try {
      const email = cleanText(req.body?.email, 254);
      if (!email || !email.includes("@")) return res.redirect("/team?notice=Enter+an+email+address.");
      await workos().userManagement.sendInvitation({
        email,
        organizationId: req.viewer.organization_id,
        inviterUserId: req.viewer.account_id,
        roleSlug: req.body?.role === "admin" ? "admin" : undefined
      });
      res.redirect(`/team?notice=${encodeURIComponent(`Invitation sent to ${email}.`)}`);
    } catch (error) {
      console.error("invitation failed:", error.message);
      res.redirect(`/team?notice=${encodeURIComponent(`Invitation failed: ${error.message}`)}`);
    }
  });

  // Organization API keys for CI. The value is shown once, on this response.
  app.post("/team/api-keys", ...form([adminOnly, teamWriteLimit]), async (req, res, next) => {
    try {
      const key = await workos().apiKeys.createOrganizationApiKey({
        organizationId: req.viewer.organization_id,
        name: cleanText(req.body?.name, 80) || `CI · ${new Date().toISOString().slice(0, 10)}`
      });
      res.type("html").send(
        renderTeam({
          session: req.viewer,
          isAdmin: true,
          memberships: await listMemberships(req.viewer.account_id),
          apiKeys: await listApiKeys(req.viewer.organization_id),
          newKey: { name: key.name, value: key.value }
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/team/api-keys/:apiKeyId/delete", ...form([adminOnly]), async (req, res, next) => {
    try {
      // Only delete keys this organization owns.
      const keys = await listApiKeys(req.viewer.organization_id);
      if (keys.some((key) => key.id === req.params.apiKeyId)) {
        await workos().apiKeys.deleteApiKey(req.params.apiKeyId);
      }
      res.redirect("/team");
    } catch (error) {
      next(error);
    }
  });

  // WorkOS Admin Portal: self-serve SSO, SCIM directory sync, domain
  // verification and audit-log streaming for this organization.
  app.post("/team/admin-portal/:intent", ...form([adminOnly]), async (req, res, next) => {
    try {
      if (!ADMIN_PORTAL_INTENTS.has(req.params.intent)) return next();
      const { link } = await workos().portal.generateLink({
        organization: req.viewer.organization_id,
        intent: req.params.intent,
        returnUrl: `${webOrigin()}/team`
      });
      res.redirect(link);
    } catch (error) {
      next(error);
    }
  });

  app.get("/cli/auth", ...web, signedIn, (req, res) => {
    res.type("html").send(renderCliSetup({ session: req.viewer, homeUrl: webOrigin() }));
  });
}

// Where a signed-out browser goes to read `next` (absolute URL or a path).
export function signInUrl(next) {
  return `${webOrigin()}/auth/sign-in?next=${encodeURIComponent(next)}`;
}

async function signedIn(req, res, next) {
  try {
    req.viewer = await sessionViewer(req, res);
    if (!req.viewer) {
      return res.status(401).type("html").send(renderSignIn({ next: req.originalUrl }));
    }
    next();
  } catch (error) {
    next(error);
  }
}

// CSRF defence for every state-changing browser route. SameSite=Lax stops
// cross-site POSTs, but not ones from a sibling subdomain of the same site,
// so require the browser-set Origin (or Referer) to be exactly this app.
function sameOrigin(req, res, next) {
  const source = req.get("origin") || refererOrigin(req.get("referer"));
  if (source && source === new URL(webOrigin()).origin) return next();
  res.status(403).type("text").send("Cross-origin form submission refused.\n");
}

function refererOrigin(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

function inOrganization(req, res, next) {
  if (!req.viewer.organization_id) return res.redirect("/onboarding");
  next();
}

function adminOnly(req, res, next) {
  if (!req.viewer.organization_id || req.viewer.role !== "admin") {
    return res.status(403).type("html").send(renderAuthError({ title: "Admins only", message: "Ask an admin of this team.", retry: false }));
  }
  next();
}

// Moves the session into `organizationId`. WorkOS refuses non-members; an
// org that needs a fresh login (SSO) gets one.
async function switchOrRedirect(req, res, organizationId, destination) {
  if (!organizationId) return res.redirect("/onboarding");
  const viewer = await sessionViewer(req, res, { organizationId });
  if (viewer?.organization_id === organizationId) return res.redirect(destination);
  res.redirect(`/auth/sign-in?org=${encodeURIComponent(organizationId)}&next=${encodeURIComponent(destination)}`);
}

async function listMemberships(userId) {
  const page = await workos().userManagement.listOrganizationMemberships({
    userId,
    statuses: ["active"],
    limit: 100
  });
  return page.data.map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName }));
}

async function listApiKeys(organizationId) {
  const page = await workos().apiKeys.listOrganizationApiKeys({ organizationId, limit: 100 });
  return page.data.map((key) => ({
    id: key.id,
    name: key.name,
    obfuscatedValue: key.obfuscatedValue,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt
  }));
}

function formBody(req, res, next) {
  if (req.body !== undefined) return next();
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 16_384) req.destroy();
  });
  req.on("end", () => {
    req.body = Object.fromEntries(new URLSearchParams(raw));
    next();
  });
}

function onlyApex(req, res, next) {
  const draftRef = getDraftRefFromHost({
    publicBaseUrl: config.publicBaseUrl,
    host: req.hostname || req.get("host")
  });
  if (draftRef) return next("route");
  next();
}

export function webOrigin() {
  return getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: "" });
}

function callbackUrl() {
  return `${webOrigin()}/auth/callback`;
}

function cleanText(value, maxLength = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

// Post-sign-in destinations: same-site relative paths, or absolute URLs on
// this deployment (artifact subdomains in wildcard mode). Never an open
// redirect.
function safeNext(value) {
  if (typeof value !== "string") return "/workspace";
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return value;
  }
  return isOwnUrl(value, config.publicBaseUrl) ? value : "/workspace";
}
