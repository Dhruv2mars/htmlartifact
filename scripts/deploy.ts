// Deploy everything: the ops Worker, then both Pages projects from one bundle.
//   bun run deploy:all                    -> production (branch main)
//   bun run deploy:all -- --branch staging -> staging (Pages preview env, htmlartifact-ops-staging)
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
const flag = process.argv.indexOf("--branch");
const branch = flag > 0 ? process.argv[flag + 1]! : "main";
const production = branch === "main";
const wrangler = `${root}node_modules/.bin/wrangler`;
// Tags the ops Worker version with the commit, as Pages records it for its deployments.
const commit = (await $`git rev-parse --short HEAD`.cwd(root).quiet().text()).trim();

await $`bun ${root}scripts/build-pages.ts`;
const version = ["--tag", commit, "--message", `${branch} ${commit}`];
if (production) await $`${wrangler} deploy --env= ${version}`.cwd(`${root}deploy/ops`);
else await $`${wrangler} deploy --env staging ${version}`.cwd(`${root}deploy/ops`);
for (const project of ["app", "usercontent"]) {
  await $`${wrangler} pages deploy --no-bundle --branch ${branch} --commit-dirty=true`.cwd(`${root}deploy/${project}`);
}
