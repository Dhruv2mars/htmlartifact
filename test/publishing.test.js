import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { Browser, accessToken, callApi, page, startStack, writeHtml } from "./helpers.js";

// Publishing as agents do it, through the built CLI (dist/htmlartifact.js),
// against a local Worker with a sandbox origin and the WorkOS emulator. Each
// test reproduces a bug found by simulated users (2026-10-27).
const run = promisify(execFile);
const CLI = new URL("../dist/htmlartifact.js", import.meta.url).pathname;
let stack;
let home;

before(async () => {
  stack = await startStack({ sandbox: true });
  home = path.join(stack.tmp, "cli-home");
  // The emulator signs the CLI in as alice, an admin of Acme.
  await cli(["login"]);
});

after(async () => {
  await stack?.stop();
});

function cli(args, env = {}) {
  return run(process.execPath, [CLI, ...args], {
    env: {
      ...process.env,
      HTMLARTIFACT_HOME: home,
      HTMLARTIFACT_TOKEN: "",
      HTMLARTIFACT_API_URL: stack.baseUrl,
      CI: "",
      GITHUB_ACTIONS: "",
      ...env
    },
    timeout: 60_000
  });
}

const json = async (args, env) => JSON.parse((await cli([...args, "--json"], env)).stdout);
// A failed command's --json error object (stdout) and exit code.
const fails = async (args, env) => {
  const error = await cli([...args, "--json"], env).then(
    () => assert.fail(`expected ${args.join(" ")} to fail`),
    (e) => e
  );
  return { ...JSON.parse(error.stdout), exit: error.code };
};
const listed = async (draftId) => (await json(["list", "--all"])).drafts.find((d) => d.draftId === draftId);

test("--description on unchanged content says the description changed, not just 'Unchanged'", async () => {
  const file = writeHtml(stack.tmp, "review.html", page("Review: PR 412 rate limiter"));
  const first = await json(["upload", file]);
  assert.equal(first.action, "created");

  // Only the description changes: no new version, and the headline says what did change.
  const human = await cli(["upload", file, "--draft", first.draftId, "--description", "Rate limiter: 2 findings, 1 blocking"]);
  assert.equal(human.stdout.split("\n")[0], "Unchanged content (still version 1); updated the description.");
  assert.equal((await listed(first.draftId)).description, "Rate limiter: 2 findings, 1 blocking");

  // Nothing changed at all: the headline agents may grep for stays exactly as it was.
  const noop = await cli(["upload", file, "--draft", first.draftId, "--description", "Rate limiter: 2 findings, 1 blocking"]);
  assert.equal(noop.stdout.split("\n")[0], "Unchanged: this content is already version 1");

  // JSON: `action` still says whether a version was published; changedFields says what else moved.
  assert.deepEqual(first.changedFields, [], "a new artifact changed no existing fields");
  const receipt = await json(["upload", file, "--draft", first.draftId, "--description", "Rate limiter: fixed"]);
  assert.equal(receipt.action, "unchanged");
  assert.equal(receipt.versionNumber, 1);
  assert.deepEqual(receipt.changedFields, ["description"]);
  const same = await json(["upload", file, "--draft", first.draftId]);
  assert.equal(same.action, "unchanged");
  assert.deepEqual(same.changedFields, []);

  // New content and a new <title>: a new version, and the title is named too.
  writeHtml(stack.tmp, "review.html", page("Review: PR 412 rate limiter (round 2)"));
  const updated = await cli(["upload", file, "--draft", first.draftId]);
  assert.equal(updated.stdout.split("\n")[0], "Published a new version");
  const second = await json(["upload", writeHtml(stack.tmp, "review.html", page("Review: PR 412, round 3")), "--draft", first.draftId, "--description", "Round 3"]);
  assert.equal(second.action, "updated");
  assert.deepEqual(second.changedFields, ["title", "description"]);
});

