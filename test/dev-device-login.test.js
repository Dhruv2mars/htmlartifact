import assert from "node:assert/strict";
import { createEmulator } from "@workos/emulate";
import { after, before, test } from "node:test";
import { deviceLoginPicker } from "../scripts/dev-device-login.mjs";

// `bun run dev:local` signs the CLI in through the WorkOS emulator, which
// approves every device sign-in as its first seeded user. The dev stack puts
// scripts/dev-device-login.mjs in front of it, so each sign-in picks its user.
let emulator;
let picker;

before(async () => {
  emulator = await createEmulator({
    port: 0,
    seed: {
      users: [
        { email: "alice@example.com", first_name: "Alice", email_verified: true },
        { email: "bob@example.com", first_name: "Bob", email_verified: true }
      ]
    }
  });
  picker = await deviceLoginPicker(emulator);
});

after(async () => {
  await picker?.close();
  await emulator?.close();
});

const CLIENT_ID = "client_htmlartifact_local";

// What the Worker relays for `htmlartifact login` (src/api.ts relayWorkos): start, then poll.
const relay = (pathname, body) =>
  fetch(`${picker.url}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${emulator.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...body, client_id: CLIENT_ID })
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
const start = async () => (await relay("/user_management/authorize/device", {})).body;
const poll = (deviceCode) =>
  relay("/user_management/authenticate", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode });
const approve = (userCode, email) =>
  fetch(`${picker.url}/device`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_code: userCode, email })
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

test("a local CLI sign-in waits for its link, where the user picks who they are", async () => {
  const device = await start();
  assert.ok(device.verification_uri_complete.startsWith(`${picker.url}/device?user_code=`), device.verification_uri_complete);
  const waiting = await poll(device.device_code);
  assert.equal(waiting.body.error, "authorization_pending", "not approved as the first seeded user");

  const form = await fetch(device.verification_uri_complete).then((r) => r.text());
  assert.match(form, new RegExp(`value="${device.user_code}"`));
  assert.match(form, /alice@example\.com/);
  assert.match(form, /bob@example\.com/);

  const approved = await approve(device.user_code.toLowerCase(), "bob@example.com");
  assert.equal(approved.status, 200);
  assert.match(approved.text, /signs in as <strong>bob@example\.com<\/strong>/);
  const signedIn = await poll(device.device_code);
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  assert.equal(signedIn.body.user.email, "bob@example.com");

  // A code is approved once; wrong and used codes are refused.
  assert.equal((await approve(device.user_code, "alice@example.com")).status, 400);
  assert.equal((await approve("NOTACODE", "alice@example.com")).status, 400);
  const another = await start();
  assert.equal((await approve(another.user_code, "nobody@example.com")).status, 400, "only existing users");
  assert.equal((await poll(another.device_code)).body.error, "authorization_pending");
});

test("everything else passes through to the emulator", async () => {
  const health = await fetch(`${picker.url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  const users = await fetch(`${picker.url}/user_management/users`, { headers: { Authorization: `Bearer ${emulator.apiKey}` } });
  assert.equal(users.status, 200);
  assert.deepEqual(((await users.json()).data.map((u) => u.email)).sort(), ["alice@example.com", "bob@example.com"]);
});
