import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { Hono } from "hono";
import {
  Browser,
  COOKIE_PASSWORD,
  OTHER_CI_KEY,
  accessToken,
  callApi,
  findOrganization,
  findUser,
  page,
  refreshInto,
  signInTokens,
  startStack
} from "./helpers.js";

// Tenant isolation, swept over every route the Worker registers. Workspace A
// (Acme: alice admin, bob, sam) publishes artifacts with several versions;
// outsiders from other workspaces (Other: olivia + its CI key; Nora Labs:
// nora, admin) aim every route at A's identifiers (draft IDs, slugs, version
// numbers, pages, handle, organization ID, user IDs, invite codes, sandbox
// capabilities), by CLI token, API key and browser session. Every answer must
// be non-2xx (404 where an ID is named, identical to a missing ID), carry none
// of A's content, IDs or names, and change nothing in A. Lists must hold none
// of A's items.
//
// ROUTES maps every registered "METHOD path" to how it is swept. A route the
// table does not know fails the first test, so a new route cannot skip this.

const MARKER = "ACME-SECRET-BODY-91c2";
const TITLE_A = "Quarterly Secret Plan";
const TITLE_BOB = "Bob Private Notes";
const SLUG_A = "quarterly-plan";
const SLUG_BOB = "bob-notes";
const MISSING_DRAFT = "zzzzzzzzzzzz";
const MISSING_CODE = "HA-ZZZZ-ZZZZ-ZZZZ";

let stack;
const A = {}; // workspace A: org, users, receipts, invite
const B = {}; // outsiders: tokens, browsers, their own artifact
let SECRETS = []; // strings no outsider response may contain
let snapshot; // A as alice saw it before the sweep
const exercised = new Set();

// ---- route discovery -------------------------------------------------------

