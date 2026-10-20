// Deploy everything: the ops Worker, then both Pages projects from one bundle.
//   bun run deploy:all                    -> production (branch main)
//   bun run deploy:all -- --branch staging -> staging (Pages preview env, htmlartifact-ops-staging)
import { $ } from "bun";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const flag = process.argv.indexOf("--branch");
const branch = flag > 0 ? process.argv[flag + 1]! : "main";
const production = branch === "main";
const wrangler = `${root}node_modules/.bin/wrangler`;

// R2 can bill past its free tier; the cap is that only the Worker can reach
// the bucket (README: Why R2 can't bill). Refuse to deploy over a bucket that
// is public through r2.dev or a custom domain.
const buckets = new Set(
  ["app", "usercontent", "ops"].flatMap((project) =>
    [...readFileSync(`${root}deploy/${project}/wrangler.toml`, "utf8").matchAll(/^bucket_name\s*=\s*"([^"]+)"/gm)].map((m) => m[1]!)
  )
);
for (const bucket of buckets) {
  const devUrl = await $`${wrangler} r2 bucket dev-url get ${bucket}`.quiet().text();
  const domains = await $`${wrangler} r2 bucket domain list ${bucket}`.quiet().text();
  if (!devUrl.includes("Public access via the r2.dev URL is disabled.") || !domains.includes("There are no custom domains connected to this bucket.")) {
    console.error(`R2 bucket ${bucket} must be private (no r2.dev URL, no custom domain):\n${devUrl}\n${domains}`);
    process.exit(1);
  }
}

await $`bun ${root}scripts/build-pages.ts`;
if (production) await $`${wrangler} deploy --env=`.cwd(`${root}deploy/ops`);
else await $`${wrangler} deploy --env staging`.cwd(`${root}deploy/ops`);
for (const project of ["app", "usercontent"]) {
  await $`${wrangler} pages deploy --branch ${branch} --commit-dirty=true`.cwd(`${root}deploy/${project}`);
}
