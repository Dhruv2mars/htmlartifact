import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { getPlatformProxy } from "wrangler";
import { accessToken, callApi, findUser, page, retryLocked, startStack, testConfigPath, workosApi } from "./helpers.js";

// Admin changes racing each other, and the D1 writes they may spend.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A POST whose body arrives only when finish() is called: its auth checks run
// now, its handler later.
function pendingPost(stack, token, route) {
  const req = http.request(new URL(route, stack.baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  });
  const result = new Promise((resolve, reject) => {
    req.on("error", reject);
    req.on("response", (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
  });
  req.flushHeaders();
  req.write("{");
  return { finish: (tail) => (req.end(tail), result) };
}

async function makeAdmin(stack, adminToken, email, token) {
  const user = await findUser(stack.emulator, email);
  assert.equal((await callApi(stack, adminToken, "PATCH", `/api/workspaces/members/${user.id}`, { role: "admin" })).status, 200);
  await wait(300);
  assert.equal((await callApi(stack, token, "GET", "/api/me")).body.workspace.role, "admin");
  return user;
}

describe("an admin removed while their invite request is in flight", () => {
  let stack;
  before(async () => {
    stack = await startStack();
  });
  after(() => stack?.stop());

  test("gets no working invite code", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const nora = await accessToken(stack, "nora@new.test");
    const aliceUser = await findUser(stack.emulator, "alice@acme.test");
    await makeAdmin(stack, alice, "bob@acme.test", bob);
    const secret = await callApi(stack, alice, "POST", "/api/uploads", { html: page("PRIVATE ACME PAYLOAD") });
    assert.equal(secret.status, 201);

    const invite = pendingPost(stack, alice, "/api/workspaces/invites");
    await wait(800);
    assert.equal((await callApi(stack, bob, "DELETE", `/api/workspaces/members/${aliceUser.id}`)).status, 200);
    await wait(1300);
    const late = await invite.finish('"maxUses":5}');
    assert.equal(late.status, 403, JSON.stringify(late.body));

    const { invites } = (await callApi(stack, bob, "GET", "/api/workspaces/invites?all=1")).body;
    assert.ok(invites.every((i) => i.status !== "live"), JSON.stringify(invites));
    const read = await fetch(secret.body.publicUrl, { headers: { Authorization: `Bearer ${nora}` } });
    assert.equal(read.status, 404);
  });
});

describe("D1 write budget on admin routes", () => {
  let stack;
  let proxy;
  before(async () => {
    stack = await startStack({ vars: { HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY: "40" } });
    proxy = await getPlatformProxy({ configPath: testConfigPath(), persist: { path: path.join(stack.tmp, "state", "v3") } });
  });
  after(async () => {
    await proxy?.dispose();
    await stack?.stop();
  });

  test("refusing to remove a non-member takes no lock and writes nothing", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const org = (await callApi(stack, alice, "GET", "/api/me")).body.workspace.id;
    // Someone else holds the workspace's admin lock: a request that took it
    // would wait for it and answer 409.
    await retryLocked(() =>
      proxy.env.DB.prepare("INSERT INTO admin_locks (organization_id, holder, expires_at) VALUES (?, 'other', unixepoch() + 60)").bind(org).run()
    );
    const started = Date.now();
    const missing = await callApi(stack, alice, "DELETE", "/api/workspaces/members/user_doesnotexist");
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    assert.ok(Date.now() - started < 4000, "answered without waiting for the lock");
    await retryLocked(() => proxy.env.DB.prepare("DELETE FROM admin_locks WHERE organization_id = ?").bind(org).run());
  });

  test("grants stop at the workspace's budget; removals keep working", async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const bobUser = await findUser(stack.emulator, "bob@acme.test");
    assert.equal((await callApi(stack, bob, "GET", "/api/me")).status, 200);
    const invite = await callApi(stack, alice, "POST", "/api/workspaces/invites", {});
    assert.equal(invite.status, 201, JSON.stringify(invite.body));
    const statuses = [];
    for (let n = 0; n < 8; n += 1) statuses.push((await callApi(stack, alice, "POST", "/api/workspaces/invites", {})).status);
    assert.ok(statuses.includes(201), statuses.join());
    const spent = await callApi(stack, alice, "POST", "/api/workspaces/invites", {});
    assert.equal(spent.status, 429);
    assert.equal(spent.body.code, "daily_budget");
    assert.ok(Number(spent.headers.get("retry-after")) > 0);
    // Joining is charged to the code's workspace too.
    const nora = await accessToken(stack, "nora@new.test");
    const join = await callApi(stack, nora, "POST", "/api/workspaces/join", { code: invite.body.code });
    assert.equal(join.status, 429, JSON.stringify(join.body));
    assert.equal((await callApi(stack, alice, "DELETE", `/api/workspaces/members/${bobUser.id}`)).status, 200);
  });
});

describe("an admin change whose WorkOS call stalls past the lock's lease", () => {
  let stack;
  let server;
  let release = () => undefined;
  const state = { target: "", stallPath: null, entered: null };
  before(async () => {
    // Relays WorkOS calls to the emulator, holding one DELETE until release().
    server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (req.method === "DELETE" && req.url === state.stallPath) {
        state.stallPath = null;
        await new Promise((resolve) => {
          release = resolve;
          state.entered();
        });
      }
      const headers = { ...req.headers };
      delete headers.host;
      const upstream = await fetch(`${state.target}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined });
      const kept = [...upstream.headers].filter(([k]) => !["content-encoding", "content-length", "transfer-encoding"].includes(k));
      res.writeHead(upstream.status, Object.fromEntries(kept));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    stack = await startStack({ vars: { WORKOS_API_URL: `http://127.0.0.1:${server.address().port}` } });
    state.target = stack.emulator.url;
  });
  after(async () => {
    release();
    await stack?.stop();
    await new Promise((resolve) => server?.close(resolve));
  });

  test("keeps the lock, so the workspace keeps an admin", { timeout: 90_000 }, async () => {
    const alice = await accessToken(stack, "alice@acme.test", "Acme");
    const bob = await accessToken(stack, "bob@acme.test", "Acme");
    const aliceUser = await findUser(stack.emulator, "alice@acme.test");
    await makeAdmin(stack, alice, "bob@acme.test", bob);
    const org = (await callApi(stack, alice, "GET", "/api/me")).body.workspace.id;
    const active = async () =>
      (await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?organization_id=${org}&statuses=active`)).data;
    state.stallPath = `/user_management/organization_memberships/${(await active()).find((m) => m.user_id === aliceUser.id).id}`;
    const entered = new Promise((resolve) => (state.entered = resolve));

    const aliceLeaving = callApi(stack, alice, "POST", "/api/workspaces/leave");
    await entered;
    await wait(31_000); // past ADMIN_LOCK_SECONDS
    const bobLeaving = await callApi(stack, bob, "POST", "/api/workspaces/leave");
    assert.equal(bobLeaving.status, 409, JSON.stringify(bobLeaving.body));
    release();
    assert.equal((await aliceLeaving).status, 200);
    const admins = (await active()).filter((m) => m.role?.slug === "admin");
    assert.equal(admins.length, 1);
  });
});
