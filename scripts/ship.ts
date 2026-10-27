// Deploy from this checkout (GitHub Actions used to, after CI passed):
//   bun run ship              -> origin/main to production (deploy/app/wrangler.toml [vars])
//   bun run ship -- --staging -> origin/staging to staging ([env.preview.vars])
// HEAD must be exactly origin/<branch> with a clean tree. Runs `bun run check`
// unless it already passed on this commit, then deploy:all and smoke.
// Cloudflare credentials: `bunx wrangler login`, or CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID in the environment.
import { $ } from "bun";
import { deployment } from "./deployment.ts";
import { ensureChecked, requireOriginTip } from "./gate.ts";

const root = new URL("..", import.meta.url).pathname;
const staging = process.argv.includes("--staging");
const branch = staging ? "staging" : "main";
const { appProject } = await deployment(staging);

const sha = await requireOriginTip(branch);
// Also proves the Cloudflare credentials work before the long check runs.
const listing = await $`${root}node_modules/.bin/wrangler pages deployment list --project-name ${appProject} --environment ${staging ? "preview" : "production"} --json`
  .cwd(root)
  .quiet()
  .nothrow();
if (listing.exitCode !== 0) {
  throw new Error(`wrangler could not list ${appProject} deployments. Log in with \`bunx wrangler login\` or set CLOUDFLARE_API_TOKEN.\n${listing.stderr}`);
}
const live = (JSON.parse(listing.stdout.toString()) as { Branch: string; Source: string }[]).find((d) => d.Branch === branch);
console.log(`${branch}: live ${live?.Source ?? "nothing"}, shipping ${sha.slice(0, 7)}`);

await ensureChecked(sha);
await $`bun run deploy:all -- --branch ${branch}`.cwd(root);
await $`bun run smoke ${staging ? ["--", "--staging"] : []}`.cwd(root);
console.log(`\n✓ shipped ${sha.slice(0, 7)} to ${staging ? "staging" : "production"}`);
