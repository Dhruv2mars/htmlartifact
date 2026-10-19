// Bundle the Worker into a single _worker.js for Cloudflare Pages advanced mode.
// Both Pages projects (htmlartifact, htmlartifact-usercontent) deploy the same
// bundle; each gets a copy in deploy/<project>/dist next to its wrangler.toml
// (wrangler finds a Pages config by walking up from the _worker.js).
// The app project also gets the web app's static assets (web/build/client),
// served by Pages directly: _routes.json keeps /assets/* off the Worker.
import { $ } from "bun";
import { cp, mkdir, readdir, rm } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const entry = process.argv[2] ?? `${root}src/index.ts`;

await $`bun run build:web`.cwd(root);

const result = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  format: "esm",
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*", "cloudflare:*"],
  loader: { ".svg": "text" },
  minify: { syntax: true, whitespace: false, identifiers: false },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const code = await result.outputs[0]!.text();

for (const project of ["app", "usercontent"]) {
  const out = `${root}deploy/${project}/dist`;
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await Bun.write(`${out}/_worker.js`, code);
  const app = project === "app";
  // Everything in web/build/client is served by Pages, not the Worker:
  // hashed /assets/* plus top-level public files such as og.png.
  const files = app ? (await readdir(`${root}web/build/client`)).filter((f) => f !== "assets" && !f.startsWith(".")) : [];
  if (app) {
    await cp(`${root}web/build/client`, out, { recursive: true, filter: (path) => !path.includes("/.vite") });
    await Bun.write(`${out}/_headers`, "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
  }
  await Bun.write(
    `${out}/_routes.json`,
    JSON.stringify({ version: 1, include: ["/*"], exclude: app ? ["/assets/*", ...files.map((f) => `/${f}`)] : [] })
  );
}
console.log(`built _worker.js (${(code.length / 1024).toFixed(0)} KiB) for app and usercontent`);
