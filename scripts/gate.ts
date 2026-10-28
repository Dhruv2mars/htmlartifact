// Shared by check, ship and release: the git state they act on, and the record
// of the last commit `bun run check` passed on (so ship and release don't run
// the whole gate again for a commit that already passed it).
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
const passed = `${root}node_modules/.cache/htmlartifact/check-passed`;

export const head = async () => (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim();
export const clean = async () => (await $`git status --porcelain`.cwd(root).quiet().text()).trim() === "";

// HEAD must be exactly what origin has for this branch, with nothing uncommitted:
// what gets deployed or published is what everyone else sees on that branch.
export async function requireOriginTip(branch: string) {
  const remote = (await $`git ls-remote origin refs/heads/${branch}`.cwd(root).quiet().text()).split("\t")[0]?.trim();
  if (!remote) throw new Error(`origin has no branch ${branch}.`);
  const sha = await head();
  if (sha !== remote) {
    throw new Error(
      `HEAD is ${sha.slice(0, 7)} but origin/${branch} is ${remote.slice(0, 7)}. Run: git fetch origin && git switch --detach origin/${branch}`
    );
  }
  if (!(await clean())) throw new Error("The working tree has uncommitted changes (git status). Commit or remove them first.");
  return sha;
}

export const recordPass = (sha: string) => Bun.write(passed, `${sha}\n`);
const lastPass = async () => (await Bun.file(passed).text().catch(() => "")).trim();

// Runs the gate unless it already passed on this commit. check records a pass
// only if HEAD stayed on the commit with a clean tree the whole time, so a
// checkout that changed while it ran is refused rather than shipped.
export async function ensureChecked(sha: string) {
  if ((await lastPass()) === sha) return console.log(`bun run check already passed on ${sha.slice(0, 7)}`);
  await $`bun run check`.cwd(root);
  if ((await lastPass()) !== sha) throw new Error(`The checkout changed while bun run check ran on ${sha.slice(0, 7)}. Start again from a clean origin tip.`);
}
