import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { CI_KEY, OTHER_CI_KEY, callApi, signInTokens, startStack } from "./helpers.js";

// Rate limits that hold up for offices and agents, and that strangers cannot
// spend: WorkOS's rate limit is shared by every tenant, so random bearer
// values must not reach it; sign-in is limited per credential, not per IP.
// The ops Worker is absent here, so these exercise the per-isolate windows.
// Order matters: the per-IP windows fill up as the file runs.
let stack;

before(async () => {
  stack = await startStack();
});

after(async () => {
  await stack?.stop();
});

const random = () => randomBytes(9).toString("hex");

// How many WorkOS API key validations `run` caused: meanwhile the emulator
// answers them from a counting hook ("no such key").
async function countWith(run) {
  let remaining;
  const COUNT = 100_000;
  const hook = await fetch(`${stack.emulator.url}/_emulate/hooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "POST", path: "/api_keys/validations", status: 200, body: { api_key: null }, count: COUNT })
  }).then((r) => r.json());
  try {
    await run();
    const hooks = await fetch(`${stack.emulator.url}/_emulate/hooks`).then((r) => r.json());
    remaining = hooks.find((h) => h.id === hook.id)?.count ?? 0;
  } finally {
    await fetch(`${stack.emulator.url}/_emulate/hooks/${hook.id}`, { method: "DELETE" });
  }
  return COUNT - remaining;
}

const me = (token) => callApi(stack, token, "GET", "/api/me");

async function token(body) {
  const response = await fetch(`${stack.baseUrl}/api/cli/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, retryAfter: response.headers.get("retry-after"), body: await response.json() };
}

test("bearer values that are not WorkOS keys never reach WorkOS", async () => {
  const garbage = ["hello", `not-a-key-${random()}`, "sk_", "sk_short", `pk_test_${random()}`, `sk_test_${random()}!`, "x".repeat(300)];
  const hits = await countWith(async () => {
    for (const value of garbage) {
      assert.equal((await me(value)).status, 401, value);
      const artifact = await fetch(`${stack.baseUrl}/d/abcdefghijkl`, { headers: { Authorization: `Bearer ${value}` }, redirect: "manual" });
      assert.notEqual(artifact.status, 200, value);
      await artifact.text();
    }
  });
  assert.equal(hits, 0);
});

test("a rejected key is remembered: WorkOS is asked once", async () => {
  const value = `sk_test_${random()}`;
  const hits = await countWith(async () => {
    for (let i = 0; i < 4; i++) assert.equal((await me(value)).status, 401);
    const artifact = await fetch(`${stack.baseUrl}/d/abcdefghijkl`, { headers: { Authorization: `Bearer ${value}` }, redirect: "manual" });
    assert.notEqual(artifact.status, 200);
    await artifact.text();
  });
  assert.equal(hits, 1);
  // Real keys, the emulator's "sk_test_..." form included, still work.
  assert.equal((await me(CI_KEY)).status, 200);
  assert.equal((await me(OTHER_CI_KEY)).status, 200);
});

test("logout ends the WorkOS session: its access and refresh tokens stop working", async () => {
  const bob = await signInTokens(stack, "bob@acme.test", "Acme");
  assert.equal((await me(bob.accessToken)).status, 200);
  const alice = await signInTokens(stack, "alice@acme.test", "Acme");

  assert.equal((await callApi(stack, null, "POST", "/api/cli/logout", {})).status, 401);
  const byKey = await callApi(stack, CI_KEY, "POST", "/api/cli/logout", {});
  assert.equal(byKey.status, 400);
  assert.equal((await me(CI_KEY)).status, 200, "an API key is not revoked by asking");

  const out = await callApi(stack, bob.accessToken, "POST", "/api/cli/logout", {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.ok, true);
  assert.equal((await me(bob.accessToken)).status, 401, "the access token is refused at once");
  const refreshed = await token({ refresh_token: bob.refreshToken });
  assert.equal(refreshed.status, 400, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.error, "invalid_grant");
  assert.equal((await callApi(stack, bob.accessToken, "POST", "/api/cli/logout", {})).status, 401);

  // Only the caller's session ended.
  assert.equal((await me(alice.accessToken)).status, 200);
});

test("device polling and refreshes are limited per credential, not per IP", async () => {
  // Many sign-ins at once from one address (an office NAT): none limited.
  for (let i = 0; i < 40; i++) {
    const res = await token(i % 2 ? { device_code: `dc_${random()}` } : { refresh_token: `rt_${random()}` });
    assert.notEqual(res.status, 429, `request ${i}`);
  }
  // One credential hammered: limited, with Retry-After.
  const deviceCode = `dc_${random()}`;
  const statuses = [];
  let retryAfter = null;
  for (let i = 0; i < 31; i++) {
    const res = await token({ device_code: deviceCode });
    statuses.push(res.status);
    if (res.status === 429) retryAfter = res.retryAfter;
  }
  assert.ok(!statuses.slice(0, 30).includes(429), statuses.join(","));
  assert.equal(statuses[30], 429);
  assert.match(retryAfter, /^\d+$/);
  // ...without limiting anyone else's.
  assert.notEqual((await token({ device_code: `dc_${random()}` })).status, 429);
});

test("one IP still has a ceiling over every sign-in step", async () => {
  let limitedAt = null;
  for (let i = 0; i < 130 && limitedAt === null; i++) {
    const res = await token({ device_code: `dc_${random()}` });
    if (res.status === 429) limitedAt = i;
  }
  assert.notEqual(limitedAt, null, "never limited");
});

test("uncached API key validations are limited per IP before WorkOS is called", async () => {
  const bob = await signInTokens(stack, "bob@acme.test", "Acme");
  assert.equal((await me(CI_KEY)).status, 200); // validated and cached before the flood
  const statuses = [];
  let retryAfter = null;
  const hits = await countWith(async () => {
    for (let i = 0; i < 35; i++) {
      const response = await fetch(`${stack.baseUrl}/api/me`, { headers: { Authorization: `Bearer sk_test_flood_${random()}` } });
      statuses.push(response.status);
      if (response.status === 429) retryAfter = response.headers.get("retry-after");
      await response.text();
    }
    // Artifact URLs are covered by the same limit.
    const artifact = await fetch(`${stack.baseUrl}/d/abcdefghijkl`, { headers: { Authorization: `Bearer sk_test_flood_${random()}` } });
    assert.equal(artifact.status, 429);
    await artifact.text();
  });
  // Earlier tests already spent a few of this minute's 30 validations.
  const allowed = statuses.indexOf(429);
  assert.ok(allowed > 20 && allowed <= 30, statuses.join(","));
  assert.equal(hits, allowed, "every limited request was turned away before WorkOS");
  assert.deepEqual(statuses, [...Array(allowed).fill(401), ...Array(35 - allowed).fill(429)]);
  assert.match(retryAfter, /^\d+$/);
  // Cached keys and access tokens from the same address are unaffected.
  assert.equal((await me(CI_KEY)).status, 200);
  assert.equal((await me(bob.accessToken)).status, 200);
});