test('--description "" clears the description; no --description leaves it alone', async () => {
  const file = writeHtml(stack.tmp, "plan.html", page("Auth refactor plan"));
  const first = await json(["upload", file, "--description", "Draft for review"]);
  assert.equal((await listed(first.draftId)).description, "Draft for review");

  // Without --description the description stays.
  await json(["upload", file, "--draft", first.draftId]);
  assert.equal((await listed(first.draftId)).description, "Draft for review");

  const cleared = await json(["upload", file, "--draft", first.draftId, "--description", ""]);
  assert.equal((await listed(first.draftId)).description, null, '--description "" clears it');
  assert.equal(cleared.action, "unchanged");
  assert.deepEqual(cleared.changedFields, ["description"]);

  // Clearing what is already clear changes nothing.
  const again = await json(["upload", file, "--draft", first.draftId, "--description", ""]);
  assert.deepEqual(again.changedFields, []);
});

test("the upload API: a description string sets (trimmed, 1000 characters) or clears it; anything else leaves it", async () => {
  const token = await accessToken(stack, "bob@acme.test", "Acme");
  const html = page("API description");
  const upload = (body) => callApi(stack, token, "POST", "/api/uploads", { html, filename: "api.html", ...body });
  const description = async (id) => (await callApi(stack, token, "GET", "/api/drafts")).body.drafts.find((d) => d.draftId === id).description;

  const created = await upload({ description: "  " });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.changedFields, []);
  const id = created.body.draftId;
  assert.equal(await description(id), null, "whitespace on a new artifact is no description");

  const set = await upload({ draftId: id, description: `  ${"d".repeat(1200)}  ` });
  assert.deepEqual(set.body.changedFields, ["description"]);
  assert.equal(set.body.unchanged, true);
  assert.equal(await description(id), "d".repeat(1000));

  // Not a string (or no key at all): left alone.
  for (const body of [{ description: 42 }, { description: null }, {}]) {
    const kept = await upload({ draftId: id, ...body });
    assert.deepEqual(kept.body.changedFields, [], JSON.stringify(body));
    assert.equal(await description(id), "d".repeat(1000), JSON.stringify(body));
  }

  const cleared = await upload({ draftId: id, description: " \n " });
  assert.deepEqual(cleared.body.changedFields, ["description"]);
  assert.equal(await description(id), null);

  // A rename by --draft and --slug on unchanged content is named as well.
  const renamed = await upload({ draftId: id, slug: "api-description" });
  assert.deepEqual(renamed.body.changedFields, ["slug"]);
  assert.equal(renamed.body.slug, "api-description");
});

test("a page with no <title> is named by its <h1>, not its file name", async () => {
  const file = writeHtml(stack.tmp, "out.html", "<!doctype html><meta charset=utf-8><h1>Q3 incident retro</h1><p>notes</p>");
  const receipt = await json(["upload", file, "--new"]);
  assert.equal((await listed(receipt.draftId)).title, "Q3 incident retro");
});

test("a new version whose title changed says so (an unrelated page at a reused path)", async () => {
  const file = writeHtml(stack.tmp, "plan.html", page("Plan"));
  const first = await json(["upload", file, "--new"]);
  assert.deepEqual(first.warnings, []);

  // Same document, new content, same title: nothing to say.
  writeHtml(stack.tmp, "plan.html", page("Plan", "<p>more detail</p>"));
  const second = await json(["upload", file]);
  assert.equal(second.action, "updated");
  assert.ok(!second.warnings.some((w) => /title changed/i.test(w)), JSON.stringify(second.warnings));

  // A different document reuses the path: still published (people regenerate
  // reports at one path all day), but the receipt says what happened.
  writeHtml(stack.tmp, "plan.html", page("Plan: onboarding email sequence"));
  const third = await json(["upload", file]);
  assert.equal(third.action, "updated");
  assert.equal(third.draftId, first.draftId);
  const warning = third.warnings.find((w) => /title changed/i.test(w));
  assert.ok(warning, JSON.stringify(third.warnings));
  assert.match(warning, /"Plan" to "Plan: onboarding email sequence"/);
  assert.match(warning, /--new/);
  const human = await cli(["upload", writeHtml(stack.tmp, "plan.html", page("Plan v2"))]);
  assert.match(human.stderr, /Warning: The title changed from "Plan: onboarding email sequence" to "Plan v2"/);

  // A title that was only the file name (no <title> or <h1>) getting a real one is not a change of document.
  const bare = writeHtml(stack.tmp, "bare.html", "<!doctype html><p>no title yet</p>");
  const untitled = await json(["upload", bare, "--new"]);
  assert.equal((await listed(untitled.draftId)).title, "bare.html");
  writeHtml(stack.tmp, "bare.html", page("Now titled"));
  const titled = await json(["upload", bare]);
  assert.ok(!titled.warnings.some((w) => /title changed/i.test(w)), JSON.stringify(titled.warnings));
});

