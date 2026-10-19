import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  Browser,
  CI_KEY,
  OTHER_CI_KEY,
  STORAGE,
  accessToken,
  breakWorkos,
  callApi,
  findOrganization,
  findUser,
  page,
  refreshInto,
  sendWebhook,
  signInTokens,
  startStack,
  workosApi
} from "./helpers.js";

let stack;
let acme; // the artifact alice published in Acme: upload receipt

before(async () => {
  stack = await startStack();
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  const result = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Acme plan"), slug: "acme-plan" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  acme = result.body;
});

after(async () => {
  await stack?.stop();
});

const upload = (token, body) => callApi(stack, token, "POST", "/api/uploads", body);

async function read(url, token) {
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual" });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

describe("workspaces, driven entirely through the API (as an agent would)", () => {
  let nora;
  let workspace;

  test("a brand-new account has no workspace and cannot publish yet", async () => {
    nora = await signInTokens(stack, "nora@new.test");
    const me = await callApi(stack, nora.accessToken, "GET", "/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.workspace, null);
    const attempt = await upload(nora.accessToken, { html: page("too early") });
    assert.equal(attempt.status, 403);
    assert.match(attempt.body.error, /workspace create/);
  });

  test("they create a workspace, become its admin, and can publish", async () => {
    const created = await callApi(stack, nora.accessToken, "POST", "/api/workspaces", { name: "Nora Labs" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    workspace = created.body.workspace;
    assert.equal(workspace.role, "admin");
    assert.match(workspace.handle, /^nora-labs-[a-z0-9]{4}$/);

    nora = await refreshInto(stack, nora, workspace.id);
    const me = await callApi(stack, nora.accessToken, "GET", "/api/me");
    assert.equal(me.body.workspace.name, "Nora Labs");
    assert.equal(me.body.workspace.role, "admin");

    const published = await upload(nora.accessToken, { html: page("Nora plan") });
    assert.equal(published.status, 201);
    assert.equal(published.body.workspace.name, "Nora Labs");
  });

  test("the admin creates an invite; a new account joins with the code", async () => {
    const invite = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", {});
    assert.equal(invite.status, 201);
    const { code } = invite.body;
    assert.match(code, /^HA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    let sam = await signInTokens(stack, "sam@new.test");
    const joined = await callApi(stack, sam.accessToken, "POST", "/api/workspaces/join", {
      code: code.toLowerCase().replaceAll("-", " ")
    });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.workspace.name, "Nora Labs");

    sam = await refreshInto(stack, sam, workspace.id);
    const feed = await callApi(stack, sam.accessToken, "GET", "/api/drafts?scope=workspace");
    const noraPlan = feed.body.drafts.find((d) => d.title === "Nora plan");
    assert.ok(noraPlan);
    const opened = await read(noraPlan.publicUrl, sam.accessToken);
    assert.equal(opened.status, 200);
    assert.match(opened.text, /Nora plan/);

    const members = await callApi(stack, nora.accessToken, "GET", "/api/workspaces/members");
    assert.deepEqual(members.body.members.map((m) => m.email).sort(), ["nora@new.test", "sam@new.test"]);
  });

  test("bad, unknown, or used-up codes are refused", async () => {
    const olivia = await accessToken(stack, "olivia@other.test");
    for (const bad of ["nope", "HA-AAAA-AAAA-AAAA", ""]) {
      const result = await callApi(stack, olivia, "POST", "/api/workspaces/join", { code: bad });
      assert.equal(result.status, 404, bad);
    }
    const single = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", { maxUses: 1 });
    const max = await accessToken(stack, "max@both.test", "Acme");
    assert.equal((await callApi(stack, max, "POST", "/api/workspaces/join", { code: single.body.code })).status, 200);
    assert.equal((await callApi(stack, olivia, "POST", "/api/workspaces/join", { code: single.body.code })).status, 404);
  });

  test("concurrent joins can never exceed an invite's use limit", async () => {
    const single = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", { maxUses: 1 });
    const joiners = await Promise.all(
      ["alice@acme.test", "bob@acme.test", "olivia@other.test"].map((email) => accessToken(stack, email, "Acme").catch(() => accessToken(stack, email, "Other")))
    );
    const results = await Promise.all(
      joiners.map((token) => callApi(stack, token, "POST", "/api/workspaces/join", { code: single.body.code }))
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
    const members = await callApi(stack, nora.accessToken, "GET", "/api/workspaces/members");
    const outsiders = ["alice@acme.test", "bob@acme.test", "olivia@other.test"];
    const winners = members.body.members.filter((m) => outsiders.includes(m.email));
    assert.equal(winners.length, 1);
    // Later tests rely on these people's original memberships only.
    const removed = await callApi(stack, nora.accessToken, "DELETE", `/api/workspaces/members/${winners[0].id}`);
    assert.equal(removed.status, 200);
  });

  test("only admins can invite", async () => {
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    assert.equal((await callApi(stack, bob, "POST", "/api/workspaces/invites", {})).status, 403);
  });

  test("an admin removes a member; their still-valid token stops working at once", async () => {
    let sam = await signInTokens(stack, "sam@new.test", "Nora Labs");
    sam = await refreshInto(stack, sam, workspace.id);
    assert.equal((await callApi(stack, sam.accessToken, "GET", "/api/drafts?scope=workspace")).status, 200);

    const members = await callApi(stack, nora.accessToken, "GET", "/api/workspaces/members");
    const samId = members.body.members.find((m) => m.email === "sam@new.test").id;
    assert.equal((await callApi(stack, nora.accessToken, "DELETE", `/api/workspaces/members/${samId}`)).status, 200);
    assert.equal((await callApi(stack, sam.accessToken, "GET", "/api/drafts?scope=workspace")).status, 403);
  });

  test("a non-member who opens a link, signs in and joins lands back on that link", async () => {
    const invite = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", {});
    const feed = await callApi(stack, nora.accessToken, "GET", "/api/drafts?scope=workspace");
    const link = new URL(feed.body.drafts.find((d) => d.title === "Nora plan").publicUrl).pathname;
    const browser = new Browser(stack);
    const landed = await browser.signIn("bob@acme.test", { next: link });
    assert.equal(landed.status, 404, "bob is in Acme, not Nora Labs");
    const fresh = new Browser(stack);
    const page1 = await fresh.signIn("sam@new.test", { next: link });
    assert.match(page1.finalUrl, /\/workspaces\?next=/);
    assert.match(page1.text_, /ask whoever shared it for an invite code/i);
    const joined = await fresh.post("/join", { code: invite.body.code, next: link });
    assert.equal(new URL(joined.finalUrl).pathname, link);
    assert.match(joined.text_, /Nora plan/);
  });

  test("a join link works in the browser too", async () => {
    const invite = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", {});
    const browser = new Browser(stack);
    const landing = await browser.signIn("olivia@other.test", { next: `/join/${invite.body.code}` });
    assert.match(landing.text_, /Join Nora Labs/);
    const joined = await browser.post("/join", { code: invite.body.code });
    assert.equal(joined.status, 200);
    assert.match(joined.text_, /<h1[^>]*>Nora Labs<\/h1>/);
    assert.match(joined.text_, /Nora plan/);
  });
});

describe("publishing", () => {
  test("anonymous and garbage credentials are refused", async () => {
    assert.equal((await upload(null, { html: page("anon") })).status, 401);
    assert.equal((await upload("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig", { html: page("x") })).status, 401);
    assert.equal((await upload("not-a-key", { html: page("x") })).status, 401);
  });

  test("a token issued to another WorkOS application is refused", async () => {
    const foreign = await accessToken(stack, "alice@acme.test", "Acme", { clientId: "client_unrelated_app" });
    assert.equal((await upload(foreign, { html: page("x") })).status, 401);
    assert.equal((await read(acme.publicUrl, foreign)).status, 401);
  });

  test("the receipt names the workspace; custom URLs live under it", () => {
    assert.equal(acme.workspace.name, "Acme");
    assert.match(acme.publicUrl, /\/w\/acme-[a-z0-9]{4}\/acme-plan$/);
    assert.match(acme.versionUrl, /\/d\/[a-z0-9]{12}\/v\/1$/);
  });

  test("identical content is a no-op; new content is a new version at the same URL", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const same = await upload(alice, { html: page("Acme plan"), slug: "acme-plan" });
    assert.equal(same.body.unchanged, true);
    assert.equal(same.body.versionNumber, 1);
    const next = await upload(alice, { html: page("Acme plan v2"), slug: "acme-plan" });
    assert.equal(next.body.versionNumber, 2);
    assert.equal(next.body.draftId, acme.draftId);
    assert.match((await read(`${acme.publicUrl}/v/1`, alice)).text, /Acme plan</);
    assert.match((await read(acme.publicUrl, alice)).text, /Acme plan v2/);
  });

  test("concurrent uploads never roll the artifact back to an older version", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const first = await upload(alice, { html: page("Race v0"), slug: "race" });
    const results = await Promise.all([
      upload(alice, { html: page("Race v0"), slug: "race" }), // a blind retry of the current content
      ...[1, 2, 3, 4, 5].map((n) => upload(alice, { html: page(`Race v${n}`), slug: "race" }))
    ]);
    for (const r of results) assert.ok([200, 201, 409].includes(r.status), JSON.stringify(r.body));
    const won = results.filter((r) => r.status < 300 && !r.body.unchanged);
    const newest = won.reduce((a, b) => (b.body.versionNumber > a.body.versionNumber ? b : a), first);
    const served = await read(first.body.publicUrl, alice);
    assert.equal(served.headers.get("x-htmlartifact-draft-version"), String(newest.body.versionNumber));
    assert.ok(served.text.includes(newest.body.title), newest.body.title);
  });

  test("a CI organization API key publishes into its own workspace", async () => {
    const result = await upload(CI_KEY, { html: page("CI report") });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.workspace.name, "Acme");
    assert.equal(result.body.account.name, "Acme CI (API key)");
  });

  test("custom URLs are per workspace: no cross-workspace oracle or collision", async () => {
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    const check = await callApi(stack, olivia, "POST", "/api/check", { slug: "acme-plan" });
    assert.equal(check.body.slug.status, "available");
    const result = await upload(olivia, { html: page("Other plan"), slug: "acme-plan" });
    assert.equal(result.status, 201);
    assert.notEqual(result.body.publicUrl, acme.publicUrl);
    assert.equal((await read(result.body.publicUrl, olivia)).status, 200);
  });

  test("multi-page uploads serve each page", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const result = await upload(alice, {
      files: [
        { path: "index.html", html: page("Index", '<a href="details.html">details</a>') },
        { path: "details.html", html: page("Details") }
      ]
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.match((await read(`${result.body.publicUrl}/details`, alice)).text, /Details/);
  });

  test("invalid HTML is rejected with line-level issues", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const result = await upload(alice, {
      html: `<!doctype html><title>x</title><script src="https://x.test/a.js"></script>`
    });
    assert.equal(result.status, 422);
    assert.ok(result.body.issues.length > 0);
  });
});

describe("reading", () => {
  test("signed-out curl gets 401, never the HTML", async () => {
    const result = await read(acme.publicUrl);
    assert.equal(result.status, 401);
    assert.doesNotMatch(result.text, /Acme plan/);
  });

  test("signed-out browsers are sent to sign-in and come back", async () => {
    const response = await fetch(acme.publicUrl, { headers: { Accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"), stack.baseUrl);
    assert.equal(location.pathname, "/auth/sign-in");
    assert.equal(location.searchParams.get("next"), new URL(acme.publicUrl).pathname);
  });

  test("members read by token and in the browser, under a strict CSP", async () => {
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const byToken = await read(acme.publicUrl, bob);
    assert.equal(byToken.status, 200);
    assert.match(byToken.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(byToken.headers.get("cache-control"), /private, no-store/);

    const browser = new Browser(stack);
    const landed = await browser.signIn("bob@acme.test", { next: new URL(acme.publicUrl).pathname });
    assert.equal(landed.status, 200);
    assert.match(landed.text_, /Acme plan/);
  });

  test("the workspace CI key can read workspace artifacts", async () => {
    assert.equal((await read(acme.publicUrl, CI_KEY)).status, 200);
  });

  test("other workspaces get 404 by token, key, browser, raw and version URLs", async () => {
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    for (const url of [acme.publicUrl, `${acme.publicUrl}/raw`, acme.versionUrl, `${stack.baseUrl}/d/${acme.draftId}`]) {
      assert.equal((await read(url, olivia)).status, 404, url);
      assert.equal((await read(url, OTHER_CI_KEY)).status, 404, url);
    }
    const browser = new Browser(stack);
    await browser.signIn("olivia@other.test", { workspace: "Other" });
    const response = await browser.get(acme.publicUrl);
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.text_, /Acme plan/);
  });

  test("a 404 for another workspace looks exactly like a missing artifact", async () => {
    const olivia = await accessToken(stack, "olivia@other.test", "Other");
    const denied = await read(`${stack.baseUrl}/d/${acme.draftId}`, olivia);
    const missing = await read(`${stack.baseUrl}/d/zzzzzzzzzzzz`, olivia);
    assert.equal(denied.status, missing.status);
    assert.equal(denied.text, missing.text);
  });

  test("a member of both workspaces is switched into the artifact's workspace", async () => {
    const browser = new Browser(stack);
    await browser.signIn("max@both.test", { workspace: "Other" });
    assert.match((await browser.get("/")).text_, /<h1[^>]*>Other<\/h1>/);
    const response = await browser.get(acme.publicUrl);
    assert.equal(response.status, 200);
    assert.match(response.text_, /Acme plan/);
    assert.match((await browser.get("/")).text_, /<h1[^>]*>Acme<\/h1>/);
  });
});

describe("revocation", () => {
  test("removing a member in WorkOS revokes their still-valid token (webhook)", async () => {
    const token = await accessToken(stack, "bob@acme.test", "Acme");
    assert.equal((await read(acme.publicUrl, token)).status, 200);
    const org = await findOrganization(stack.emulator, "Acme");
    const bob = await findUser(stack.emulator, "bob@acme.test");
    const { data } = await workosApi(
      stack.emulator,
      "GET",
      `/user_management/organization_memberships?user_id=${bob.id}&organization_id=${org.id}`
    );
    await workosApi(stack.emulator, "DELETE", `/user_management/organization_memberships/${data[0].id}`);
    let status;
    for (let i = 0; i < 50; i += 1) {
      status = (await read(acme.publicUrl, token)).status;
      if (status !== 200) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status, 404);
  });

  test("a stale, out-of-order removal event cannot lock out an active member", async () => {
    const org = await findOrganization(stack.emulator, "Other");
    const olivia = await findUser(stack.emulator, "olivia@other.test");
    const response = await sendWebhook(stack, {
      id: "event_stale",
      event: "organization_membership.deleted",
      created_at: new Date(0).toISOString(),
      data: { object: "organization_membership", user_id: olivia.id, organization_id: org.id, status: "inactive" }
    });
    assert.equal(response.status, 200);
    const token = await accessToken(stack, "olivia@other.test", "Other");
    const me = await callApi(stack, token, "GET", "/api/me");
    assert.equal(me.body.workspace?.name, "Other");
  });

  test("if WorkOS is unreachable during a webhook, cached access is dropped, not kept", async () => {
    const token = await accessToken(stack, "olivia@other.test", "Other");
    assert.equal((await callApi(stack, token, "GET", "/api/drafts")).status, 200); // membership cached
    const org = await findOrganization(stack.emulator, "Other");
    const olivia = await findUser(stack.emulator, "olivia@other.test");
    const restore = await breakWorkos(stack.emulator, "GET", "/user_management/organization_memberships");
    try {
      const response = await sendWebhook(stack, {
        id: "event_unreachable",
        event: "organization_membership.deleted",
        data: { object: "organization_membership", user_id: olivia.id, organization_id: org.id }
      });
      assert.equal(response.status, 500, "WorkOS retries the delivery");
      assert.notEqual((await callApi(stack, token, "GET", "/api/drafts")).status, 200, "no stale access");
    } finally {
      await restore();
    }
    assert.equal((await callApi(stack, token, "GET", "/api/drafts")).status, 200, "recovers once WorkOS answers");
  });

  test("unsigned or forged webhooks are rejected", async () => {
    const forged = await fetch(`${stack.baseUrl}/webhooks/workos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "WorkOS-Signature": "t=1, v1=deadbeef" },
      body: JSON.stringify({ id: "event_x", event: "user.deleted", data: { id: "user_x" } })
    });
    assert.equal(forged.status, 400);
  });
});

describe("web app", () => {
  test("/healthz checks D1 and artifact storage", async () => {
    const response = await fetch(`${stack.baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, checks: { d1: true, storage: true }, storage: STORAGE });
  });

  test("open redirects through sign-in are refused", async () => {
    const response = await fetch(`${stack.baseUrl}/auth/sign-in?next=${encodeURIComponent("https://evil.example/")}`, {
      redirect: "manual"
    });
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith("htmlartifact_auth_state="));
    const payload = JSON.parse(
      Buffer.from(decodeURIComponent(cookie.split(";")[0].split("=")[1]).split(".")[0], "base64url").toString()
    );
    assert.equal(payload.next, "/");

    for (const trick of ["/\t/evil.example", "/\\evil.example", "//evil.example", "/%0a/evil.example", "https://evil.example"]) {
      const r = await fetch(`${stack.baseUrl}/auth/sign-in?next=${encodeURIComponent(trick)}`, { redirect: "manual" });
      const c = r.headers.getSetCookie().find((x) => x.startsWith("htmlartifact_auth_state="));
      const p = JSON.parse(Buffer.from(decodeURIComponent(c.split(";")[0].split("=")[1]).split(".")[0], "base64url").toString());
      assert.ok(p.next === "/" || (p.next.startsWith("/") && !p.next.startsWith("//") && !/evil/.test(new URL(p.next, "https://x.test").host)), `${JSON.stringify(trick)} → ${p.next}`);
    }
  });

  test("form posts from another origin are refused (CSRF)", async () => {
    const browser = new Browser(stack);
    await browser.signIn("alice@acme.test");
    for (const origin of ["https://evil.example", "http://sibling.127.0.0.1"]) {
      const response = await browser.post("/workspaces", { name: "Evil" }, { headers: { Origin: origin } });
      assert.equal(response.status, 403, origin);
    }
    const noOrigin = await browser.request("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "name=Evil"
    });
    assert.equal(noOrigin.status, 403);
  });

  test("signed-out pages ask for sign-in; the home page is the landing page", async () => {
    for (const path of ["/mine", "/workspaces"]) {
      const response = await fetch(`${stack.baseUrl}${path}`, { redirect: "manual" });
      assert.equal(response.status, 401, path);
      assert.match(await response.text(), /Sign in to htmlartifact/, path);
    }
    const home = await fetch(`${stack.baseUrl}/`, { redirect: "manual" });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Members only\./);
  });

  test("unknown pages get the web app's 404", async () => {
    const response = await fetch(`${stack.baseUrl}/no-such-page`, { redirect: "manual" });
    assert.equal(response.status, 404);
    assert.match(await response.text(), /Not found/);
  });
});

describe("Enterprise connections", () => {
  test("SSO and Directory Sync links are off unless enabled (WorkOS bills each connection); domain verification is not", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    for (const [intent, label] of [["sso", "SSO"], ["dsync", "Directory Sync"]]) {
      const result = await callApi(stack, alice, "POST", "/api/workspaces/portal", { intent });
      assert.equal(result.status, 409, intent);
      assert.match(result.body.error, new RegExp(`${label} isn't available on this deployment yet`));
    }
    assert.equal((await callApi(stack, alice, "POST", "/api/workspaces/portal", { intent: "domain_verification" })).status, 200);
  });
});