// Every route registered on the Worker's Hono apps, two ways: a source scan
// of src/*.ts (catches routes in index.ts's private baseApp, e.g. /healthz),
// and the real registrars (every exported register* function, run on a
// fresh Hono app) so the scan cannot silently miss a route.
async function registeredRoutes() {
  const srcDir = new URL("../src/", import.meta.url);
  const routes = new Set();
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
    const source = fs.readFileSync(new URL(file, srcDir), "utf8");
    for (const m of source.matchAll(/\.(get|post|put|patch|delete|all|options|head)\(\s*(["'`])(\/[^"'`]*)\2/g)) {
      routes.add(`${m[1].toUpperCase()} ${m[3]}`);
    }
    assert.doesNotMatch(
      source,
      /\.(route|on|mount|basePath)\(/,
      `${file} registers routes in a form this sweep cannot enumerate; extend registeredRoutes()`
    );
    let mod;
    try {
      mod = await import(new URL(file, srcDir));
    } catch (error) {
      // Only Worker-runtime modules (cloudflare:*) fail to load in Node; they must not hold routes.
      assert.doesNotMatch(source, /\bHono\b/, `${file} uses Hono but could not be loaded: ${error.message}`);
      continue;
    }
    for (const [name, fn] of Object.entries(mod)) {
      if (!/^register[A-Z]/.test(name) || typeof fn !== "function") continue;
      const app = new Hono();
      fn(app);
      for (const r of app.routes) {
        if (r.method === "ALL" && r.path === "/*") continue; // app.use middleware
        routes.add(`${r.method} ${r.path}`);
      }
    }
  }
  return routes;
}

// ---- helpers ---------------------------------------------------------------

const loginHint = (email) => (url) => {
  const u = new URL(url);
  if (u.origin === new URL(stack.emulator.url).origin && u.pathname.endsWith("/authorize")) {
    u.searchParams.set("login_hint", email);
  }
  return u.toString();
};

// An API call as an actor: { token } (CLI token / API key) or { browser } (session cookie only).
async function call(actor, method, pathname, body) {
  const url = new URL(pathname, stack.baseUrl).toString();
  const headers = { "Content-Type": "application/json" };
  if (actor?.token) headers.Authorization = `Bearer ${actor.token}`;
  if (actor?.browser) headers.Cookie = actor.browser.cookieHeader(url);
  const response = await fetch(url, {
    method,
    headers,
    redirect: "manual",
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, text, json, headers: response.headers };
}

// A GET of an absolute URL as an actor (artifact and sandbox URLs).
async function read(actor, url) {
  if (actor?.browser) {
    const r = await actor.browser.get(url);
    return { status: r.status, text: r.text_, headers: r.headers };
  }
  const response = await fetch(url, {
    headers: actor?.token ? { Authorization: `Bearer ${actor.token}` } : {},
    redirect: "manual"
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

// Static copy that happens to contain A's seeded name ("Acme"): the example
// command on the /workspaces page.
const STATIC_COPY = ['htmlartifact workspace create "Acme"'];

function assertClean(label, text, allow = []) {
  let body = String(text);
  for (const copy of STATIC_COPY) body = body.replaceAll(copy, "");
  for (const secret of SECRETS) {
    if (allow.includes(secret)) continue;
    assert.ok(!body.includes(secret), `${label}: response leaks ${JSON.stringify(secret)}\n${String(text).slice(0, 600)}`);
  }
}

function assertDenied(label, res, { status, missing } = {}) {
  assert.ok(res.status < 200 || res.status >= 300, `${label}: expected non-2xx, got ${res.status}\n${res.text.slice(0, 400)}`);
  if (status) assert.equal(res.status, status, `${label}: ${res.text.slice(0, 400)}`);
  if (missing) {
    assert.equal(res.status, missing.status, `${label}: A's resource and a missing one answer differently`);
    assert.equal(res.text, missing.text, `${label}: A's resource and a missing one answer differently`);
  }
  assertClean(label, res.text);
}

// Where a sign-in aimed at A's organization ends. WorkOS (the emulator)
// refuses it on its own origin, echoing only the organization ID the caller
// supplied; anything the app serves must be clean.
function assertLanding(label, res) {
  if (new URL(res.finalUrl).origin === new URL(stack.emulator.url).origin) {
    assert.ok(res.status >= 400, `${label}: WorkOS accepted a sign-in into A (${res.status})`);
    assertClean(`${label} (WorkOS)`, res.text_, [A.org.id]);
  } else {
    assertClean(label, res.text_);
  }
}

function signCapability(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", `htmlartifact:sandbox-capability:v1:${COOKIE_PASSWORD}`)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function frameSrc(html) {
  const match = html.match(/<iframe[^>]*\ssrc="([^"]+)"/);
  return match ? match[1].replaceAll("&amp;", "&") : null;
}

const tokenOf = (src) => new URL(src).pathname.split("/")[2];
const claimsOf = (token) => JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
const app = (pathname) => new URL(pathname, stack.baseUrl).toString();
const onSandbox = (pathname) => new URL(pathname, stack.sandboxUrl).toString();

// Outsiders, as the routes accept them. API routes take bearer credentials;
// a session cookie alone must not work there either.
const apiActors = () => [
  { name: "olivia (Other member, CLI token)", token: B.olivia },
  { name: "Other CI key", token: OTHER_CI_KEY },
  { name: "nora (Nora Labs admin, CLI token)", token: B.nora },
  { name: "olivia (session cookie on the API)", browser: B.oliviaBrowser }
];
const webActors = () => [
  { name: "olivia (Other member, browser)", browser: B.oliviaBrowser, email: "olivia@other.test" },
  { name: "nora (Nora Labs admin, browser)", browser: B.noraBrowser, email: "nora@new.test" }
];
const allActors = () => [...apiActors().filter((a) => a.token), ...webActors()];

// A's artifact URLs, every form serve() understands, plus a missing twin.
function artifactUrls() {
  const d = A.plan.draftId;
  const h = A.handle;
  return {
    byId: [
      [`/d/${d}`, `/d/${MISSING_DRAFT}`],
      [`/d/${A.bobDraft.draftId}`, `/d/${MISSING_DRAFT}`]
    ],
    byIdBelow: [
      [`/d/${d}/`, `/d/${MISSING_DRAFT}/`],
      [`/d/${d}/raw`, `/d/${MISSING_DRAFT}/raw`],
      [`/d/${d}/details.html`, `/d/${MISSING_DRAFT}/details.html`],
      [`/d/${d}/details`, `/d/${MISSING_DRAFT}/details`],
      [`/d/${d}/v/1`, `/d/${MISSING_DRAFT}/v/1`],
      [`/d/${d}/v/1/raw`, `/d/${MISSING_DRAFT}/v/1/raw`],
      [`/d/${d}/v/2/`, `/d/${MISSING_DRAFT}/v/2/`],
      [`/d/${d}/v/3/details.html`, `/d/${MISSING_DRAFT}/v/3/details.html`],
      [`/d/${A.bobDraft.draftId}/v/1`, `/d/${MISSING_DRAFT}/v/1`]
    ],
    bySlug: [
      [`/w/${h}/${SLUG_A}`, `/w/${h}/missing-slug`],
      [`/w/${h}/${SLUG_BOB}`, `/w/${h}/missing-slug`],
      [`/w/${h}/${SLUG_A}`, `/w/missing-handle-zzzz/${SLUG_A}`]
    ],
    bySlugBelow: [
      [`/w/${h}/${SLUG_A}/`, `/w/${h}/missing-slug/`],
      [`/w/${h}/${SLUG_A}/raw`, `/w/${h}/missing-slug/raw`],
      [`/w/${h}/${SLUG_A}/details.html`, `/w/${h}/missing-slug/details.html`],
      [`/w/${h}/${SLUG_A}/v/1`, `/w/${h}/missing-slug/v/1`],
      [`/w/${h}/${SLUG_A}/v/2/details`, `/w/${h}/missing-slug/v/2/details`],
      [`/w/${h}/${SLUG_A}/v/3/`, `/w/${h}/missing-slug/v/3/`]
    ]
  };
}

async function sweepArtifactUrls(key, pairs) {
  exercised.add(key);
  for (const actor of allActors()) {
    for (const [target, missingPath] of pairs) {
      const label = `${key} ${target} as ${actor.name}`;
      const res = await read(actor, app(target));
      const missing = await read(actor, app(missingPath));
      assertDenied(label, res, { status: 404, missing });
      assert.equal(frameSrc(res.text), null, `${label}: a capability was minted`);
      assert.ok(!res.text.includes("/t/"), `${label}: a capability URL was minted`);
      assert.equal(res.headers.get("x-htmlartifact-draft-id"), null, label);
    }
  }
}

// ---- the route table -------------------------------------------------------

const ROUTES = {
  // index.ts (both apps)
  "GET /healthz": {
    kind: "global",
    why: "no identifiers; reports only store booleans and the storage kind",
    async run(key) {
      for (const base of [stack.baseUrl, stack.sandboxUrl]) {
        const res = await read({ token: B.olivia }, `${base}/healthz`);
        assert.equal(res.status, 200);
        assert.deepEqual(Object.keys(JSON.parse(res.text)).sort(), ["checks", "ok", "storage"]);
        assertClean(key, res.text);
      }
    }
  },
  "GET /favicon.svg": {
    kind: "global",
    why: "static asset, no tenant data",
    async run(key) {
      const res = await read({ token: B.olivia }, app("/favicon.svg"));
      assert.equal(res.status, 200);
      assertClean(key, res.text);
    }
  },

  // webhooks.ts
  "POST /webhooks/workos": {
    kind: "resource",
    why: "names A's organization/users in the payload; only a valid WorkOS signature is accepted",
    async run(key) {
      const payloads = [
        { event: "organization.deleted", data: { id: A.org.id } },
        { event: "organization_membership.deleted", data: { user_id: A.bob.id, organization_id: A.org.id } },
        { event: "user.deleted", data: { id: A.alice.id } }
      ];
      for (const payload of payloads) {
        const body = JSON.stringify(payload);
        const t = Date.now();
        const forged = createHmac("sha256", "not-the-secret").update(`${t}.${body}`).digest("hex");
        for (const signature of [undefined, `t=${t}, v1=${forged}`]) {
          const response = await fetch(app("/webhooks/workos"), {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(signature ? { "WorkOS-Signature": signature } : {}) },
            body
          });
          const res = { status: response.status, text: await response.text() };
          assertDenied(`${key} ${payload.event} (${signature ? "forged" : "unsigned"})`, res, { status: 400 });
        }
      }
    }
  },

  // api.ts
  "POST /api/cli/device": {
    kind: "global",
    why: "no identifiers; relays the WorkOS device flow for the caller",
    async run(key) {
      const res = await call(null, "POST", "/api/cli/device");
      assertClean(key, res.text);
    }
  },
  "POST /api/cli/token": {
    kind: "resource",
    why: "takes organization_id: an outsider's refresh into A must not yield A access",
    async run(key) {
      for (const [name, tokens] of [
        ["olivia", B.oliviaTokens],
        ["nora", B.noraTokens]
      ]) {
        const res = await call(null, "POST", "/api/cli/token", {
          refresh_token: tokens.refreshToken,
          organization_id: A.org.id
        });
        const label = `${key} as ${name} into A`;
        if (res.status >= 200 && res.status < 300 && res.json?.access_token) {
          // WorkOS issued something: the app must still see no A membership.
          const me = await call({ token: res.json.access_token }, "GET", "/api/me");
          assert.notEqual(me.json?.workspace?.id, A.org.id, label);
          assertClean(`${label} /api/me`, me.text);
          const drafts = await call({ token: res.json.access_token }, "GET", "/api/drafts?scope=workspace");
          assertDenied(`${label} /api/drafts`, drafts, { status: 403 });
        } else {
          assertDenied(label, res);
        }
        // The refresh token may have rotated: sign in afresh.
        if (name === "olivia") B.oliviaTokens = await signInTokens(stack, "olivia@other.test");
        else B.noraTokens = await refreshInto(stack, await signInTokens(stack, "nora@new.test", "Nora Labs"), B.noraOrg.id);
      }
    }
  },
  "POST /api/cli/logout": {
    kind: "self",
    why: "ends only the caller's own CLI session; session IDs in the body are ignored",
    async run(key) {
      const aliceSid = JSON.parse(Buffer.from(A.aliceToken.split(".")[1], "base64url").toString("utf8")).sid;
      assert.ok(aliceSid);
      const body = { session_id: aliceSid, sid: aliceSid, organization_id: A.org.id };
      // API keys and session cookies have no CLI session to end.
      for (const actor of apiActors().filter((a) => a.token !== B.olivia && a.token !== B.nora)) {
        assertDenied(`${key} as ${actor.name}`, await call(actor, "POST", "/api/cli/logout", body));
      }
      assertDenied(`${key} signed out`, await call(null, "POST", "/api/cli/logout", body), { status: 401 });
      // A throwaway olivia session signs itself out, and nothing else.
      const own = await signInTokens(stack, "olivia@other.test");
      const res = await call({ token: own.accessToken }, "POST", "/api/cli/logout", body);
      assert.equal(res.status, 200, res.text);
      assertClean(key, res.text);
      assert.equal((await call({ token: own.accessToken }, "GET", "/api/me")).status, 401);
      const alice = await call({ token: A.aliceToken }, "GET", "/api/me");
      assert.equal(alice.status, 200, alice.text);
      assert.equal(alice.json.workspace.id, A.org.id);
      assert.equal((await call({ token: B.olivia }, "GET", "/api/me")).status, 200);
    }
  },
  "GET /api/me": {
    kind: "self",
    why: "caller-scoped, no identifiers",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "GET", "/api/me");
        if (res.status === 200) assert.notEqual(res.json.workspace?.id, A.org.id, actor.name);
        assertClean(`${key} as ${actor.name}`, res.text);
      }
    }
  },
  "GET /api/workspaces": {
    kind: "list",
    why: "lists the caller's workspaces",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "GET", "/api/workspaces");
        if (res.status === 200) assert.ok(!res.json.workspaces.some((w) => w.id === A.org.id), actor.name);
        assertClean(`${key} as ${actor.name}`, res.text);
      }
    }
  },
  "POST /api/workspaces": {
    kind: "create",
    why: "creates a new workspace; must touch nothing of A even when told A's id",
    async run(key) {
      const res = await call({ token: B.olivia }, "POST", "/api/workspaces", {
        name: "Olivia Side",
        organization_id: A.org.id,
        id: A.org.id
      });
      assert.equal(res.status, 201, res.text);
      assert.notEqual(res.json.workspace.id, A.org.id);
      assertClean(key, res.text);
      assert.equal(B.noraCreated.status, 201);
      assertClean(`${key} (nora, setup)`, B.noraCreated.text);
    }
  },
  "POST /api/workspaces/invites": {
    kind: "resource",
    why: "invite is minted for the caller's workspace only, whatever the body says",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "POST", "/api/workspaces/invites", { organization_id: A.org.id, workspace: A.handle });
        const label = `${key} as ${actor.name}`;
        if (actor.token === B.nora) {
          assert.equal(res.status, 201, res.text);
          assert.equal(res.json.workspace.id, B.noraOrg.id);
          assertClean(label, res.text);
          const landing = await B.noraBrowser.get(`/join/${res.json.code}`);
          assert.match(landing.text_, /Join Nora Labs/);
          assertClean(`${label} landing`, landing.text_);
        } else {
          assertDenied(label, res);
        }
      }
    }
  },
  "GET /api/workspaces/invites": {
    kind: "list",
    why: "lists the caller's workspace's live codes only",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "GET", "/api/workspaces/invites");
        const label = `${key} as ${actor.name}`;
        if (actor.token === B.nora) {
          assert.equal(res.status, 200, res.text);
          assertClean(label, res.text);
        } else {
          assertDenied(label, res);
        }
      }
    }
  },
  "DELETE /api/workspaces/invites/:code": {
    kind: "resource",
    why: "takes an invite code; A's live code is not the caller's to revoke, and 'all' means the caller's workspace",
    async run(key) {
      for (const actor of apiActors()) {
        for (const target of [A.liveCode, "all"]) {
          const res = await call(actor, "DELETE", `/api/workspaces/invites/${target}`);
          const label = `${key} ${target} as ${actor.name}`;
          if (actor.token === B.nora && target === "all") assert.equal(res.status, 200, res.text);
          else assertDenied(label, res);
          assertClean(label, res.text);
        }
      }
      const live = await callApi(stack, A.aliceToken, "GET", "/api/workspaces/invites");
      assert.ok(live.body.invites.some((i) => i.code === A.liveCode), "A's live code survives");
    }
  },
  "POST /api/workspaces/join": {
    kind: "resource",
    why: "takes an invite code; A's used-up code must not admit anyone",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "POST", "/api/workspaces/join", { code: A.usedCode });
        const missing = await call(actor, "POST", "/api/workspaces/join", { code: MISSING_CODE });
        assertDenied(`${key} as ${actor.name}`, res, { missing });
      }
    }
  },
  "GET /api/workspaces/members": {
    kind: "list",
    why: "lists the caller's workspace members",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "GET", "/api/workspaces/members");
        if (res.status === 200) {
          const ids = res.json.members.map((m) => m.id);
          for (const id of A.onlyMemberIds) assert.ok(!ids.includes(id), `${actor.name} sees A member ${id}`);
        }
        assertClean(`${key} as ${actor.name}`, res.text);
      }
    }
  },
  "DELETE /api/workspaces/members/:userId": {
    kind: "resource",
    why: "takes a user ID; A's members are not the caller's to remove",
    async run(key) {
      for (const actor of apiActors()) {
        const missing = await call(actor, "DELETE", "/api/workspaces/members/user_01ZZZZZZZZZZZZZZZZZZZZZZZZ");
        for (const id of A.onlyMemberIds) {
          const res = await call(actor, "DELETE", `/api/workspaces/members/${id}`);
          assertDenied(`${key} ${id} as ${actor.name}`, res, { missing });
        }
      }
    }
  },
  "DELETE /api/workspaces/current": {
    kind: "resource",
    why: "deletes only the caller's workspace; confirming with A's name or id must not delete A",
    async run(key) {
      for (const actor of apiActors()) {
        for (const confirm of [A.workspace.name, A.org.id, A.handle]) {
          const res = await call(actor, "DELETE", "/api/workspaces/current", { confirm, organization_id: A.org.id });
          assertDenied(`${key} confirm=${confirm} as ${actor.name}`, res);
        }
      }
    }
  },
  "POST /api/workspaces/portal": {
    kind: "resource",
    why: "portal link is for the caller's workspace only, whatever the body says",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "POST", "/api/workspaces/portal", {
          intent: "sso",
          organization: A.org.id,
          organization_id: A.org.id
        });
        const label = `${key} as ${actor.name}`;
        if (actor.token === B.nora) {
          assert.equal(res.status, 200, res.text);
          assert.match(res.json.url, new RegExp(`/${B.noraOrg.id}$`));
          assertClean(label, res.text);
        } else {
          assertDenied(label, res);
        }
      }
    }
  },
  "POST /api/check": {
    kind: "resource",
    why: "takes a slug: A's slugs must read as available elsewhere (existence must not leak)",
    async run(key) {
      for (const actor of apiActors()) {
        const res = await call(actor, "POST", "/api/check", { slug: SLUG_BOB, html: page("probe") });
        const label = `${key} as ${actor.name}`;
        if (actor.token) {
          assert.equal(res.status, 200, res.text);
          assert.equal(res.json.slug.status, "available", label);
          assertClean(label, res.text);
        } else {
          assertDenied(label, res);
        }
      }
    }
  },
  "POST /api/uploads": {
    kind: "resource",
    why: "takes draftId and slug: must never write into A's artifacts",
    async run(key) {
      for (const actor of apiActors()) {
        for (const target of [A.plan.draftId, A.bobDraft.draftId]) {
          const res = await call(actor, "POST", "/api/uploads", { html: page("hijack", "<p>owned</p>"), draftId: target });
          const missing = await call(actor, "POST", "/api/uploads", {
            html: page("hijack", "<p>owned</p>"),
            draftId: MISSING_DRAFT
          });
          assertDenied(`${key} draftId=${target} as ${actor.name}`, res, { missing });
          const both = await call(actor, "POST", "/api/uploads", {
            html: page("hijack", "<p>owned</p>"),
            draftId: target,
            slug: SLUG_A
          });
          assertDenied(`${key} draftId+slug as ${actor.name}`, both);
        }
      }
      // The same slug in another workspace is that workspace's own artifact.
      const own = await call({ token: B.nora }, "POST", "/api/uploads", { html: page("Nora quarterly"), slug: SLUG_A });
      assert.equal(own.status, 201, own.text);
      assert.equal(own.json.created, true);
      assert.notEqual(own.json.draftId, A.plan.draftId);
      assert.ok(own.json.publicUrl.endsWith(`/w/${B.noraHandle}/${SLUG_A}`), own.json.publicUrl);
      assertClean(`${key} own slug`, own.text);
      const viaA = await read({ token: B.nora }, app(`/w/${A.handle}/${SLUG_A}`));
      assertDenied(`${key} nora reads A's slug after reusing it`, viaA, { status: 404 });
      const aliceViaNora = await read({ token: A.aliceToken }, own.json.publicUrl);
      assert.equal(aliceViaNora.status, 404, "A cannot read Nora's same-slug artifact either");
    }
  },
  "GET /api/drafts": {
    kind: "list",
    why: "lists the caller's (or workspace's) artifacts",
    async run(key) {
      for (const actor of apiActors()) {
        for (const query of ["", "?scope=workspace", `?scope=workspace&organization_id=${A.org.id}`]) {
          const res = await call(actor, "GET", `/api/drafts${query}`);
          const label = `${key}${query} as ${actor.name}`;
          if (res.status === 200) {
            const ids = res.json.drafts.map((d) => d.draftId);
            assert.ok(!ids.includes(A.plan.draftId) && !ids.includes(A.bobDraft.draftId), label);
          } else {
            assert.ok(actor.browser, `${label}: ${res.status}`);
          }
          assertClean(label, res.text);
        }
      }
    }
  },
  "DELETE /api/drafts/:draftId": {
    kind: "resource",
    why: "takes a draft ID",
    async run(key) {
      for (const actor of apiActors()) {
        const missing = await call(actor, "DELETE", `/api/drafts/${MISSING_DRAFT}`);
        for (const target of [A.plan.draftId, A.bobDraft.draftId]) {
          const res = await call(actor, "DELETE", `/api/drafts/${target}`);
          assertDenied(`${key} ${target} as ${actor.name}`, res, { missing });
        }
      }
    }
  },

  // serve.ts
  "GET /d/:id{[a-z0-9]{12}}": {
    kind: "resource",
    why: "draft ID",
    run: (key) => sweepArtifactUrls(key, artifactUrls().byId)
  },
  "GET /d/:id{[a-z0-9]{12}}/*": {
    kind: "resource",
    why: "draft ID + version/page",
    run: (key) => sweepArtifactUrls(key, artifactUrls().byIdBelow)
  },
  "GET /w/:handle/:slug": {
    kind: "resource",
    why: "workspace handle + slug",
    run: (key) => sweepArtifactUrls(key, artifactUrls().bySlug)
  },
  "GET /w/:handle/:slug/*": {
    kind: "resource",
    why: "workspace handle + slug + version/page",
    run: (key) => sweepArtifactUrls(key, artifactUrls().bySlugBelow)
  },

  // web.ts
  "GET /": {
    kind: "list",
    why: "the caller's workspace feed",
    async run(key) {
      for (const actor of webActors()) {
        const res = await actor.browser.get("/");
        assert.equal(res.status, 200, actor.name);
        assertClean(`${key} as ${actor.name}`, res.text_);
      }
    }
  },
  "GET /mine": {
    kind: "list",
    why: "the caller's own artifacts",
    async run(key) {
      for (const actor of webActors()) {
        const res = await actor.browser.get("/mine");
        assert.equal(res.status, 200, actor.name);
        assertClean(`${key} as ${actor.name}`, res.text_);
      }
    }
  },
  "GET /mine/:draftId": {
    kind: "resource",
    why: "draft ID (version history)",
    async run(key) {
      for (const actor of webActors()) {
        const m = await actor.browser.get(`/mine/${MISSING_DRAFT}`);
        const missing = { status: m.status, text: m.text_ };
        for (const target of [A.plan.draftId, A.bobDraft.draftId]) {
          const r = await actor.browser.get(`/mine/${target}`);
          assertDenied(`${key} ${target} as ${actor.name}`, { status: r.status, text: r.text_ }, { status: 404, missing });
        }
      }
    }
  },
  "GET /workspaces": {
    kind: "list",
    why: "the caller's workspaces",
    async run(key) {
      for (const actor of webActors()) {
        const res = await actor.browser.get(`/workspaces?next=${encodeURIComponent(`/d/${MISSING_DRAFT}`)}`);
        assert.equal(res.status, 200, actor.name);
        assertClean(`${key} as ${actor.name}`, res.text_);
      }
    }
  },
  "POST /workspaces": {
    kind: "create",
    why: "creates a new workspace for the caller; A untouched",
    async run(key) {
      const scratch = new Browser(stack);
      await scratch.signIn("olivia@other.test", { workspace: "Other" });
      const res = await scratch.post("/workspaces", { name: "Olivia Web", id: A.org.id }, { rewrite: loginHint("olivia@other.test") });
      assertClean(key, res.text_);
      const home = await scratch.get("/");
      assert.match(home.text_, /<h1>Olivia Web<\/h1>/);
      assertClean(`${key} home`, home.text_);
    }
  },
  "POST /workspaces/switch": {
    kind: "resource",
    why: "takes an organization ID: switching into A must fail for a non-member",
    async run(key) {
      for (const actor of webActors()) {
        const res = await actor.browser.post("/workspaces/switch", { id: A.org.id }, { rewrite: loginHint(actor.email) });
        assertLanding(`${key} as ${actor.name}`, res);
        const home = await actor.browser.get("/");
        assertClean(`${key} home after, as ${actor.name}`, home.text_);
        const artifact = await actor.browser.get(app(`/d/${A.plan.draftId}`));
        assertDenied(`${key} artifact after, as ${actor.name}`, { status: artifact.status, text: artifact.text_ }, { status: 404 });
      }
      // Put the sessions back in their own workspaces for the routes after this one.
      await B.oliviaBrowser.signIn("olivia@other.test", { workspace: "Other" });
      await B.noraBrowser.signIn("nora@new.test", { workspace: "Nora Labs" });
    }
  },
  "GET /join/:code": {
    kind: "resource",
    why: "invite code. (A live code is a deliberate bearer secret that admits its holder: not swept.)",
    async run(key) {
      for (const actor of webActors()) {
        const m = await actor.browser.get(`/join/${MISSING_CODE}`);
        const r = await actor.browser.get(`/join/${A.usedCode}`);
        assertDenied(`${key} used-up A code as ${actor.name}`, { status: r.status, text: r.text_ }, {
          status: 404,
          missing: { status: m.status, text: m.text_ }
        });
      }
    }
  },
  "POST /join": {
    kind: "resource",
    why: "invite code",
    async run(key) {
      for (const actor of webActors()) {
        const r = await actor.browser.post("/join", { code: A.usedCode, next: `/d/${A.plan.draftId}` });
        const m = await actor.browser.post("/join", { code: MISSING_CODE, next: `/d/${A.plan.draftId}` });
        assertDenied(`${key} used-up A code as ${actor.name}`, { status: r.status, text: r.text_ }, {
          status: 404,
          missing: { status: m.status, text: m.text_ }
        });
      }
    }
  },
  "GET /auth/sign-in": {
    kind: "resource",
    why: "takes ?org=: signing an outsider in with A's organization must not grant A",
    async run(key) {
      // Olivia, signed in to Other, signs in again forcing A's organization.
      const browser = new Browser(stack);
      await browser.signIn("olivia@other.test", { workspace: "Other" });
      const landed = await browser.signIn("olivia@other.test", { workspace: "Acme", next: `/d/${A.plan.draftId}` });
      assertLanding(`${key} org=A next=A's artifact`, landed);
      const hint = { rewrite: loginHint("olivia@other.test") };
      assertClean(`${key} home`, (await browser.get("/", hint)).text_);
      const artifact = await browser.get(app(`/d/${A.plan.draftId}`), hint);
      assertDenied(`${key} artifact`, { status: artifact.status, text: artifact.text_ }, { status: 404 });
    }
  },
  "GET /auth/callback": {
    kind: "resource",
    why: "code + state from WorkOS; every sign-in in setup goes through it; here a forged callback naming A",
    async run(key) {
      const r = await B.oliviaBrowser.get(`/auth/callback?code=forged&state=${A.org.id}`);
      assertDenied(key, { status: r.status, text: r.text_ }, { status: 400 });
      // Forging dropped olivia's auth-state cookie only; her session still works.
      assert.equal((await B.oliviaBrowser.get("/")).status, 200);
    }
  },
  "POST /auth/sign-out": {
    kind: "self",
    why: "no identifiers; clears only the caller's own cookie",
    async run(key) {
      const scratch = new Browser(stack);
      await scratch.signIn("olivia@other.test", { workspace: "Other" });
      const res = await scratch.post("/auth/sign-out", {});
      assertClean(key, res.text_);
      const bobRead = await A.bobBrowser.get(A.plan.publicUrl);
      assert.equal(bobRead.status, 200, "A's member is still signed in");
    }
  },

  // sandbox.ts (the sandbox origin's app)
  "GET /t/:token": {
    kind: "resource",
    why: "sandbox capability (artifact root without the slash)",
    async run(key) {
      await sweepCapabilities(key, false);
    }
  },
  "GET /t/:token/*": {
    kind: "resource",
    why: "sandbox capability + page path",
    async run(key) {
      await sweepCapabilities(key, true);
    }
  }
};

