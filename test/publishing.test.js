import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { accessToken, callApi, page, startStack, writeHtml } from "./helpers.js";

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
  const token = await accessToken(stack, "bob@acme.test");
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
