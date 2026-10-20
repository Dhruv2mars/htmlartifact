import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { OTHER_CI_KEY, accessToken, callApi, findOrganization, page, refreshInto, signInTokens, startStack } from "./helpers.js";

// Workspace membership from both sides: joining (links, already a member),
// invite options and history, promote/demote/leave, removal (what the admin
// and the removed member are told, their artifacts), and reading across the
// workspaces you belong to. API calls are what an agent sends; `cli` runs the
// built CLI, which the emulator signs in as alice.
const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;
let stack;
let home;
let acme; // the Acme organization
let plan; // alice's Acme artifact (upload receipt)

before(async () => {
  stack = await startStack();
  home = path.join(stack.tmp, "cli-home");
  acme = await findOrganization(stack.emulator, "Acme");
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  const result = await callApi(stack, alice, "POST", "/api/uploads", { html: page("Acme roadmap"), slug: "roadmap" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  plan = result.body;
  await cli(["login"]);
});

after(async () => {
  await stack?.stop();
});

function cli(args) {
  return run(process.execPath, [CLI, ...args], {
    env: { ...process.env, HTMLARTIFACT_HOME: home, HTMLARTIFACT_TOKEN: "", HTMLARTIFACT_API_URL: stack.baseUrl },
    timeout: 60_000
  });
}

const cliFails = (args) =>
  cli(args).then(
    (result) => assert.fail(`expected failure, got: ${result.stdout}`),
    (error) => error
  );

async function read(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, text: await response.text() };
}

const memberId = async (token, email) =>
  (await callApi(stack, token, "GET", "/api/workspaces/members")).body.members.find((m) => m.email === email)?.id;

// Team: nora (admin) and sam, created through the API.
let nora;
let team;

test("joining with the full /join/ link that `workspace invite` prints works (API and CLI)", async () => {
  nora = await signInTokens(stack, "nora@new.test");
  team = (await callApi(stack, nora.accessToken, "POST", "/api/workspaces", { name: "Team" })).body.workspace;
  nora = await refreshInto(stack, nora, team.id);

  const invite = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", { maxUses: 1 });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  assert.ok(invite.body.joinUrl.endsWith(`/join/${invite.body.code}`));
  const sam = await accessToken(stack, "sam@new.test");
  const joined = await callApi(stack, sam, "POST", "/api/workspaces/join", { code: `${invite.body.joinUrl}?utm=x` });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.workspace.name, "Team");

  // R3-22: the same (now used-up) code again says "already in", not "invalid".
  const again = await callApi(stack, sam, "POST", "/api/workspaces/join", { code: invite.body.code });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.alreadyMember, true);
  // An outsider with that spent code still gets the generic refusal.
  const olivia = await accessToken(stack, "olivia@other.test");
  const refused = await callApi(stack, olivia, "POST", "/api/workspaces/join", { code: invite.body.code });
  assert.equal(refused.status, 404);
  assert.doesNotMatch(JSON.stringify(refused.body), /Team/);

  const forAlice = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", {});
  const out = await cli(["workspace", "join", forAlice.body.joinUrl]);
  assert.match(out.stdout, /Joined "Team"/);
  assert.match((await cli(["workspace", "join", forAlice.body.joinUrl])).stdout, /Already in "Team"/);
  await cli(["workspace", "switch", "Acme"]);
});

test("invite options outside the allowed range are refused with the range, not clamped", async () => {
  for (const [body, range] of [
    [{ maxUses: 1000 }, /maxUses must be a whole number from 1 to 50/],
    [{ maxUses: 0 }, /from 1 to 50/],
    [{ maxUses: 2.5 }, /from 1 to 50/],
    [{ ttlDays: 90 }, /ttlDays must be a whole number from 1 to 30/],
    [{ ttlDays: -3 }, /from 1 to 30/],
    [{ ttlDays: "soon" }, /from 1 to 30/]
  ]) {
    const result = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", body);
    assert.equal(result.status, 422, JSON.stringify(body));
    assert.match(result.body.error, range);
  }
  const ok = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", { maxUses: 50, ttlDays: 30 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.maxUses, 50);

  // The CLI checks before sending, and says "person" for one.
  assert.match((await cliFails(["workspace", "invite", "--days", "90"])).stderr, /--days must be a whole number from 1 to 30/);
  assert.match((await cliFails(["workspace", "invite", "--max-uses", "0"])).stderr, /--max-uses must be a whole number of at least 1/);
  assert.match((await cliFails(["workspace", "invite", "--max-uses", "1000"])).stderr, /from 1 to 50/);
  assert.match((await cli(["workspace", "invite", "--max-uses", "1"])).stdout, /up to 1 person\./);
  assert.match((await cli(["workspace", "invite", "--max-uses", "2"])).stdout, /up to 2 people\./);
});

