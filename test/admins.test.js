import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { callApi, findUser, page, refreshInto, signInTokens, startStack, workosApi } from "./helpers.js";

// A workspace always keeps an admin, even when two admins act at the same
// moment; what an admin created as an admin ends with the role; and member
// lists cover workspaces larger than one WorkOS page.
let stack;
let alice;
let bob;
let nora;
let aliceTokens;
let bobTokens;
let workosProxy;

// The Worker reaches WorkOS through this proxy, which can fail every Admin
// Portal revocation (`portalDown`). A WorkOS call that stalls past the admin
// lock's lease: test/admin-races.test.js.
function startWorkosProxy() {
  const state = { target: "", portalDown: false };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.url === "/portal/revoke_link" && state.portalDown) {
      res.writeHead(503, { "Content-Type": "application/json" }).end('{"message":"unavailable"}');
      return;
    }
    const headers = { ...req.headers };
    delete headers.host;
    const upstream = await fetch(`${state.target}${req.url}`, { method: req.method, headers, body: body.length ? body : undefined });
    const out = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = Object.fromEntries(
      [...upstream.headers].filter(([name]) => !["content-encoding", "content-length", "transfer-encoding"].includes(name))
    );
    res.writeHead(upstream.status, responseHeaders).end(out);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ state, server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

before(async () => {
  workosProxy = await startWorkosProxy();
  stack = await startStack({ vars: { WORKOS_API_URL: workosProxy.url } });
  workosProxy.state.target = stack.emulator.url;
  alice = await findUser(stack.emulator, "alice@acme.test");
  bob = await findUser(stack.emulator, "bob@acme.test");
  nora = await findUser(stack.emulator, "nora@new.test");
  aliceTokens = await signInTokens(stack, "alice@acme.test", "Acme");
  bobTokens = await signInTokens(stack, "bob@acme.test", "Acme");
});

after(async () => {
  await stack?.stop();
  workosProxy?.server.close();
});

const addMember = (organizationId, userId, role = "member") =>
  workosApi(stack.emulator, "POST", "/user_management/organization_memberships", {
    organization_id: organizationId,
    user_id: userId,
    role_slug: role
  });

async function adminsOf(organizationId) {
  const admins = [];
  let after = "";
  do {
    const { data, list_metadata } = await workosApi(
      stack.emulator,
      "GET",
      `/user_management/organization_memberships?organization_id=${organizationId}&statuses=active&limit=100${after ? `&after=${after}` : ""}`
    );
    admins.push(...data.filter((m) => m.role?.slug === "admin").map((m) => m.user_id));
    after = list_metadata?.after || "";
  } while (after);
  return admins;
}

// A new workspace where alice and bob are both admins; their tokens for it.
async function twoAdmins(name) {
  const org = await workosApi(stack.emulator, "POST", "/organizations", { name });
  await addMember(org.id, alice.id, "admin");
  await addMember(org.id, bob.id, "admin");
  aliceTokens = await refreshInto(stack, aliceTokens, org.id);
  bobTokens = await refreshInto(stack, bobTokens, org.id);
  for (const tokens of [aliceTokens, bobTokens]) {
    const me = await callApi(stack, tokens.accessToken, "GET", "/api/me");
    assert.equal(me.body.workspace?.role, "admin", JSON.stringify(me.body));
  }
  return org.id;
}

const RACES = {
  "both demote themselves": [
    ["PATCH", () => `/api/workspaces/members/${alice.id}`, { role: "member" }],
    ["PATCH", () => `/api/workspaces/members/${bob.id}`, { role: "member" }]
  ],
  "each demotes the other": [
    ["PATCH", () => `/api/workspaces/members/${bob.id}`, { role: "member" }],
    ["PATCH", () => `/api/workspaces/members/${alice.id}`, { role: "member" }]
  ],
  "both leave": [
    ["POST", () => "/api/workspaces/leave"],
    ["POST", () => "/api/workspaces/leave"]
  ],
  "each removes the other": [
    ["DELETE", () => `/api/workspaces/members/${bob.id}`],
    ["DELETE", () => `/api/workspaces/members/${alice.id}`]
  ]
};