// A capability for one A artifact must open nothing else, and outsiders
// cannot get one for A at all.
async function sweepCapabilities(key, below) {
  exercised.add(key);
  const path = (token, rest = "") => onSandbox(`/t/${token}${below ? `/${rest}` : ""}`);
  const get = async (url) => {
    const response = await fetch(url, { redirect: "manual" });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };
  const missing = await get(path("nothing.here"));

  // Positive control: bob's capabilities for A's two artifacts work.
  const planSrc = frameSrc((await A.bobBrowser.get(A.plan.publicUrl)).text_);
  const bobSrc = frameSrc((await A.bobBrowser.get(A.bobDraft.publicUrl)).text_);
  assert.ok(planSrc && bobSrc, "bob gets wrappers for A's artifacts");
  const planToken = tokenOf(planSrc);
  const bobToken = tokenOf(bobSrc);
  const planClaims = claimsOf(planToken);
  const bobClaims = claimsOf(bobToken);
  assert.equal((await get(path(planToken))).status, below ? 200 : 302);
  if (below) assert.match((await get(path(planToken, "details.html"))).text, new RegExp(`${MARKER}-v3-details`));

  const [planPayload, planSig] = planToken.split(".");
  const [bobPayload, bobSig] = bobToken.split(".");
  const b64 = (claims) => Buffer.from(JSON.stringify(claims)).toString("base64url");
  const forged = {
    "plan's signature on a payload naming bob's artifact": `${b64({ ...planClaims, d: bobClaims.d, v: bobClaims.v })}.${planSig}`,
    "plan's payload with bob-artifact's signature": `${planPayload}.${bobSig}`,
    "bob-artifact's payload with plan's signature": `${bobPayload}.${planSig}`,
    "valid signature, plan's draft with bob-artifact's version": signCapability({ ...planClaims, v: bobClaims.v }),
    "valid signature, bob-artifact's draft with plan's version": signCapability({ ...bobClaims, v: planClaims.v }),
    "valid signature, A's draft claimed for Other's organization": signCapability({ ...planClaims, o: B.otherOrg.id }),
    "valid signature, outsider viewer (olivia)": signCapability({ ...planClaims, u: B.oliviaId, s: null }),
    "valid signature, outsider viewer (nora)": signCapability({ ...planClaims, u: B.noraId, s: null }),
    "valid signature, olivia's own artifact pointed at A's version": signCapability({
      ...claimsOf(B.ownToken),
      v: planClaims.v
    }),
    "olivia's own capability, A's draft swapped in": `${b64({ ...claimsOf(B.ownToken), d: planClaims.d, v: planClaims.v, o: planClaims.o })}.${B.ownToken.split(".")[1]}`
  };
  for (const [name, token] of Object.entries(forged)) {
    for (const rest of below ? ["", "details.html", "v/1/", "raw"] : [""]) {
      const res = await get(path(token, rest));
      assertDenied(`${key} ${name} /${rest}`, res, { status: 404, missing });
    }
  }

  // An outsider's own capability opens only their artifact, never A's pages.
  for (const rest of below ? ["details.html", "v/1/", "v/3/details.html", `../${A.plan.draftId}`] : [""]) {
    const res = await get(path(B.ownToken, rest));
    if (below) assertDenied(`${key} olivia's own token /${rest}`, res, { status: 404 });
    else assertClean(`${key} olivia's own token`, res.text);
  }

  // Outsiders' browsers are never handed a capability for A.
  for (const actor of webActors()) {
    for (const url of [A.plan.publicUrl, `${A.plan.publicUrl}/details.html`, A.bobDraft.publicUrl]) {
      const r = await actor.browser.get(url);
      assertDenied(`${key} mint via ${url} as ${actor.name}`, { status: r.status, text: r.text_ }, { status: 404 });
      assert.equal(frameSrc(r.text_), null);
    }
  }

  // Capability paths exist only on the sandbox origin; A's URLs do not exist there.
  assert.equal((await get(app(new URL(planSrc).pathname))).status, 404);
  assert.equal((await get(onSandbox(`/d/${A.plan.draftId}`))).status, 404);
}

