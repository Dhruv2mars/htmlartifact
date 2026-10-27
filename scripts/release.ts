// Publish the CLI to npm from this checkout (GitHub Actions used to, with npm
// provenance; a local publish has none, see CONTRIBUTING.md → Releasing):
//   bun run release              -> publish package.json's version, then tag vX.Y.Z on origin
//   bun run release -- --dry-run -> the same steps from any commit, but `npm publish --dry-run`
//                                   and no tag
// Publishes only exactly origin/main with a clean tree, and only a version npm
// does not have yet. Needs `npm login` as an owner of the package; npm asks for
// the 2FA code. Tag = package.json = npm version.
import { $ } from "bun";
import { ensureChecked, head, requireOriginTip } from "./gate.ts";

const root = new URL("..", import.meta.url).pathname;
const dryRun = process.argv.includes("--dry-run");
const { name, version } = await Bun.file(`${root}package.json`).json();
const tag = `v${version}`;
const sha = dryRun ? await head() : await requireOriginTip("main");

const view = await $`npm view ${`${name}@${version}`} gitHead --json`.cwd(root).quiet().nothrow();
if (view.exitCode !== 0 && !view.stderr.toString().includes("E404")) throw new Error(`npm view failed:\n${view.stderr}`);

if (view.exitCode === 0) {
  // Already on npm: only make sure the tag exists, on the commit npm says it was built from.
  const tagged = (await $`git ls-remote --tags origin refs/tags/${tag}`.cwd(root).quiet().text()).trim();
  if (tagged) {
    console.log(`${name}@${version} is on npm and ${tag} is on origin: nothing to release.`);
    process.exit(0);
  }
  const gitHead = JSON.parse(view.stdout.toString() || '""') as string;
  if (!gitHead) throw new Error(`npm has no gitHead for ${version}. Tag the commit it was built from: git push origin <sha>:refs/tags/${tag}`);
  if (dryRun) console.log(`${name}@${version} is on npm; a real run tags ${tag} on ${gitHead.slice(0, 7)}.`);
  else await $`git push origin ${`${gitHead}:refs/tags/${tag}`}`.cwd(root);
  process.exit(0);
}

if (!dryRun && (await $`npm whoami`.cwd(root).quiet().nothrow()).exitCode !== 0) {
  throw new Error("npm is not logged in: run `npm login` as an owner of the package first.");
}
await ensureChecked(sha);
if (!dryRun && (await requireOriginTip("main")) !== sha) throw new Error("origin/main moved while the gate ran; start again.");
// prepublishOnly rebuilds dist/ and THIRD_PARTY_LICENSES. npm asks for the 2FA
// code only when its stdin and stdout are a terminal, so it inherits them.
const publish = Bun.spawn(["npm", "publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])], {
  cwd: root,
  stdio: ["inherit", "inherit", "inherit"],
});
if ((await publish.exited) !== 0) throw new Error("npm publish failed; nothing was tagged.");
if (dryRun) {
  console.log(`\n✓ dry run: a real run publishes ${name}@${version} from ${sha.slice(0, 7)} and tags ${tag}.`);
  process.exit(0);
}
// Pushed straight from the commit: no local tag to get in the way of a retry.
await $`git push origin ${`${sha}:refs/tags/${tag}`}`.cwd(root);
console.log(`\n✓ released ${name}@${version}, ${tag} on ${sha.slice(0, 7)}. Notes: bun scripts/changelog.ts notes ${version}`);
