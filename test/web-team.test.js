import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Browser, accessToken, callApi, startStack } from "./helpers.js";

// Running a workspace from the browser (People and Settings): the same
// changes the CLI makes through the API, on the same code path, so each test
// checks the result through the API too. Seeded: Acme (alice admin, bob, max),
// Other (olivia, max).
let stack;

before(async () => {
  stack = await startStack();
});

after(async () => {
  await stack?.stop();
});

const signedIn = async (email, workspace) => {
  const browser = new Browser(stack);
  const response = await browser.signIn(email, workspace ? { workspace } : {});
  assert.equal(response.status, 200, `${email} signed in`);
  return browser;
};
const api = async (email, workspace, method, path, body) => callApi(stack, await accessToken(stack, email, workspace), method, path, body);
const members = async () => (await api("alice@acme.test", "Acme", "GET", "/api/workspaces/members")).body.members;
const liveInvites = async () => (await api("alice@acme.test", "Acme", "GET", "/api/workspaces/invites")).body.invites;
const idOf = async (email) => (await members()).find((m) => m.email === email)?.id;
// The page's text as read: React escapes apostrophes and quotes, and marks
// where text pieces join with empty comments.
const text = (response) => response.text_.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

test("an admin makes and revokes invite links on the web, and the API sees the same links", async () => {
  const alice = await signedIn("alice@acme.test", "Acme");
  const people = await alice.get("/people");
  assert.equal(people.status, 200);
  assert.match(text(people), /Create invite link/);

  const made = await alice.post("/people/invites", { days: "1", uses: "5" });
  assert.equal(new URL(made.finalUrl).pathname, "/people");
  assert.match(text(made), /New invite link ready/);
  const [link, ...rest] = await liveInvites();
  assert.equal(rest.length, 0);
  assert.equal(link.maxUses, 5);
  assert.ok(Date.parse(link.expiresAt) - Date.now() <= 86_400_000 + 60_000, "lasts one day");
  assert.equal(link.createdBy.name, "Alice");
  assert.match(text(made), new RegExp(`/join/${link.code}`), "the page shows the link to send");
  assert.doesNotMatch(text(await alice.get("/people")), /New invite link ready/, "the notice is said once");

  const revoked = await alice.post("/people/invites/revoke", { code: link.code });
  assert.match(text(revoked), /Invite link revoked/);
  assert.equal((await liveInvites()).length, 0);
});

test("a change from another site is refused", async () => {
  const alice = await signedIn("alice@acme.test", "Acme");
  const forged = await alice.post("/people/invites", {}, { headers: { Origin: "https://evil.example" } });
  assert.equal(forged.status, 403);
  assert.equal((await liveInvites()).length, 0);
});

test("members see who is in the workspace and which admin to ask, but can't invite", async () => {
  const bob = await signedIn("bob@acme.test", "Acme");
  const people = text(await bob.get("/people"));
  assert.match(people, /alice@acme\.test/);
  assert.match(people, /To invite someone, ask an admin: Alice\./);
  assert.doesNotMatch(people, /Create invite link/);
  assert.doesNotMatch(people, /make-admin/, "no role controls for members");

  const tried = await bob.post("/people/invites", {});
  assert.match(text(tried), /Only workspace admins can do that\./);
  assert.equal((await liveInvites()).length, 0);
  assert.doesNotMatch(text(await bob.get("/workspaces")), /workspace invite/, "no admin-only command for members");
});

test("an admin changes roles after a confirmation page, and the workspace keeps an admin", async () => {
  const alice = await signedIn("alice@acme.test", "Acme");
  const bobId = await idOf("bob@acme.test");
  const aliceId = await idOf("alice@acme.test");

  assert.match(text(await alice.get(`/people/${bobId}/make-admin`)), /Make Bob an admin\?/);
  const promoted = await alice.post(`/people/${bobId}/make-admin`);
  assert.match(text(promoted), /Bob is now an admin of Acme\./);
  assert.equal((await members()).find((m) => m.id === bobId).role, "admin");

  const demoted = await alice.post(`/people/${bobId}/make-member`);
  assert.match(text(demoted), /Bob is now a member of Acme\./);
  assert.equal((await members()).find((m) => m.id === bobId).role, "member");

  // Alice is the only admin again: the page says so, and the change is refused.
  assert.match(text(await alice.get(`/people/${aliceId}/make-member`)), /You're the only admin\. Make someone else an admin first\./);
  const refused = await alice.post(`/people/${aliceId}/make-member`);
  assert.match(text(refused), /last admin/);
  assert.equal((await members()).find((m) => m.id === aliceId).role, "admin");
});

test("removing someone says what ends first, revokes the links they may hold, and tells them on their next page", async () => {
  const alice = await signedIn("alice@acme.test", "Acme");
  const max = await signedIn("max@both.test", "Acme");
  const maxId = await idOf("max@both.test");
  await alice.post("/people/invites", {});
  assert.equal((await liveInvites()).length, 1);

  const ask = text(await alice.get(`/people/${maxId}/remove`));
  assert.match(ask, /Remove Max from Acme\?/);
  assert.match(ask, /The live invite link stops working, because Max might have one\./);

  const removed = await alice.post(`/people/${maxId}/remove`);
  assert.match(text(removed), /Max no longer has access to Acme\./);
  assert.equal(await idOf("max@both.test"), undefined);
  assert.equal((await liveInvites()).length, 0, "links made before the removal are revoked");

  // Max is still in Other, his only workspace left: the next page moves him there and says why.
  const next = await max.get("/");
  assert.equal(new URL(next.finalUrl).pathname, "/");
  assert.match(text(next), /You no longer have access to Acme, so you're now in Other\./);
});

test("leaving from the web: the only admin is stopped; a member leaves and is told", async () => {
  const alice = await signedIn("alice@acme.test", "Acme");
  assert.match(text(await alice.get("/settings/leave")), /You're the only admin of Acme\./);
  const refused = await alice.post("/settings/leave");
  assert.equal(new URL(refused.finalUrl).pathname, "/settings");
  assert.match(text(refused), /You are the last admin of "Acme"\. Make someone else an admin first, or delete the workspace\./);

  await alice.post("/people/invites", {});
  const bob = await signedIn("bob@acme.test", "Acme");
  assert.match(text(await bob.get("/settings/leave")), /Leave Acme\?/);
  const left = await bob.post("/settings/leave");
  assert.equal(new URL(left.finalUrl).pathname, "/workspaces", "no workspace left");
  assert.match(text(left), /You left Acme\./);
  assert.equal(await idOf("bob@acme.test"), undefined);
  assert.equal((await liveInvites()).length, 1, "a member leaving keeps the team's links");
});

test("deleting a workspace from the web needs its exact name", async () => {
  const nora = await signedIn("nora@new.test");
  const created = await nora.post("/workspaces", { name: "Doomed Co" });
  assert.match(text(created), /Created Doomed Co\. You're its admin/);
  assert.match(text(await nora.get("/settings/delete")), /Delete Doomed Co\?/);

  const wrong = await nora.post("/settings/delete", { confirm: "doomed co" });
  assert.equal(new URL(wrong.finalUrl).pathname, "/settings/delete");
  assert.match(text(wrong), /Type the workspace's exact name, Doomed Co, to delete it/);
  assert.equal((await api("nora@new.test", "Doomed Co", "GET", "/api/workspaces")).body.workspaces.length, 1);

  const gone = await nora.post("/settings/delete", { confirm: "Doomed Co" });
  assert.equal(new URL(gone.finalUrl).pathname, "/workspaces");
  assert.match(text(gone), /Doomed Co was deleted, with everything in it\./);
});
