import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";
import {
  Browser,
  CI_KEY,
  COOKIE_PASSWORD,
  accessToken,
  callApi,
  findOrganization,
  findUser,
  page,
  sendWebhook,
  startStack,
  workosApi
} from "./helpers.js";

// The sandbox origin: browsers get a wrapper page on the app origin that
// frames the artifact from a cross-site origin, through a short-lived
// capability URL. Here the app is http://127.0.0.1:<port> and the sandbox
// http://localhost:<port>, the same Worker routed by host.
const MARKER = "SECRET-ARTIFACT-BODY-7f3a";
const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;

let stack;
let single; // receipt: a scripted single-page artifact
let multi; // receipt: a two-page artifact
let bob; // a signed-in browser, member of Acme

before(async () => {
  stack = await startStack({ sandbox: true });
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  const one = await callApi(stack, alice, "POST", "/api/uploads", {
    html: page("Sandboxed plan", `<p>${MARKER}</p><script>document.title = "ran";</script>`)
  });
  assert.equal(one.status, 201, JSON.stringify(one.body));
  single = one.body;
  const two = await callApi(stack, alice, "POST", "/api/uploads", {
    files: [
      { path: "index.html", html: page("Index", '<a href="details.html">details</a>') },
      { path: "details.html", html: page("Details", `<p>${MARKER}-details</p>`) }
    ]
  });
  assert.equal(two.status, 201, JSON.stringify(two.body));
  multi = two.body;
  bob = new Browser(stack);
  await bob.signIn("bob@acme.test", { workspace: "Acme" });
});

after(async () => {
  await stack?.stop();
});

const appUrl = (pathname) => new URL(pathname, stack.baseUrl).toString();
const onSandbox = (pathname) => new URL(pathname, stack.sandboxUrl).toString();

async function get(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: "manual" });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

// Opens an artifact URL in bob's browser; returns the wrapper and its frame URL.
async function frameOf(url, browser = bob) {
  const wrapper = await browser.get(url);
  assert.equal(wrapper.status, 200, wrapper.text_);
  const match = wrapper.text_.match(/<iframe[^>]*\ssrc="([^"]+)"/);
  assert.ok(match, "wrapper has an iframe");
  return { wrapper, src: match[1].replaceAll("&amp;", "&") };
}

