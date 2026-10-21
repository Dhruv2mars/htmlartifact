import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { WorkOS } from "@workos-inc/node";
import { CI_KEY, COOKIE_PASSWORD, OTHER_CI_KEY, accessToken, callApi, signInTokens, startStack } from "./helpers.js";

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
    for (let i = 0; i < 65; i++) {
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
  // Earlier tests already spent a few of this minute's 60 validations.
  const allowed = statuses.indexOf(429);
  assert.ok(allowed > 50 && allowed <= 60, statuses.join(","));
  assert.equal(hits, allowed, "every limited request was turned away before WorkOS");
  assert.deepEqual(statuses, [...Array(allowed).fill(401), ...Array(65 - allowed).fill(429)]);
  assert.match(retryAfter, /^\d+$/);
  // Cached keys and access tokens from the same address are unaffected.
  assert.equal((await me(CI_KEY)).status, 200);
  assert.equal((await me(bob.accessToken)).status, 200);
});

test("IPv6 callers are limited per /64, so rotating addresses buys no fresh buckets", async () => {
  const { ipv6Prefix64 } = await import("../src/rate-limit.ts");
  assert.equal(ipv6Prefix64("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(ipv6Prefix64("2001:db8:1:2:ffff::9"), "2001:db8:1:2::/64");
  assert.equal(ipv6Prefix64("2001:0db8:0001:0002::"), "2001:db8:1:2::/64");
  assert.equal(ipv6Prefix64("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipv6Prefix64("fe80::1%eth0"), "fe80:0:0:0::/64");
});

test("a chunked body with no Content-Length is cut off at the limit, not buffered whole", async () => {
  const bob = await signInTokens(stack, "bob@acme.test", "Acme");
  const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
  const send = () => {
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        // Far past any upload limit (40 MiB), streamed without a length.
        if (sent >= 40) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      }
    });
    return fetch(`${stack.baseUrl}/api/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bob.accessToken}`, "Content-Type": "application/json" },
      body,
      duplex: "half"
    });
  };
  // Locally, wrangler's dev proxy sometimes reports the server's early answer
  // (it stops reading mid-stream) as a lost connection, a 500, or cuts the
  // answer's body short: try again.
  const answer = async () => {
    const response = await send();
    const text = await response.text().catch(() => "");
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: 500 };
    }
  };
  let response = await answer();
  for (let attempt = 1; response.status === 500 && attempt < 4; attempt += 1) response = await answer();
  assert.equal(response.status, 413);
  assert.match(response.body.error, /Request is over the .* limit\./);
});

test("routes that call WorkOS on every request are limited, so one caller can't spend the shared WorkOS limit", async () => {
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  for (const path of ["/api/workspaces", "/api/workspaces/members"]) {
    const statuses = [];
    for (let i = 0; i < 61; i++) statuses.push((await callApi(stack, alice, "GET", path)).status);
    assert.ok(!statuses.slice(0, 60).includes(429), `${path}: ${statuses.join(",")}`);
    assert.equal(statuses[60], 429, path);
  }
  // Signed out: a replayed callback would make a WorkOS code exchange each time.
  const callbacks = [];
  for (let i = 0; i < 61; i++) {
    const response = await fetch(`${stack.baseUrl}/auth/callback?code=${random()}&state=${random()}`, { redirect: "manual" });
    callbacks.push(response.status);
  }
  assert.ok(!callbacks.slice(0, 60).includes(429), callbacks.join(","));
  assert.equal(callbacks[60], 429);
});

test("a replayed stale session cookie is limited per IP before WorkOS is asked to refresh it", async () => {
  // An access token that fails verification and a dead refresh token: every
  // request makes one WorkOS refresh call, whichever page it hits.
  const [header, payload] = (await accessToken(stack, "alice@acme.test", "Acme")).split(".");
  const sealed = await new WorkOS("sk_test_default").userManagement.sealSessionDataFromAuthenticationResponse({
    authenticationResponse: { accessToken: `${header}.${payload}.stale`, refreshToken: "stale", user: { id: "user_stale" } },
    cookiePassword: COOKIE_PASSWORD
  });
  const cookie = `htmlartifact_session=${encodeURIComponent(sealed)}`;
  const statuses = [];
  for (let i = 0; i < 61; i++) {
    const path = ["/", "/workspaces", "/mine"][i % 3];
    statuses.push((await fetch(`${stack.baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: "manual" })).status);
  }
  assert.ok(!statuses.slice(0, 60).includes(429), statuses.join(","));
  assert.equal(statuses[60], 429);
});
