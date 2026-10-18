// Bundle the Worker into a single _worker.js for Cloudflare Pages advanced mode.
// Both Pages projects (htmlartifact, htmlartifact-usercontent) deploy the same
// bundle; each gets a copy in deploy/<project>/dist next to its wrangler.toml
// (wrangler finds a Pages config by walking up from the _worker.js).
import { mkdir, rm } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const entry = process.argv[2] ?? `${root}src/index.ts`;

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
  await Bun.write(`${out}/_routes.json`, JSON.stringify({ version: 1, include: ["/*"], exclude: [] }));
}
console.log(`built _worker.js (${(code.length / 1024).toFixed(0)} KiB) for app and usercontent`);
