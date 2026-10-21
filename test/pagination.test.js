import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { WorkOS } from "@workos-inc/node";
import {
  Browser,
  CI_KEY,
  COOKIE_PASSWORD,
  PASSWORD,
  accessToken,
  breakWorkos,
  callApi,
  findOrganization,
  findUser,
  page,
  refreshInto,
  signInTokens,
  startStack,
  workosApi
} from "./helpers.js";

// Lists that outgrow one page: the artifact feeds (API, CLI, web) and a user's
// workspaces (WorkOS pages memberships by 100). Plus the web fixes that came
// with them: history links across workspaces, sign-in retry, deleted workspaces.
const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;
const SEEDED = 105;
let stack;

before(async () => {
  stack = await startStack();
  // Uploads are limited per caller per minute, so several callers share the seeding.
  // "Seeded 0" is the oldest: the rest land in the same seconds (ties in updated_at).
  assert.equal((await callApi(stack, CI_KEY, "POST", "/api/uploads", { html: page("Seeded 0"), slug: "seeded-0" })).status, 201);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const callers = [CI_KEY, ...(await Promise.all(["alice@acme.test", "bob@acme.test", "max@both.test"].map((e) => accessToken(stack, e, "Acme"))))];
  await Promise.all(
    callers.map(async (token, c) => {
      for (let i = c + 1; i < SEEDED; i += callers.length) {
        const res = await callApi(stack, token, "POST", "/api/uploads", { html: page(`Seeded ${i}`), slug: `seeded-${i}` });
        assert.equal(res.status, 201, JSON.stringify(res.body));
      }
    })
  );
});

after(() => stack?.stop());