for (const [name, [byAlice, byBob]] of Object.entries(RACES)) {
  test(`two admins at once (${name}) leave the workspace one admin`, async () => {
    for (let trial = 0; trial < 3; trial += 1) {
      const org = await twoAdmins(`Race ${name} ${trial}`);
      const results = await Promise.all([
        callApi(stack, aliceTokens.accessToken, byAlice[0], byAlice[1](), byAlice[2]),
        callApi(stack, bobTokens.accessToken, byBob[0], byBob[1](), byBob[2])
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.equal(statuses[0], 200, JSON.stringify(results));
      assert.ok([403, 404, 422].includes(statuses[1]), `the second is refused: ${JSON.stringify(results)}`);
      assert.equal((await adminsOf(org)).length, 1, `trial ${trial}: ${JSON.stringify(results)}`);
    }
  });
}

test("a demoted admin's CI keys and invite codes stop working", async () => {
  const org = await twoAdmins("Demotion");
  const key = await callApi(stack, aliceTokens.accessToken, "POST", "/api/workspaces/api-keys", { name: "alice ci" });
  assert.equal(key.status, 201, JSON.stringify(key.body));
  const invite = await callApi(stack, aliceTokens.accessToken, "POST", "/api/workspaces/invites", { maxUses: 5 });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const bobsInvite = await callApi(stack, bobTokens.accessToken, "POST", "/api/workspaces/invites", { maxUses: 5 });
  assert.equal(bobsInvite.status, 201, JSON.stringify(bobsInvite.body));
  assert.equal((await callApi(stack, key.body.token, "GET", "/api/me")).status, 200);

  const demoted = await callApi(stack, bobTokens.accessToken, "PATCH", `/api/workspaces/members/${alice.id}`, { role: "member" });
  assert.equal(demoted.status, 200, JSON.stringify(demoted.body));

  assert.equal((await callApi(stack, key.body.token, "GET", "/api/me")).status, 401);
  assert.equal((await callApi(stack, key.body.token, "POST", "/api/uploads", { html: page("after demotion") })).status, 401);
  const noraTokens = await signInTokens(stack, "nora@new.test");
  const joined = await callApi(stack, noraTokens.accessToken, "POST", "/api/workspaces/join", { code: invite.body.code });
  assert.notEqual(joined.status, 200, JSON.stringify(joined.body));
  assert.ok(!(await workosApi(stack.emulator, "GET", `/user_management/organization_memberships?organization_id=${org}&user_id=${nora.id}`)).data.length);
  // Another admin's codes are untouched.
  const viaBob = await callApi(stack, noraTokens.accessToken, "POST", "/api/workspaces/join", { code: bobsInvite.body.code });
  assert.equal(viaBob.status, 200, JSON.stringify(viaBob.body));
});

test("a demotion whose Admin Portal revocation fails still ends the ex-admin's keys and codes", async () => {
  await twoAdmins("Portal down");
  const key = await callApi(stack, aliceTokens.accessToken, "POST", "/api/workspaces/api-keys", { name: "alice ci" });
  assert.equal(key.status, 201, JSON.stringify(key.body));
  const invite = await callApi(stack, aliceTokens.accessToken, "POST", "/api/workspaces/invites", { maxUses: 5 });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  workosProxy.state.portalDown = true;
  try {
    const demoted = await callApi(stack, bobTokens.accessToken, "PATCH", `/api/workspaces/members/${alice.id}`, { role: "member" });
    assert.notEqual(demoted.status, 200, JSON.stringify(demoted.body));
    assert.equal((await callApi(stack, key.body.token, "GET", "/api/me")).status, 401);
  } finally {
    workosProxy.state.portalDown = false;
  }
  // The retry finds the role already changed and still reports success.
  const retried = await callApi(stack, bobTokens.accessToken, "PATCH", `/api/workspaces/members/${alice.id}`, { role: "member" });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.unchanged, true);
  const samTokens = await signInTokens(stack, "sam@new.test");
  const joined = await callApi(stack, samTokens.accessToken, "POST", "/api/workspaces/join", { code: invite.body.code });
  assert.notEqual(joined.status, 200, JSON.stringify(joined.body));
});

test("a demotion made in the WorkOS dashboard also ends the ex-admin's CI keys and invite codes", async () => {
  await twoAdmins("Dashboard demotion");
  const key = await callApi(stack, aliceTokens.accessToken, "POST", "/api/workspaces/api-keys", { name: "alice ci" });
  assert.equal(key.status, 201, JSON.stringify(key.body));
  const invite = await callApi(stack, aliceTokens.accessToken, "POST", "/api/workspaces/invites", { maxUses: 5 });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const { data } = await workosApi(
    stack.emulator,
    "GET",
    `/user_management/organization_memberships?organization_id=${key.body.workspace.id}&user_id=${alice.id}`
  );
  await workosApi(stack.emulator, "PUT", `/user_management/organization_memberships/${data[0].id}`, { role_slug: "member" });
  // The membership webhook arrives shortly after.
  let status = 200;
  for (let attempt = 0; attempt < 50 && status === 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    status = (await callApi(stack, key.body.token, "GET", "/api/me")).status;
  }
  assert.equal(status, 401);
  const noraTokens = await signInTokens(stack, "nora@new.test");
  const joined = await callApi(stack, noraTokens.accessToken, "POST", "/api/workspaces/join", { code: invite.body.code });
  assert.notEqual(joined.status, 200, JSON.stringify(joined.body));
});

test("workspaces over 100 members: everyone is listed and role checks see every admin", async () => {
  const org = await workosApi(stack.emulator, "POST", "/organizations", { name: "Big" });
  await addMember(org.id, alice.id, "admin");
  for (let i = 0; i < 110; i += 1) {
    const user = await workosApi(stack.emulator, "POST", "/user_management/users", {
      email: `member${i}@big.test`,
      first_name: `Member${i}`,
      email_verified: true
    });
    await addMember(org.id, user.id);
  }
  await addMember(org.id, bob.id, "admin");
  aliceTokens = await refreshInto(stack, aliceTokens, org.id);
  bobTokens = await refreshInto(stack, bobTokens, org.id);

  const listed = await callApi(stack, aliceTokens.accessToken, "GET", "/api/workspaces/members");
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.members.length, 112);
  assert.ok(listed.body.members.some((m) => m.email === "member0@big.test"));
  assert.ok(listed.body.members.some((m) => m.email === "member109@big.test"));
  assert.equal(listed.body.members.filter((m) => m.role === "admin").length, 2);

  // Each admin sits on a different end of the list: each sees the other.
  const first = await callApi(stack, aliceTokens.accessToken, "PATCH", `/api/workspaces/members/${alice.id}`, { role: "member" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const back = await callApi(stack, bobTokens.accessToken, "PATCH", `/api/workspaces/members/${alice.id}`, { role: "admin" });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const second = await callApi(stack, bobTokens.accessToken, "PATCH", `/api/workspaces/members/${bob.id}`, { role: "member" });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual(await adminsOf(org.id), [alice.id]);
});