function signCapability(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", `htmlartifact:sandbox-capability:v1:${COOKIE_PASSWORD}`)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function claimsOf(src) {
  const token = new URL(src).pathname.split("/")[2];
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

async function notFoundBody() {
  return (await get(onSandbox("/t/nothing.here/"))).text;
}

describe("app origin", () => {
  test("a member's browser gets a wrapper framing the sandbox, never the artifact HTML", async () => {
    const { wrapper, src } = await frameOf(single.publicUrl);
    assert.ok(src.startsWith(`${stack.sandboxUrl}/t/`), src);
    assert.doesNotMatch(wrapper.text_, new RegExp(MARKER));
    assert.doesNotMatch(wrapper.text_, /<script/);
    assert.match(wrapper.text_, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
    assert.match(wrapper.text_, /<title>Sandboxed plan · htmlartifact<\/title>/);
    const csp = wrapper.headers.get("content-security-policy");
    assert.match(csp, new RegExp(`frame-src ${stack.sandboxUrl}(;|$)`));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /default-src 'none'/);
    assert.equal(wrapper.headers.get("cache-control"), "private, no-store");

    const claims = claimsOf(src);
    const org = await findOrganization(stack.emulator, "Acme");
    const user = await findUser(stack.emulator, "bob@acme.test");
    assert.equal(claims.d, single.draftId);
    assert.equal(claims.o, org.id);
    assert.equal(claims.u, user.id);
  });

  test("CLI and API-key reads still get the raw HTML from the app origin", async () => {
    const token = await accessToken(stack, "bob@acme.test", "Acme");
    const raw = await get(single.publicUrl, { Authorization: `Bearer ${token}` });
    assert.equal(raw.status, 200);
    assert.match(raw.text, new RegExp(MARKER));
    assert.match(raw.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const byKey = await get(single.publicUrl, { Authorization: `Bearer ${CI_KEY}` });
    assert.equal(byKey.status, 200);
    assert.match(byKey.text, new RegExp(MARKER));

    const home = path.join(stack.tmp, "cli-home");
    const read = await run(process.execPath, [CLI, "read", single.publicUrl], {
      env: { ...process.env, HTMLARTIFACT_HOME: home, HTMLARTIFACT_TOKEN: token, HTMLARTIFACT_API_URL: stack.baseUrl },
      timeout: 60_000
    });
    assert.match(fs.readFileSync(read.stdout.match(/File: (.+)/)[1], "utf8"), new RegExp(MARKER));
  });

  test("a capability URL on the app origin is a 404", async () => {
    const { src } = await frameOf(single.publicUrl);
    const onApp = appUrl(new URL(src).pathname);
    assert.equal((await get(onApp)).status, 404);
    assert.equal((await bob.get(onApp)).status, 404);
  });

  test("signed-out browsers still go to sign-in", async () => {
    const response = await get(single.publicUrl, { Accept: "text/html" });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location"), stack.baseUrl).pathname, "/auth/sign-in");
  });
});

describe("sandbox origin", () => {
  test("the capability URL serves the HTML, sandboxed, frameable only by the app", async () => {
    const { src } = await frameOf(single.publicUrl);
    const served = await get(src);
    assert.equal(served.status, 200);
    assert.match(served.text, new RegExp(MARKER));
    const csp = served.headers.get("content-security-policy");
    assert.match(csp, /(^|; )sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox(;|$)/);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /script-src 'unsafe-inline'/);
    assert.match(csp, new RegExp(`frame-ancestors ${stack.baseUrl}(;|$)`));
    assert.equal(served.headers.get("referrer-policy"), "no-referrer");
    assert.equal(served.headers.get("cache-control"), "private, no-store");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.equal(served.headers.get("cross-origin-resource-policy"), null);
    assert.equal(served.headers.getSetCookie().length, 0);
  });

  test("script-free pages keep script-src 'none' and are sandboxed too", async () => {
    const { src } = await frameOf(multi.publicUrl);
    const csp = (await get(src)).headers.get("content-security-policy");
    assert.match(csp, /script-src 'none'/);
    assert.match(csp, /sandbox allow-scripts/);
  });

  test("multi-page artifacts: relative links resolve below the capability root", async () => {
    const root = await frameOf(multi.publicUrl);
    assert.match(root.wrapper.finalUrl, /\/$/, "the app redirects to the slash URL first");
    assert.match(root.src, /\/t\/[^/]+\/$/);
    const index = await get(root.src);
    assert.match(index.text, /<h1>Index<\/h1>/);
    const details = await get(new URL("details.html", root.src).toString());
    assert.equal(details.status, 200);
    assert.match(details.text, new RegExp(`${MARKER}-details`));

    const deep = await frameOf(`${multi.publicUrl}/details`);
    assert.match(deep.src, /\/t\/[^/]+\/details$/);
    assert.match((await get(deep.src)).text, /<h1>Details<\/h1>/);
    assert.equal((await get(new URL("missing.html", root.src).toString())).status, 404);
    const bare = await get(root.src.slice(0, -1));
    assert.equal(bare.status, 302);
    assert.equal(new URL(bare.headers.get("location"), root.src).toString(), root.src);
  });

  test("tampered and forged-for-another-workspace tokens are the same 404; a genuine expired one asks for a reload", async () => {
    const { src } = await frameOf(single.publicUrl);
    const url = new URL(src);
    const [, , token] = url.pathname.split("/");
    const [payload, signature] = token.split(".");
    const claims = claimsOf(src);
    const other = await findOrganization(stack.emulator, "Other");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    const now = Math.floor(Date.now() / 1000);
    const bodies = new Set([await notFoundBody()]);

    // Sanity: a correctly signed token works, so the failures below are real.
    assert.equal((await get(onSandbox(`/t/${signCapability(claims)}/`))).status, 200);

    for (const bad of [
      `${payload}.${flipped}`,
      `${Buffer.from(JSON.stringify({ ...claims, d: multi.draftId })).toString("base64url")}.${signature}`,
      `${payload}.${signature}.extra`,
      payload,
      signCapability({ ...claims, o: other.id }),
      signCapability({ ...claims, v: "not-a-version" })
    ]) {
      const response = await get(onSandbox(`/t/${bad}/`));
      assert.equal(response.status, 404, bad);
      assert.doesNotMatch(response.text, new RegExp(MARKER));
      bodies.add(response.text);
    }
    assert.equal(bodies.size, 1, "every failure looks the same");

    const expired = await get(onSandbox(`/t/${signCapability({ ...claims, exp: now - 1 })}/`));
    assert.equal(expired.status, 410);
    assert.match(expired.text, /Reload the page/);
    assert.doesNotMatch(expired.text, new RegExp(MARKER));
  });

  test("the sandbox serves nothing but capability URLs", async () => {
    const appCookie = bob.cookieHeader(stack.baseUrl);
    assert.ok(appCookie.includes("htmlartifact_session="));
    const notFound = await notFoundBody();
    for (const pathname of [
      "/",
      "/api/me",
      "/api/drafts",
      "/auth/sign-in",
      "/auth/callback",
      "/mine",
      "/workspaces",
      `/d/${single.draftId}`,
      new URL(single.publicUrl).pathname
    ]) {
      for (const headers of [{}, { Cookie: appCookie, Accept: "text/html" }]) {
        const response = await get(onSandbox(pathname), headers);
        assert.equal(response.status, 404, pathname);
        assert.equal(response.text, notFound, pathname);
        assert.equal(response.headers.getSetCookie().length, 0, pathname);
      }
    }
    const webhook = await fetch(onSandbox("/webhooks/workos"), { method: "POST", body: "{}" });
    assert.equal(webhook.status, 404);
    const upload = await fetch(onSandbox("/api/uploads"), { method: "POST", body: "{}" });
    assert.equal(upload.status, 404);
    assert.equal((await get(onSandbox("/healthz"))).status, 200);
    assert.equal((await get(onSandbox("/favicon.svg"))).status, 200);
  });
});

describe("capabilities stop working when access ends", () => {
  test("a soft-deleted artifact", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const doomed = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Doomed", `<p>${MARKER}</p>`) });
    assert.equal(doomed.status, 201);
    const { src } = await frameOf(doomed.body.publicUrl);
    assert.equal((await get(src)).status, 200);
    const deleted = await callApi(stack, alice, "DELETE", `/api/drafts/${doomed.body.draftId}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    const after = await get(src);
    assert.equal(after.status, 404);
    assert.equal(after.text, await notFoundBody());
  });

  test("a revoked session", async () => {
    const tab = new Browser(stack);
    await tab.signIn("bob@acme.test", { workspace: "Acme" });
    const { src } = await frameOf(single.publicUrl, tab);
    const { s } = claimsOf(src);
    assert.ok(s, "capability names the session");
    assert.equal((await get(src)).status, 200);
    const revoked = await sendWebhook(stack, { id: "event_revoke", event: "session.revoked", data: { id: s } });
    assert.equal(revoked.status, 200);
    assert.equal((await get(src)).status, 404);
    // Bob's other session is unaffected.
    const { src: other } = await frameOf(single.publicUrl);
    assert.equal((await get(other)).status, 200);
  });

  test("a member removed from the workspace", async () => {
    const { src } = await frameOf(single.publicUrl);
    assert.equal((await get(src)).status, 200);
    const org = await findOrganization(stack.emulator, "Acme");
    const user = await findUser(stack.emulator, "bob@acme.test");
    const { data } = await workosApi(
      stack.emulator,
      "GET",
      `/user_management/organization_memberships?user_id=${user.id}&organization_id=${org.id}`
    );
    await workosApi(stack.emulator, "DELETE", `/user_management/organization_memberships/${data[0].id}`);
    let status;
    for (let i = 0; i < 50; i += 1) {
      status = (await get(src)).status;
      if (status !== 200) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status, 404);
    // And the app no longer mints new ones for them.
    assert.equal((await bob.get(single.publicUrl)).status, 404);
  });
});