test("`workspace invites --all` lists spent and revoked codes with status and who joined", async () => {
  const revoked = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/invites", {});
  await callApi(stack, nora.accessToken, "DELETE", `/api/workspaces/invites/${revoked.body.code}`);

  const live = await callApi(stack, nora.accessToken, "GET", "/api/workspaces/invites");
  assert.ok(live.body.invites.every((i) => i.status === undefined && i.code !== revoked.body.code));
  const all = await callApi(stack, nora.accessToken, "GET", "/api/workspaces/invites?all=1");
  assert.equal(all.status, 200);
  const byCode = new Map(all.body.invites.map((i) => [i.code, i]));
  assert.equal(byCode.get(revoked.body.code).status, "revoked");
  const usedUp = all.body.invites.find((i) => i.status === "used up");
  assert.deepEqual(usedUp.joined.map((j) => j.email), ["sam@new.test"]);
  const aliceCode = all.body.invites.find((i) => i.joined.some((j) => j.email === "alice@acme.test"));
  assert.equal(aliceCode.status, "live");

  // Members cannot list codes.
  const sam = await refreshInto(stack, await signInTokens(stack, "sam@new.test", "Team"), team.id);
  assert.equal((await callApi(stack, sam.accessToken, "GET", "/api/workspaces/invites?all=1")).status, 403);

  // The CLI (alice, an Acme admin) shows statuses and joiners for her own workspace.
  const aliceToken = await accessToken(stack, "alice@acme.test", "Acme");
  const acmeCode = (await callApi(stack, aliceToken, "POST", "/api/workspaces/invites", { maxUses: 1 })).body.code;
  await callApi(stack, aliceToken, "DELETE", `/api/workspaces/invites/${acmeCode}`);
  const listed = (await cli(["workspace", "invites", "--all"])).stdout;
  assert.match(listed, new RegExp(`${acmeCode}  revoked, used 0/1`));
  assert.doesNotMatch((await cli(["workspace", "invites"])).stdout, new RegExp(acmeCode));
});