// ---- setup -----------------------------------------------------------------

before(async () => {
  stack = await startStack({ sandbox: true });
  A.org = await findOrganization(stack.emulator, "Acme");
  A.alice = await findUser(stack.emulator, "alice@acme.test");
  A.bob = await findUser(stack.emulator, "bob@acme.test");
  A.sam = await findUser(stack.emulator, "sam@new.test");
  A.aliceToken = await accessToken(stack, "alice@acme.test", "Acme");
  A.bobToken = await accessToken(stack, "bob@acme.test", "Acme");

  // A's artifacts: alice's in three versions (one page, then two pages), bob's in one.
  const upload = async (token, body, status) => {
    const r = await callApi(stack, token, "POST", "/api/uploads", body);
    assert.equal(r.status, status, JSON.stringify(r.body));
    return r.body;
  };
  const v1 = await upload(A.aliceToken, { html: page(TITLE_A, `<p>${MARKER}-v1</p>`), slug: SLUG_A }, 201);
  const pages = (n) => ({
    files: [
      { path: "index.html", html: page(TITLE_A, `<p>${MARKER}-v${n}</p><a href="details.html">details</a>`) },
      { path: "details.html", html: page(`${TITLE_A} details`, `<p>${MARKER}-v${n}-details</p>`) }
    ],
    slug: SLUG_A
  });
  const v2 = await upload(A.aliceToken, pages(2), 200);
  const v3 = await upload(A.aliceToken, pages(3), 200);
  assert.equal(v3.versionNumber, 3);
  A.plan = v3;
  A.bobDraft = await upload(A.bobToken, { html: page(TITLE_BOB, `<p>${MARKER}-bob</p>`), slug: SLUG_BOB }, 201);
  A.workspace = v3.workspace;
  A.handle = v3.workspace.handle;

  // A used-up invite of A's: sam joins with it.
  const invite = await callApi(stack, A.aliceToken, "POST", "/api/workspaces/invites", { maxUses: 1 });
  assert.equal(invite.status, 201);
  A.usedCode = invite.body.code;
  const sam = await signInTokens(stack, "sam@new.test");
  assert.equal((await callApi(stack, sam.accessToken, "POST", "/api/workspaces/join", { code: A.usedCode })).status, 200);
  A.onlyMemberIds = [A.alice.id, A.bob.id, A.sam.id];
  // A live invite of A's: only A's admins may see or revoke it.
  A.liveCode = (await callApi(stack, A.aliceToken, "POST", "/api/workspaces/invites", {})).body.code;

  A.bobBrowser = new Browser(stack);
  await A.bobBrowser.signIn("bob@acme.test", { workspace: "Acme" });

  // Outsiders. Other: olivia (member) and its CI key. Nora Labs: nora (admin), created through the API.
  B.otherOrg = await findOrganization(stack.emulator, "Other");
  B.oliviaId = (await findUser(stack.emulator, "olivia@other.test")).id;
  B.noraId = (await findUser(stack.emulator, "nora@new.test")).id;
  B.oliviaTokens = await signInTokens(stack, "olivia@other.test");
  B.olivia = B.oliviaTokens.accessToken;
  const nora = await signInTokens(stack, "nora@new.test");
  const created = await call({ token: nora.accessToken }, "POST", "/api/workspaces", { name: "Nora Labs" });
  B.noraCreated = created;
  B.noraOrg = created.json.workspace;
  B.noraHandle = created.json.workspace.handle;
  B.noraTokens = await refreshInto(stack, nora, B.noraOrg.id);
  B.nora = B.noraTokens.accessToken;

  B.oliviaBrowser = new Browser(stack);
  await B.oliviaBrowser.signIn("olivia@other.test", { workspace: "Other" });
  B.noraBrowser = new Browser(stack);
  await B.noraBrowser.signIn("nora@new.test", { workspace: "Nora Labs" });

  // Olivia's own artifact, and her own capability for it.
  const own = await upload(B.olivia, { html: page("Other plan", "<p>other</p>") }, 201);
  B.ownToken = tokenOf(frameSrc((await B.oliviaBrowser.get(own.publicUrl)).text_));

  SECRETS = [
    MARKER,
    TITLE_A,
    TITLE_BOB,
    A.org.id,
    A.handle,
    A.workspace.name,
    A.plan.draftId,
    A.bobDraft.draftId,
    v1.versionId,
    v2.versionId,
    v3.versionId,
    A.bobDraft.versionId,
    A.alice.id,
    A.bob.id,
    A.sam.id,
    "alice@acme.test",
    "bob@acme.test",
    "sam@new.test",
    A.usedCode,
    A.liveCode
  ];
  for (const s of SECRETS) assert.ok(typeof s === "string" && s.length >= 4, `secret ${s}`);

  snapshot = await stateOfA();
});