test("the workspace feed pages by cursor: every artifact once, newest first", async () => {
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const query = new URLSearchParams({ scope: "workspace", limit: "40", ...(cursor ? { cursor } : {}) });
    const res = await callApi(stack, alice, "GET", `/api/drafts?${query}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.drafts.length <= 40);
    seen.push(...res.body.drafts);
    cursor = res.body.nextCursor;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(seen.length, SEEDED);
  assert.equal(new Set(seen.map((d) => d.draftId)).size, SEEDED, "no artifact twice");
  const order = seen.map((d) => Date.parse(d.updatedAt));
  assert.deepEqual(order, [...order].sort((a, b) => b - a));

  // Without a limit: 100, and a cursor to the rest.
  const first = await callApi(stack, alice, "GET", "/api/drafts?scope=workspace");
  assert.equal(first.body.drafts.length, 100);
  assert.ok(first.body.nextCursor);
  const bad = await callApi(stack, alice, "GET", "/api/drafts?scope=workspace&cursor=nonsense");
  assert.equal(bad.status, 200, "a malformed cursor reads as the first page");
});

test("a slug is found however far down the feed it is", async () => {
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  const res = await callApi(stack, alice, "GET", "/api/drafts?scope=workspace&slug=seeded-0");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.drafts.map((d) => d.title), ["Seeded 0"]);
  // Other workspaces' slugs are not visible.
  const olivia = await accessToken(stack, "olivia@other.test", "Other");
  assert.deepEqual((await callApi(stack, olivia, "GET", "/api/drafts?scope=workspace&slug=seeded-0")).body.drafts, []);
});

test("the CLI lists past the first page and reads the oldest artifact by its custom URL", async () => {
  const env = {
    ...process.env,
    HTMLARTIFACT_HOME: path.join(stack.tmp, "pagination-home"),
    HTMLARTIFACT_TOKEN: CI_KEY,
    HTMLARTIFACT_API_URL: stack.baseUrl,
    CI: "",
    GITHUB_ACTIONS: ""
  };
  const cli = (args) => run(process.execPath, [CLI, ...args], { env, timeout: 60_000 });
  const { drafts } = JSON.parse((await cli(["list", "--all", "--json"])).stdout);
  assert.equal(drafts.length, SEEDED);
  const oldest = drafts.at(-1);
  assert.equal(oldest.title, "Seeded 0");
  const read = await cli(["read", oldest.publicUrl]);
  assert.match(read.stdout, /File: /);
});

test("the web feed links to older artifacts", async () => {
  const browser = new Browser(stack);
  const feed = await browser.signIn("alice@acme.test", { workspace: "Acme" });
  assert.equal(feed.status, 200);
  const older = feed.text_.match(/href="(\/\?cursor=[^"]+)"[^>]*>Older artifacts/);
  assert.ok(older, "the first page links to the next");
  assert.doesNotMatch(feed.text_, />Seeded 0</);
  const rest = await browser.get(older[1].replaceAll("&amp;", "&"));
  assert.equal(rest.status, 200);
  assert.match(rest.text_, />Seeded 0</);
  assert.doesNotMatch(rest.text_, />Older artifacts</);
});

test("a history link opens in its artifact's workspace for members, and is a 404 for others", async () => {
  const olivia = await accessToken(stack, "olivia@other.test", "Other");
  const uploaded = await callApi(stack, olivia, "POST", "/api/uploads", { html: page("Other plan") });
  assert.equal(uploaded.status, 201);
  const link = `/history/${uploaded.body.draftId}`;

  // Max is in both, signed in to Acme: the link switches him to Other.
  const max = new Browser(stack);
  const opened = await max.signIn("max@both.test", { workspace: "Acme", next: link });
  assert.equal(opened.status, 200);
  assert.match(opened.text_, /Other plan/);
  assert.match((await max.get("/")).text_, /Other plan/, "the session moved to Other");

  // The same with an expired access token: the refresh that renews it still
  // lands in the artifact's workspace.
  const tokens = await signInTokens(stack, "max@both.test", "Acme");
  const [header, payload] = tokens.accessToken.split(".");
  const sealed = await new WorkOS("sk_test_default").userManagement.sealSessionDataFromAuthenticationResponse({
    authenticationResponse: { accessToken: `${header}.${payload}.stale`, refreshToken: tokens.refreshToken, user: { id: payload && JSON.parse(Buffer.from(payload, "base64url")).sub } },
    cookiePassword: COOKIE_PASSWORD
  });
  const expired = new Browser(stack);
  expired.cookies.set(new URL(stack.baseUrl).host, { htmlartifact_session: encodeURIComponent(sealed) });
  const renewed = await expired.get(link);
  assert.equal(renewed.status, 200);
  assert.match(renewed.text_, /Other plan/);

  const bob = new Browser(stack);
  assert.equal((await bob.signIn("bob@acme.test", { workspace: "Acme", next: link })).status, 404);
  const anon = await new Browser(stack).get(link);
  assert.equal(anon.status, 401);
  assert.match(anon.text_, /Sign in/);
});

test("a failed sign-in's retry keeps the page (or invite) the user was going to", async () => {
  const browser = new Browser(stack);
  const emulatorOrigin = new URL(stack.emulator.url).origin;
  const next = "/join/HA-ABCD-EFGH-JKLM";
  const denied = await browser.get(`/auth/sign-in?next=${encodeURIComponent(next)}`, {
    rewrite: (url) => {
      const u = new URL(url);
      if (u.origin !== emulatorOrigin) return url;
      return `${stack.baseUrl}/auth/callback?error=access_denied&state=${u.searchParams.get("state")}`;
    }
  });
  assert.equal(denied.status, 403);
  assert.match(denied.text_, new RegExp(`href="/auth/sign-in\\?next=${encodeURIComponent(next)}"`));
});

test("a deleted workspace leaves the web workspace list while WorkOS still has it", async () => {
  const max = await signInTokens(stack, "max@both.test", "Acme");
  const created = await callApi(stack, max.accessToken, "POST", "/api/workspaces", { name: "Web Lagging" });
  assert.equal(created.status, 201);
  const lagging = await refreshInto(stack, max, created.body.workspace.id);
  const restore = await breakWorkos(stack.emulator, "DELETE", `/organizations/${created.body.workspace.id}`);
  try {
    const deleted = await callApi(stack, lagging.accessToken, "DELETE", "/api/workspaces/current", { confirm: "Web Lagging" });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    const user = await findUser(stack.emulator, "max@both.test");
    const memberships = await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?user_id=${user.id}`);
    assert.ok(memberships.data.some((m) => m.organization_id === created.body.workspace.id), "WorkOS still lists it");
    const browser = new Browser(stack);
    await browser.signIn("max@both.test", { workspace: "Acme" });
    const list = await browser.get("/workspaces");
    assert.equal(list.status, 200);
    assert.match(list.text_, />Acme</);
    assert.doesNotMatch(list.text_, /Web Lagging/);
    // Not listed under its WorkOS ID either (its name is gone from D1).
    assert.ok(!list.text_.includes(created.body.workspace.id));
  } finally {
    await restore();
  }
});

test("users in over 100 workspaces see them all", async () => {
  const user = await workosApi(stack.emulator, "POST", "/user_management/users", { email: "many@orgs.test", first_name: "Many", password: PASSWORD, email_verified: true });
  const acme = await findOrganization(stack.emulator, "Acme");
  const ids = [];
  for (let i = 0; i < 104; i += 1) {
    const org = i ? await workosApi(stack.emulator, "POST", "/organizations", { name: `Org ${i}` }) : acme;
    ids.push(org.id);
    await workosApi(stack.emulator, "POST", "/user_management/organization_memberships", { organization_id: org.id, user_id: user.id, role_slug: "member" });
  }
  const token = await accessToken(stack, "many@orgs.test", "Acme");
  const listed = await callApi(stack, token, "GET", "/api/workspaces");
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.workspaces.length, 104);
  assert.deepEqual(listed.body.workspaces.map((w) => w.id).sort(), ids.sort());
  assert.equal(listed.body.workspaces.filter((w) => w.current).length, 1);
});