test("promote, demote and leave keep at least one admin", async () => {
  const samId = await memberId(nora.accessToken, "sam@new.test");
  const noraId = await memberId(nora.accessToken, "nora@new.test");
  let sam = await refreshInto(stack, await signInTokens(stack, "sam@new.test", "Team"), team.id);

  // The last admin can neither leave nor demote themselves.
  const leave = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/leave");
  assert.equal(leave.status, 422);
  assert.match(leave.body.error, /last admin of "Team".*workspace promote/);
  const selfDemote = await callApi(stack, nora.accessToken, "PATCH", `/api/workspaces/members/${noraId}`, { role: "member" });
  assert.equal(selfDemote.status, 422);
  assert.match(selfDemote.body.error, /last admin/);

  // Members cannot change roles; admins can, with a valid role only.
  assert.equal((await callApi(stack, sam.accessToken, "PATCH", `/api/workspaces/members/${samId}`, { role: "admin" })).status, 403);
  assert.equal((await callApi(stack, nora.accessToken, "PATCH", `/api/workspaces/members/${samId}`, { role: "owner" })).status, 422);
  const promoted = await callApi(stack, nora.accessToken, "PATCH", `/api/workspaces/members/${samId}`, { role: "admin" });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal((await callApi(stack, sam.accessToken, "GET", "/api/me")).body.workspace.role, "admin");
  assert.equal((await callApi(stack, sam.accessToken, "POST", "/api/workspaces/invites", {})).status, 201);

  // Demote and promote again, through the CLI's route: the role sticks at once.
  assert.equal((await callApi(stack, nora.accessToken, "PATCH", `/api/workspaces/members/${samId}`, { role: "member" })).status, 200);
  assert.equal((await callApi(stack, sam.accessToken, "POST", "/api/workspaces/invites", {})).status, 403);
  assert.equal((await callApi(stack, nora.accessToken, "PATCH", `/api/workspaces/members/${samId}`, { role: "admin" })).status, 200);

  // With another admin, nora can leave; her token then names a workspace she left.
  const left = await callApi(stack, nora.accessToken, "POST", "/api/workspaces/leave");
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(left.body.workspace.name, "Team");
  const after = await callApi(stack, nora.accessToken, "GET", "/api/drafts");
  assert.equal(after.status, 403);
  assert.match(after.body.error, /You no longer have access to "Team"/);
  assert.equal((await callApi(stack, nora.accessToken, "GET", "/api/me")).body.removedFrom, "Team");
  const members = await callApi(stack, sam.accessToken, "GET", "/api/workspaces/members");
  assert.deepEqual(members.body.members.map((m) => m.email).sort(), ["alice@acme.test", "sam@new.test"]);

  // Now sam is the last admin: the same rules hold.
  assert.equal((await callApi(stack, sam.accessToken, "PATCH", `/api/workspaces/members/${samId}`, { role: "member" })).status, 422);
  // API keys cannot leave.
  assert.equal((await callApi(stack, OTHER_CI_KEY, "POST", "/api/workspaces/leave")).status, 403);

  // CLI: alice, an Acme admin, promotes and demotes bob; then leaves Team.
  assert.match((await cli(["workspace", "promote", "bob@acme.test"])).stdout, /bob@acme\.test is now an admin\./);
  assert.match((await cli(["workspace", "promote", "bob@acme.test"])).stdout, /already an admin/);
  assert.match((await cli(["workspace", "demote", "bob@acme.test"])).stdout, /bob@acme\.test is now a member\./);
  await cli(["workspace", "switch", "Team"]);
  assert.match((await cliFails(["workspace", "promote", "alice@acme.test"])).stderr, /Only workspace admins/);
  sam = await refreshInto(stack, sam, team.id);
  const out = await cli(["workspace", "leave"]);
  assert.match(out.stdout, /Left "Team"/);
  assert.equal((await callApi(stack, sam.accessToken, "GET", "/api/workspaces/members")).body.members.length, 1);
  await cli(["workspace", "switch", "Acme"]);
});

test("removal: the admin is told every earlier code was revoked; the removed member is told what they lost", async () => {
  const bob = await accessToken(stack, "bob@acme.test", "Acme");
  const bobs = await callApi(stack, bob, "POST", "/api/uploads", { html: page("Bob notes") });
  assert.equal(bobs.status, 201);
  const max = await accessToken(stack, "max@both.test", "Acme");
  // While bob is a member, a teammate's 403 says to ask him or an admin.
  const teammate = await callApi(stack, max, "DELETE", `/api/drafts/${bobs.body.draftId}`);
  assert.equal(teammate.status, 403);
  assert.match(teammate.body.error, /only they or a workspace admin/);

  const out = await cli(["workspace", "remove", "bob@acme.test"]);
  assert.match(out.stdout, /Removed bob@acme\.test\./);
  assert.match(out.stdout, /Every invite code issued until now was revoked/);
  assert.match(out.stdout, /Create a new one with: (npx )?htmlartifact workspace invite/);

  // R3-23: bob's token still names Acme; every route says he lost it.
  for (const [method, pathname, body] of [
    ["GET", "/api/drafts?scope=workspace"],
    ["POST", "/api/uploads", { html: page("after") }]
  ]) {
    const denied = await callApi(stack, bob, method, pathname, body);
    assert.equal(denied.status, 403, pathname);
    assert.match(denied.body.error, /You no longer have access to "Acme"/);
  }
  assert.equal((await callApi(stack, bob, "GET", "/api/me")).body.removedFrom, "Acme");
  assert.equal((await read(plan.publicUrl, bob)).status, 404);

  // R3-13: his artifacts stay, marked; a teammate's 403 no longer says "ask them".
  const feed = await callApi(stack, max, "GET", "/api/drafts?scope=workspace");
  const marked = feed.body.drafts.find((d) => d.draftId === bobs.body.draftId);
  assert.equal(marked.authorFormer, true);
  assert.equal(feed.body.drafts.find((d) => d.draftId === plan.draftId).authorFormer, false);
  assert.match((await cli(["list", "--all"])).stdout, /Bob notes {2}· Bob[^\n]*\(former member\)/);
  const orphan = await callApi(stack, max, "DELETE", `/api/drafts/${bobs.body.draftId}`);
  assert.equal(orphan.status, 403);
  assert.match(orphan.body.error, /author is no longer in this workspace; only a workspace admin can delete it/);
});