test("--slug on a file that is already published gives that artifact the slug, not a second artifact", async () => {
  const file = writeHtml(stack.tmp, "perf-report.html", page("Perf report: p95 latency"));
  const first = await json(["upload", file, "--new"]);
  const slugged = await json(["upload", file, "--slug", "perf-report"]);
  assert.equal(slugged.draftId, first.draftId, "the same artifact");
  assert.equal(slugged.slug, "perf-report");
  assert.equal(slugged.action, "unchanged");
  assert.deepEqual(slugged.changedFields, ["slug"]);
  assert.ok(!slugged.warnings.some((w) => /still updates/.test(w)), JSON.stringify(slugged.warnings));
  const feed = (await json(["list", "--all"])).drafts.filter((d) => d.title === "Perf report: p95 latency");
  assert.equal(feed.length, 1);
  // The path keeps updating it, now at its custom URL.
  const again = await json(["upload", writeHtml(stack.tmp, "perf-report.html", page("Perf report: p95 latency", "<p>v2</p>"))]);
  assert.equal(again.draftId, first.draftId);
  assert.match(again.url, /\/perf-report$/);

  // Already at another custom URL: say how to move it or make a separate one, don't guess.
  const other = writeHtml(stack.tmp, "weekly.html", page("Weekly"));
  const named = await json(["upload", other, "--slug", "weekly-old"]);
  const refused = await fails(["upload", other, "--slug", "weekly-new"]);
  assert.equal(refused.exit, 2);
  assert.equal(refused.code, "artifact_has_another_slug");
  assert.equal(refused.draftId, named.draftId);
  assert.equal(refused.slug, "weekly-old");
  assert.match(refused.error, new RegExp(`--draft ${named.draftId} --slug weekly-new`));
  assert.match(refused.error, /--force/);
  // --force: a separate artifact at the new slug, as before.
  const separate = await json(["upload", other, "--slug", "weekly-new", "--force"]);
  assert.notEqual(separate.draftId, named.draftId);
  assert.equal(separate.slug, "weekly-new");
});