after(async () => {
  await stack?.stop();
});

// What A looks like to its own admin: artifacts, versions, members.
async function stateOfA() {
  const drafts = await callApi(stack, A.aliceToken, "GET", "/api/drafts?scope=workspace");
  const members = await callApi(stack, A.aliceToken, "GET", "/api/workspaces/members");
  assert.equal(drafts.status, 200);
  assert.equal(members.status, 200);
  return {
    drafts: drafts.body.drafts
      .map((d) => ({ id: d.draftId, slug: d.slug, title: d.title, latest: d.latestVersionNumber, count: d.versionCount }))
      .sort((x, y) => x.id.localeCompare(y.id)),
    members: members.body.members.map((m) => `${m.id}:${m.role}`).sort()
  };
}

// ---- the sweep -------------------------------------------------------------

test("every registered route has an entry in the isolation table", async () => {
  const routes = await registeredRoutes();
  assert.ok(routes.size >= 30, `found only ${routes.size} routes: the enumeration is broken`);
  const unknown = [...routes].filter((r) => !(r in ROUTES));
  assert.deepEqual(unknown, [], `routes with no isolation case: add them to ROUTES in test/isolation.test.js`);
  const stale = Object.keys(ROUTES).filter((r) => !routes.has(r));
  assert.deepEqual(stale, [], "ROUTES names routes that no longer exist");
  for (const [route, entry] of Object.entries(ROUTES)) {
    assert.ok(entry.why, `${route} needs a reason`);
    assert.ok(typeof entry.run === "function", `${route} has no sweep`);
  }
});

