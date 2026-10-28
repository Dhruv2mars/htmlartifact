// Shared by check, ship and release: the git state they act on, and whether
// `bun run check` already passed on a commit, here or in Buildkite (so ship and
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

// Buildkite runs the same gate on every push (.buildkite/pipeline.yml). With the
// bk CLI logged in, a build of this exact commit counts if its `check` job ran
// `bun run check` and passed outright (a soft failure does not count).
type Job = { step_key?: string; command?: string; state?: string; exit_status?: number; soft_failed?: boolean };
async function buildkitePass(sha: string) {
  const path = `/pipelines/htmlartifact/builds?commit=${sha}&state=passed`;
  const res = await $`bk api --no-pager --no-input --org dhruv2mars ${path}`.cwd(root).quiet().nothrow();
  try {
    const out = res.stdout.toString();
    const builds = res.exitCode === 0 ? (JSON.parse(out.slice(out.indexOf("["))) as { number: number; jobs: Job[] }[]) : [];
    const gated = builds.find((b) =>
      b.jobs.some((j) => j.step_key === "check" && j.command?.includes("bun run check") && j.state === "passed" && j.exit_status === 0 && !j.soft_failed)
    );
    return gated?.number ?? null;
  } catch {
    return null;
  }
}

// Runs the gate unless it already passed on this commit. check records a pass
// only if HEAD stayed on the commit with a clean tree the whole time, so a
// checkout that changed while it ran is refused rather than shipped.
export async function ensureChecked(sha: string) {
  if ((await lastPass()) === sha) return console.log(`bun run check already passed on ${sha.slice(0, 7)}`);
  const build = await buildkitePass(sha);
  if (build) return console.log(`bun run check passed on ${sha.slice(0, 7)} in Buildkite build #${build}`);
  await $`bun run check`.cwd(root);
  if ((await lastPass()) !== sha) throw new Error(`The checkout changed while bun run check ran on ${sha.slice(0, 7)}. Start again from a clean origin tip.`);
}