test("a deleted artifact: the path's upload says it was deleted and that --new publishes it again", async () => {
  const file = writeHtml(stack.tmp, "gone.html", page("Gone soon"));
  const first = await json(["upload", file, "--new"]);
  // Deleted elsewhere (the web, another machine): this machine's mapping stays.
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${first.draftId}`)).status, 200);
  const failed = await fails(["upload", file]);
  assert.equal(failed.exit, 4);
  assert.equal(failed.code, "mapped_artifact_not_found");
  assert.equal(failed.draftId, first.draftId);
  assert.match(failed.error, /deleted/);
  assert.match(failed.error, /--new/);
  assert.doesNotMatch(failed.error, /another workspace/);
});

test("a file published in two workspaces stays two artifacts: plain uploads in each update their own", async () => {
  const file = writeHtml(stack.tmp, "bench.html", page("Bench", "<p>acme 1</p>"));
  const acme = await json(["upload", file, "--new"]);
  assert.equal(acme.workspace, "Acme");

  await cli(["workspace", "create", "Kestrel"]);
  try {
    // A plain upload in Kestrel publishes there; it no longer trips over Acme's artifact.
    const kestrel = await json(["upload", file]);
    assert.equal(kestrel.action, "created");
    assert.equal(kestrel.workspace, "Kestrel");
    assert.notEqual(kestrel.draftId, acme.draftId);

    await cli(["workspace", "switch", "Acme"]);
    writeHtml(stack.tmp, "bench.html", page("Bench", "<p>acme 2</p>"));
    const back = await json(["upload", file]);
    assert.equal(back.draftId, acme.draftId, "Acme's artifact, not a duplicate");
    assert.equal(back.action, "updated");

    await cli(["workspace", "switch", "Kestrel"]);
    writeHtml(stack.tmp, "bench.html", page("Bench", "<p>kestrel 2</p>"));
    assert.equal((await json(["upload", file])).draftId, kestrel.draftId);

    // A mapping saved by an older CLI (one per path, workspace unknown) that
    // names an artifact in another workspace: say where it is; --new would be a copy.
    const legacyFile = writeHtml(stack.tmp, "legacy.html", page("Legacy"));
    const legacyHtml = writeHtml(stack.tmp, "legacy-acme.html", page("Legacy in Acme"));
    await cli(["workspace", "switch", "Acme"]);
    const inAcme = await json(["upload", legacyHtml, "--new"]);
    await cli(["workspace", "switch", "Kestrel"]);
    const binding = path.join(home, "drafts", `${createHash("sha256").update(`${stack.baseUrl}\n${legacyFile}`).digest("hex")}.json`);
    fs.writeFileSync(binding, JSON.stringify({ draftId: inAcme.draftId, slug: null, publicUrl: inAcme.url, rawUrl: inAcme.rawUrl, latestVersionNumber: 1, apiUrl: stack.baseUrl, file: legacyFile }));
    const elsewhere = await fails(["upload", legacyFile]);
    assert.equal(elsewhere.exit, 4);
    assert.equal(elsewhere.code, "mapped_artifact_not_found");
    assert.equal(elsewhere.draftId, inAcme.draftId);
    assert.match(elsewhere.error, /another of your workspaces/);
    assert.match(elsewhere.error, /workspace switch/);
    assert.match(elsewhere.error, /--draft/);
  } finally {
    await cli(["workspace", "switch", "Acme"]);
  }
});

test("the receipt's Raw HTML URL shows a signed-in browser the page's source", async () => {
  const html = page("Raw me", "<p>source &amp; all</p><script>document.title = 'ran'</script>");
  const receipt = await json(["upload", writeHtml(stack.tmp, "raw.html", html), "--new"]);
  const bob = new Browser(stack);
  await bob.signIn("bob@acme.test", { workspace: "Acme" });

  for (const url of [receipt.rawUrl, `${stack.baseUrl}/d/${receipt.draftId}/v/1/raw`]) {
    const shown = await bob.get(url);
    assert.equal(shown.status, 200, url);
    assert.equal(shown.headers.get("content-type"), "text/plain; charset=utf-8", url);
    assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
    assert.match(shown.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
    assert.equal(shown.text_, html, "the stored bytes, not the viewer");
  }
  // The artifact URL itself still opens the viewer.
  assert.match((await bob.get(receipt.url)).text_, /<iframe/);
  // Agents with a token get the HTML as before.
  const token = await accessToken(stack, "bob@acme.test", "Acme");
  const agent = await fetch(receipt.rawUrl, { headers: { Authorization: `Bearer ${token}` } });
  assert.match(agent.headers.get("content-type"), /^text\/html/);
  assert.equal(await agent.text(), html);
  // Outsiders: the same as before (sign in; a 404 for another workspace's member).
  const signedOut = await fetch(receipt.rawUrl, { headers: { Accept: "text/html" }, redirect: "manual" });
  assert.equal(signedOut.status, 302);
  const olivia = new Browser(stack);
  await olivia.signIn("olivia@other.test", { workspace: "Other" });
  const outsider = await olivia.get(receipt.rawUrl);
  assert.equal(outsider.status, 404);
  assert.equal(outsider.text_, (await olivia.get(`${stack.baseUrl}/d/zzzzzzzzzzzz/raw`)).text_);
});

test("a pruned version's link tells a member it was pruned, not to ask for an invite", async () => {
  const file = writeHtml(stack.tmp, "pruned.html", page("Auth refactor plan", "<p>1</p>"));
  const receipt = await json(["upload", file, "--new"]);
  for (const n of [2, 3]) await json(["upload", writeHtml(stack.tmp, "pruned.html", page("Auth refactor plan", `<p>${n}</p>`))]);
  assert.equal((await json(["prune", receipt.draftId, "--keep", "2"])).deleted, 1);
  const v1 = `${stack.baseUrl}/d/${receipt.draftId}/v/1`;

  // A member's browser goes to the history page, which lists what is left.
  const bob = new Browser(stack);
  await bob.signIn("bob@acme.test", { workspace: "Acme" });
  const opened = await bob.get(v1);
  assert.equal(new URL(opened.finalUrl).pathname, `/history/${receipt.draftId}`);
  assert.equal(new URL(opened.finalUrl).searchParams.get("missing"), "1");
  assert.equal(opened.status, 200);

  // Agents: a 404 that says why, and where the latest is.
  const token = await accessToken(stack, "bob@acme.test", "Acme");
  const agent = await fetch(v1, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(agent.status, 404);
  assert.equal(agent.headers.get("x-htmlartifact-latest-version"), "3");
  assert.match(await agent.text(), new RegExp(`Version 1 of ${receipt.draftId} was deleted \\(pruned\\)\\. The latest is version 3: .*/d/${receipt.draftId}/v/3`));
  const never = await fetch(`${stack.baseUrl}/d/${receipt.draftId}/v/9`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(never.status, 404);
  assert.match(await never.text(), new RegExp(`${receipt.draftId} has no version 9\\. The latest is version 3`));
  const read = await fails(["read", v1]);
  assert.equal(read.exit, 4);
  assert.match(read.error, /was deleted \(pruned\)/);
  assert.doesNotMatch(read.error, /Not found in any workspace/);

  // Someone outside the workspace learns nothing: the usual 404.
  const olivia = new Browser(stack);
  await olivia.signIn("olivia@other.test", { workspace: "Other" });
  const outsider = await olivia.get(v1);
  assert.equal(outsider.status, 404);
  assert.equal(outsider.text_, (await olivia.get(`${stack.baseUrl}/d/zzzzzzzzzzzz/v/1`)).text_);
  const outsiderToken = await accessToken(stack, "olivia@other.test", "Other");
  const outsiderAgent = await fetch(v1, { headers: { Authorization: `Bearer ${outsiderToken}` } });
  assert.equal(outsiderAgent.status, 404);
  assert.equal(outsiderAgent.headers.get("x-htmlartifact-latest-version"), null);
});

// What the CLI says about git, recorded by a stand-in server: the version's
// label on the history page comes from it.
test("git metadata describes the uploaded file: an uncommitted file gets no commit subject", async () => {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(data));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, created: true, draftId: "abcdefghijkl", versionNumber: 1, publicUrl: "http://x.test/d/abcdefghijkl", rawUrl: "http://x.test/d/abcdefghijkl/raw", versionUrl: "", contentHash: "h", totalBytes: 1, warnings: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ha-git-"));
  const env = { HTMLARTIFACT_HOME: path.join(tmp, "home"), HTMLARTIFACT_TOKEN: "token", HTMLARTIFACT_API_URL: `http://127.0.0.1:${server.address().port}` };
  const sent = async (target) => {
    await cli(["upload", target, "--new", "--json"], env);
    return bodies.at(-1).metadata;
  };
  // The test's own commits: no user config, signing or hooks from this machine.
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, "no-gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, "site"), { recursive: true });
  const git = (...args) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.test", ...args], { cwd: repo, env: gitEnv, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    fs.writeFileSync(path.join(repo, "perf.html"), page("Perf"));
    fs.writeFileSync(path.join(repo, "site", "index.html"), page("Site"));
    fs.writeFileSync(path.join(repo, ".gitignore"), "out/\n");
    git("add", ".");
    git("commit", "-qm", "Add perf report");
    const added = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "notes.txt"), "later\n");
    git("add", "notes.txt");
    git("commit", "-qm", "Unrelated later change");
    const head = git("rev-parse", "HEAD");

    // Committed as uploaded: the commit that last changed it, not HEAD.
    let meta = await sent(path.join(repo, "perf.html"));
    assert.equal(meta.gitCommitSubject, "Add perf report");
    assert.equal(meta.gitCommitSha, added);
    assert.equal(meta.gitDirty, false);
    // Other uncommitted work in the repo is not this file's.
    fs.writeFileSync(path.join(repo, "notes.txt"), "dirty\n");
    assert.equal((await sent(path.join(repo, "perf.html"))).gitDirty, false);
    // A folder: the last commit that changed any of its pages.
    assert.equal((await sent(path.join(repo, "site"))).gitCommitSubject, "Add perf report");

    // Modified, untracked, or ignored: HEAD is only the base; its message is someone else's.
    fs.writeFileSync(path.join(repo, "perf.html"), page("Perf", "<p>edited</p>"));
    const untracked = path.join(repo, "new report.html");
    fs.writeFileSync(untracked, page("New"));
    fs.mkdirSync(path.join(repo, "out"));
    const ignored = path.join(repo, "out", "out.html");
    fs.writeFileSync(ignored, page("Out"));
    for (const target of [path.join(repo, "perf.html"), untracked, ignored]) {
      meta = await sent(target);
      assert.equal(meta.gitCommitSubject, null, target);
      assert.equal(meta.gitCommitSha, head, target);
      assert.equal(meta.gitDirty, true, target);
      assert.equal(meta.gitBranch, git("rev-parse", "--abbrev-ref", "HEAD"));
    }

    // Outside any repository: nothing.
    const loose = path.join(tmp, "loose.html");
    fs.writeFileSync(loose, page("Loose"));
    meta = await sent(loose);
    assert.equal(meta.gitCommitSubject, null);
    assert.equal(meta.gitCommitSha, null);
    assert.equal(meta.gitDirty, null);
  } finally {
    server.close();
  }
});

