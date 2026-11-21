// Shared by check, ship and release: the git state they act on, and whether
// `bun run check` already passed on a commit, here or in CI on GitHub Actions (so ship and
// release don't run the whole gate again for a commit that passed it).
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

// GitHub Actions runs the same gate on every mirrored push (.github/workflows/ci.yml,
// named CI), in parts side by side. With the gh CLI logged in, a CI run of this
// exact commit counts if it succeeded and its jobs covered every part
// (static, d1, r2) and all succeeded.
const GITHUB_REPO = "Dhruv2mars/htmlartifact";
const PARTS = ["static", "d1", "r2"];
type Run = { databaseId: number; conclusion: string };
type Job = { name: string; conclusion: string };
async function ciPass(sha: string) {
  const json = async (...args: string[]) => {
    const res = await $`gh ${args}`.cwd(root).quiet().nothrow();
    return res.exitCode === 0 ? JSON.parse(res.stdout.toString()) : null;
  };
  try {
    const runs: Run[] = (await json("run", "list", "-R", GITHUB_REPO, "-w", "ci.yml", "-c", sha, "--json", "databaseId,conclusion")) ?? [];
    for (const run of runs.filter((r) => r.conclusion === "success")) {
      const jobs: Job[] = (await json("run", "view", String(run.databaseId), "-R", GITHUB_REPO, "--json", "jobs"))?.jobs ?? [];
      const gated = PARTS.every((part) => jobs.some((j) => j.name.startsWith(`check (${part}`)));
      if (gated && jobs.every((j) => j.conclusion === "success")) return run.databaseId;
    }
  } catch {}
  return null;
}

// Runs the gate unless it already passed on this commit. check records a pass
// only if HEAD stayed on the commit with a clean tree the whole time, so a
// checkout that changed while it ran is refused rather than shipped.
export async function ensureChecked(sha: string) {
  if ((await lastPass()) === sha) return console.log(`bun run check already passed on ${sha.slice(0, 7)}`);
  const run = await ciPass(sha);
  if (run) return console.log(`bun run check passed on ${sha.slice(0, 7)} in CI run ${run} (GitHub Actions)`);
  await $`bun run check`.cwd(root);
  if ((await lastPass()) !== sha) throw new Error(`The checkout changed while bun run check ran on ${sha.slice(0, 7)}. Start again from a clean origin tip.`);
}
