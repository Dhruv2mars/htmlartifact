import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  Browser,
  CI_KEY,
  OTHER_CI_KEY,
  accessToken,
  findOrganization,
  findUser,
  page,
  sendWebhook,
  startStack,
  workosApi
} from "./helpers.js";

let stack;
let acmeArtifact; // { draftId, publicUrl } published by alice in Acme

before(async () => {
  stack = await startStack();
  const alice = await accessToken(stack, "alice@acme.test");
  const result = await upload(alice, { html: page("Acme plan"), slug: "acme-plan" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  acmeArtifact = result.body;
});

after(async () => {
  await stack?.stop();
});

async function upload(token, body) {
  const response = await fetch(`${stack.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function read(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: "manual"
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

describe("publishing", () => {
  test("anonymous uploads are refused", async () => {
    const result = await upload(null, { html: page("anon") });
    assert.equal(result.status, 401);
  });

  test("a forged or garbage bearer token is refused", async () => {
    assert.equal((await upload("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig", { html: page("x") })).status, 401);
    assert.equal((await upload("not-a-key", { html: page("x") })).status, 401);
  });

  test("the receipt names the team, and slug URLs are team-scoped", () => {
    assert.equal(acmeArtifact.organization.name, "Acme");
    assert.match(acmeArtifact.publicUrl, /\/t\/org_[^/]+\/acme-plan$/);
  });

  test("a CI organization API key publishes into its own team", async () => {
    const result = await upload(CI_KEY, { html: page("CI report") });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.organization.name, "Acme");
    assert.equal(result.body.account.name, "Acme CI (API key)");
  });

  test("custom URLs are per team: another team's slug is invisible and untouched", async () => {
    const olivia = await accessToken(stack, "olivia@other.test");
    const check = await fetch(`${stack.baseUrl}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${olivia}` },
      body: JSON.stringify({ slug: "acme-plan" })
    });
    assert.equal((await check.json()).slug.status, "available", "no cross-team slug oracle");

    const result = await upload(olivia, { html: page("Other plan"), slug: "acme-plan" });
    assert.equal(result.status, 201);
    assert.notEqual(result.body.publicUrl, acmeArtifact.publicUrl);
    assert.match((await read(acmeArtifact.publicUrl, await accessToken(stack, "bob@acme.test"))).text, /Acme plan/);
    assert.equal((await read(result.body.publicUrl, olivia)).status, 200);
  });

  test("a token issued to another WorkOS application is refused", async () => {
    const foreign = await accessToken(stack, "alice@acme.test", null, { clientId: "client_unrelated_app" });
    assert.equal((await upload(foreign, { html: page("x") })).status, 401);
    assert.equal((await read(acmeArtifact.publicUrl, foreign)).status, 401);
  });

  test("a required publish permission blocks members without it", async () => {
    stack.config.publishPermission = "artifacts:publish";
    try {
      const bob = await accessToken(stack, "bob@acme.test");
      const result = await upload(bob, { html: page("bob") });
      assert.equal(result.status, 403);
      assert.match(result.body.error, /artifacts:publish/);
    } finally {
      stack.config.publishPermission = null;
    }
  });
});

describe("reading", () => {
  test("signed-out curl gets 401, never the HTML", async () => {
    const result = await read(acmeArtifact.publicUrl);
    assert.equal(result.status, 401);
    assert.doesNotMatch(result.text, /Acme plan/);
  });

  test("signed-out browsers are sent to sign-in and come back", async () => {
    const response = await fetch(acmeArtifact.publicUrl, { headers: { Accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/auth/sign-in");
    assert.equal(location.searchParams.get("next"), acmeArtifact.publicUrl);
  });

  test("every member of the team can read, by token and in the browser", async () => {
    const bob = await accessToken(stack, "bob@acme.test");
    const byToken = await read(acmeArtifact.publicUrl, bob);
    assert.equal(byToken.status, 200);
    assert.match(byToken.text, /Acme plan/);
    assert.match(byToken.headers.get("content-security-policy"), /default-src 'none'/);

    const browser = new Browser(stack);
    const landed = await browser.signIn("bob@acme.test", { next: acmeArtifact.publicUrl });
    assert.equal(landed.status, 200);
    assert.match(landed.text_, /Acme plan/);
  });

  test("the team CI key can read team artifacts", async () => {
    assert.equal((await read(acmeArtifact.publicUrl, CI_KEY)).status, 200);
  });

  test("members of another team get 404, by token, key, and browser", async () => {
    const olivia = await accessToken(stack, "olivia@other.test");
    assert.equal((await read(acmeArtifact.publicUrl, olivia)).status, 404);
    assert.equal((await read(acmeArtifact.publicUrl, OTHER_CI_KEY)).status, 404);
    assert.equal((await read(`${acmeArtifact.publicUrl}/raw`, olivia)).status, 404);
    assert.equal((await read(`${stack.baseUrl}/d/${acmeArtifact.draftId}/v/1`, olivia)).status, 404);

    const browser = new Browser(stack);
    await browser.signIn("olivia@other.test");
    const response = await browser.get(acmeArtifact.publicUrl);
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.text_, /Acme plan/);
  });

  test("a 404 for another team looks exactly like a missing artifact", async () => {
    const olivia = await accessToken(stack, "olivia@other.test");
    const denied = await read(acmeArtifact.publicUrl, olivia);
    const missing = await read(`${stack.baseUrl}/d/nonexistent99`, olivia);
    assert.equal(denied.status, missing.status);
    assert.equal(denied.text, missing.text);
  });

  test("a member of both teams is switched into the artifact's team", async () => {
    const browser = new Browser(stack);
    await browser.signIn("max@both.test", { organizationName: "Other" });
    const workspace = await browser.get("/workspace");
    assert.match(workspace.text_, /<h1>Other<\/h1>/);

    const response = await browser.get(acmeArtifact.publicUrl);
    assert.equal(response.status, 200);
    assert.match(response.text_, /Acme plan/);
    assert.match((await browser.get("/workspace")).text_, /<h1>Acme<\/h1>/);
  });

  test("workspace feeds are per team", async () => {
    const bob = await accessToken(stack, "bob@acme.test");
    const olivia = await accessToken(stack, "olivia@other.test");
    const list = async (token) =>
      (await (await fetch(`${stack.baseUrl}/api/drafts?scope=workspace`, { headers: { Authorization: `Bearer ${token}` } })).json()).drafts;
    assert.ok((await list(bob)).some((d) => d.draftId === acmeArtifact.draftId));
    assert.ok(!(await list(olivia)).some((d) => d.draftId === acmeArtifact.draftId));
  });
});

describe("revocation", () => {
  test("removing a member in WorkOS revokes their still-valid token at once", async () => {
    const token = await accessToken(stack, "bob@acme.test");
    assert.equal((await read(acmeArtifact.publicUrl, token)).status, 200);

    const acme = await findOrganization(stack.emulator, "Acme");
    const bob = await findUser(stack.emulator, "bob@acme.test");
    const { data } = await workosApi(
      stack.emulator,
      "GET",
      `/user_management/organization_memberships?user_id=${bob.id}&organization_id=${acme.id}`
    );
    await workosApi(stack.emulator, "DELETE", `/user_management/organization_memberships/${data[0].id}`);

    let status;
    for (let i = 0; i < 50; i += 1) {
      status = (await read(acmeArtifact.publicUrl, token)).status;
      if (status !== 200) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(status, 401);
    const revoked = await stack.pool.query("SELECT 1 FROM revocations WHERE subject = $1", [bob.id]);
    assert.equal(revoked.rowCount, 1, "revoked by the signed WorkOS webhook");
  });

  test("a stale, out-of-order removal event cannot lock out an active member", async () => {
    const other = await findOrganization(stack.emulator, "Other");
    const olivia = await findUser(stack.emulator, "olivia@other.test");
    const response = await sendWebhook(stack, {
      id: "event_stale",
      event: "organization_membership.deleted",
      created_at: new Date(0).toISOString(),
      data: { object: "organization_membership", user_id: olivia.id, organization_id: other.id, status: "inactive" }
    });
    assert.equal(response.status, 200);
    const token = await accessToken(stack, "olivia@other.test");
    const me = await fetch(`${stack.baseUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
  });

  test("if WorkOS is unreachable during a webhook, the cached membership is dropped", async () => {
    const token = await accessToken(stack, "olivia@other.test");
    const me = () => fetch(`${stack.baseUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await me()).status, 200); // membership now cached
    const other = await findOrganization(stack.emulator, "Other");
    const olivia = await findUser(stack.emulator, "olivia@other.test");

    const { workos } = await import("../src/workos.js");
    const original = workos().userManagement.listOrganizationMemberships;
    workos().userManagement.listOrganizationMemberships = async () => {
      throw new Error("WorkOS unreachable");
    };
    try {
      const response = await sendWebhook(stack, {
        id: "event_unreachable",
        event: "organization_membership.deleted",
        data: { object: "organization_membership", user_id: olivia.id, organization_id: other.id }
      });
      assert.equal(response.status, 500, "WorkOS retries the delivery");
      const cached = await stack.pool.query(
        "SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2",
        [olivia.id, other.id]
      );
      assert.equal(cached.rowCount, 0);
      assert.notEqual((await me()).status, 200, "no stale access while WorkOS is down");
    } finally {
      workos().userManagement.listOrganizationMemberships = original;
    }
    assert.equal((await me()).status, 200, "recovers once WorkOS answers");
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
  test("open redirects through sign-in are refused", async () => {
    const response = await fetch(`${stack.baseUrl}/auth/sign-in?next=${encodeURIComponent("https://evil.example/")}`, {
      redirect: "manual"
    });
    const stateCookie = response.headers.getSetCookie().find((c) => c.startsWith("htmlartifact_auth_state="));
    const payload = JSON.parse(
      Buffer.from(decodeURIComponent(stateCookie.split(";")[0].split("=")[1]).split(".")[0], "base64url").toString()
    );
    assert.equal(payload.next, "/workspace");
  });

  test("someone without a team lands on onboarding and can create one", async () => {
    const browser = new Browser(stack);
    const landed = await browser.signIn("nora@none.test");
    assert.match(landed.url, /\/onboarding$/);
    assert.match(landed.text_, /Create a team/);

    const created = await browser.post("/teams", { name: "Nora Labs" });
    assert.match(created.url, /\/team$/);
    assert.match(created.text_, /Nora Labs/);
    assert.match(created.text_, /You are an admin/);
    assert.match(created.text_, /Invite a teammate/);
  });

  test("team admins mint working CI keys; members cannot", async () => {
    const browser = new Browser(stack);
    await browser.signIn("nora@none.test");
    const created = await browser.post("/team/api-keys", { name: "GitHub Actions" });
    const value = created.text_.match(/<code>(sk_[^<]+)<\/code>/)?.[1];
    assert.ok(value, "key value shown once");
    const result = await upload(value, { html: page("from nora ci") });
    assert.equal(result.status, 201);
    assert.equal(result.body.organization.name, "Nora Labs");

    const member = new Browser(stack);
    await member.signIn("alice@acme.test");
    const denied = await member.post("/team/api-keys", { name: "nope" });
    assert.equal(denied.status, 403);
  });

  test("form posts from another origin are refused (CSRF)", async () => {
    const browser = new Browser(stack);
    await browser.signIn("nora@none.test");
    for (const origin of ["https://evil.example", "http://sibling.127.0.0.1"]) {
      const response = await browser.post(
        "/team/invitations",
        { email: "attacker@evil.example", role: "admin" },
        { headers: { Origin: origin } }
      );
      assert.equal(response.status, 403, origin);
    }
    const noOrigin = await browser.request("/team/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=attacker%40evil.example"
    });
    assert.equal(noOrigin.status, 403);
  });

  test("signed-out dashboard pages ask for sign-in", async () => {
    for (const path of ["/workspace", "/dashboard", "/team", "/cli/auth"]) {
      const response = await fetch(`${stack.baseUrl}${path}`, { redirect: "manual" });
      assert.equal(response.status, 401, path);
    }
  });

  test("the installer only touches htmlartifact paths", async () => {
    const script = await (await fetch(`${stack.baseUrl}/install.sh`)).text();
    assert.match(script, /htmlartifact-design/);
    assert.doesNotMatch(script, /postplan/i);
  });
});