test("a CLI sign-in reads any workspace its user is an active member of; writes stay in the current one", async () => {
  // max is in Acme and Other; his token is for Other.
  const max = await accessToken(stack, "max@both.test", "Other");
  assert.equal((await callApi(stack, max, "GET", "/api/me")).body.workspace.name, "Other");
  for (const url of [plan.publicUrl, `${plan.publicUrl}/raw`, plan.versionUrl, `${stack.baseUrl}/d/${plan.draftId}`]) {
    const opened = await read(url, max);
    assert.equal(opened.status, 200, url);
    assert.match(opened.text, /Acme roadmap/);
  }
  // Writes: Acme's artifact is not found from Other.
  const update = await callApi(stack, max, "POST", "/api/uploads", { html: page("hijack"), draftId: plan.draftId });
  assert.equal(update.status, 404);
  assert.equal((await callApi(stack, max, "DELETE", `/api/drafts/${plan.draftId}`)).status, 404);
  const slug = await callApi(stack, max, "POST", "/api/uploads", { html: page("Other roadmap"), slug: "roadmap" });
  assert.equal(slug.status, 201, "the same slug is a new artifact in Other");
  assert.notEqual(slug.body.draftId, plan.draftId);
  assert.match((await read(plan.publicUrl, max)).text, /Acme roadmap/);

  // Isolation is unchanged for non-members: identical to a missing artifact.
  const olivia = await accessToken(stack, "olivia@other.test", "Other");
  const missing = await read(`${stack.baseUrl}/d/zzzzzzzzzzzz`, olivia);
  for (const token of [olivia, OTHER_CI_KEY]) {
    for (const url of [plan.publicUrl, plan.versionUrl, `${stack.baseUrl}/d/${plan.draftId}`]) {
      const denied = await read(url, token);
      assert.equal(denied.status, 404, url);
      assert.equal(denied.text, missing.text);
    }
  }
  // Removed members (bob, above) are non-members too.
  const bob = await accessToken(stack, "bob@acme.test");
  assert.equal((await read(plan.publicUrl, bob)).status, 404);
});

test("--workspace lists (and reads by custom URL) another of your workspaces without switching", async () => {
  const max = await accessToken(stack, "max@both.test", "Other");
  for (const workspace of [acme.id, (await callApi(stack, max, "GET", "/api/workspaces")).body.workspaces.find((w) => w.id === acme.id).handle]) {
    const listed = await callApi(stack, max, "GET", `/api/drafts?scope=workspace&workspace=${encodeURIComponent(workspace)}`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.ok(listed.body.drafts.some((d) => d.draftId === plan.draftId));
    assert.ok(listed.body.drafts.every((d) => d.title !== "Other roadmap"));
  }
  assert.equal((await callApi(stack, max, "GET", "/api/me")).body.workspace.name, "Other", "nothing switched");
  // Not for outsiders, API keys, or removed members: the same 404 as a missing workspace.
  const olivia = await accessToken(stack, "olivia@other.test", "Other");
  const bob = await accessToken(stack, "bob@acme.test");
  const nowhere = await callApi(stack, olivia, "GET", "/api/drafts?scope=workspace&workspace=org_missing");
  assert.equal(nowhere.status, 404);
  for (const token of [olivia, OTHER_CI_KEY, bob]) {
    const denied = await callApi(stack, token, "GET", `/api/drafts?scope=workspace&workspace=${acme.id}`);
    assert.equal(denied.status, 404);
    assert.doesNotMatch(JSON.stringify(denied.body), /roadmap|Acme roadmap/i);
  }

  // CLI: alice creates and switches to Design; Acme stays readable by name.
  await cli(["workspace", "create", "Design"]);
  const all = (await cli(["list", "--all", "--workspace", "acme"])).stdout;
  assert.match(all, /Acme roadmap/);
  assert.match((await cli(["list", "--all"])).stdout, /Nothing published in this workspace yet/);
  const bySlug = await cli(["read", "roadmap", "--workspace", "Acme"]);
  assert.match(bySlug.stdout, /File: /);
  assert.match((await cli(["read", plan.publicUrl])).stdout, /File: /, "a URL in another of your workspaces opens too");
  assert.match((await cliFails(["list", "--workspace", "Nowhere"])).stderr, /not in a workspace named "Nowhere"/);
});