test("an admin deleting a teammate's artifact must confirm with --yes; deleting your own needs nothing", async () => {
  const bob = await accessToken(stack, "bob@acme.test", "Acme");
  const uploaded = await callApi(stack, bob, "POST", "/api/uploads", { html: page("Bob's rollout plan"), filename: "rollout.html" });
  assert.equal(uploaded.status, 201);
  await callApi(stack, bob, "POST", "/api/uploads", { html: page("Bob's rollout plan", "<p>v2</p>"), draftId: uploaded.body.draftId });
  const id = uploaded.body.draftId;

  // alice (an admin) without --yes: refused, nothing erased, and told whose work it is.
  const refused = await fails(["delete", id]);
  assert.equal(refused.exit, 2);
  assert.equal(refused.code, "confirm_teammate_artifact");
  assert.equal(refused.draftId, id);
  assert.equal(refused.title, "Bob's rollout plan");
  assert.equal(refused.versionCount, 2);
  assert.match(refused.author, /Bob/);
  assert.match(refused.error, new RegExp(`delete ${id} --yes`));
  assert.equal((await fetch(`${stack.baseUrl}/d/${id}`, { headers: { Authorization: `Bearer ${bob}` } })).status, 200);
  const human = await cli(["delete", id]).catch((error) => error);
  assert.match(human.stderr, /Bob's rollout plan/);
  assert.match(human.stderr, /2 versions/);

  // The API asks for the artifact's ID as confirmation, like `workspace delete`.
  const alice = await accessToken(stack, "alice@acme.test", "Acme");
  assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${id}`)).status, 409);
  assert.equal((await callApi(stack, alice, "DELETE", `/api/drafts/${id}`, { confirm: "aaaaaaaaaaaa" })).status, 409);

  const deleted = await json(["delete", id, "--yes"]);
  assert.equal(deleted.ok, true);
  assert.equal((await fetch(`${stack.baseUrl}/d/${id}`, { headers: { Authorization: `Bearer ${bob}` } })).status, 404);

  // Your own: as before, no flag.
  const mine = await json(["upload", writeHtml(stack.tmp, "mine.html", page("Mine to delete")), "--new"]);
  assert.equal((await json(["delete", mine.draftId])).ok, true);
  // A member who isn't an admin still can't delete someone else's (403, as before).
  const alices = await json(["upload", writeHtml(stack.tmp, "alices.html", page("Alice's")), "--new"]);
  assert.equal((await callApi(stack, bob, "DELETE", `/api/drafts/${alices.draftId}`, { confirm: alices.draftId })).status, 403);
});