for (const [route, entry] of Object.entries(ROUTES)) {
  test(`${route} [${entry.kind}]: ${entry.why}`, async () => {
    await entry.run(route);
    exercised.add(route);
  });
}

test("A is untouched after the sweep", async () => {
  assert.deepEqual(await stateOfA(), snapshot);
  const latest = await fetch(A.plan.publicUrl, { headers: { Authorization: `Bearer ${A.aliceToken}` } });
  assert.equal(latest.status, 200);
  assert.match(await latest.text(), new RegExp(`${MARKER}-v3`));
  const first = await fetch(`${stack.baseUrl}/d/${A.plan.draftId}/v/1`, { headers: { Authorization: `Bearer ${A.bobToken}` } });
  assert.equal(first.status, 200);
  assert.match(await first.text(), new RegExp(`${MARKER}-v1`));
  const bobs = await fetch(A.bobDraft.publicUrl, { headers: { Authorization: `Bearer ${A.bobToken}` } });
  assert.match(await bobs.text(), new RegExp(`${MARKER}-bob`));
  assert.equal((await A.bobBrowser.get(A.plan.publicUrl)).status, 200);
  const me = await callApi(stack, A.aliceToken, "GET", "/api/me");
  assert.equal(me.body.workspace.id, A.org.id);
  assert.equal(me.body.workspace.role, "admin");
});

test("every route in the table was actually exercised", () => {
  assert.deepEqual(
    Object.keys(ROUTES).filter((r) => !exercised.has(r)),
    []
  );
});
