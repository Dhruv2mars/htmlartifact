// Writes THIRD_PARTY_LICENSES for the npm package: the licence of every
// package bundled into dist/htmlartifact.js, found from the build's
// metafile, so the notices always match what actually ships.
//   bun scripts/third-party-licenses.ts <metafile> <out>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [metafile, out] = process.argv.slice(2);
if (!metafile || !out) throw new Error("usage: bun scripts/third-party-licenses.ts <metafile> <out>");

const meta = JSON.parse(readFileSync(metafile, "utf8")) as { inputs: Record<string, unknown> };
// Input paths are relative to the working directory the build ran in.
const packageDirs = new Set<string>();
for (const input of Object.keys(meta.inputs)) {
  const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  if (match) packageDirs.add(resolve(match[1]!));
}

const sections = [...packageDirs]
  .map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license?: string;
      repository?: string | { url?: string };
    };
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
    if (!file) throw new Error(`${pkg.name}: no licence file in ${dir}`);
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    const header = [`${pkg.name}@${pkg.version}`, `License: ${pkg.license ?? "see below"}`, repo ? `Repository: ${repo}` : null]
      .filter(Boolean)
      .join("\n");
    return { name: pkg.name, text: `${header}\n\n${readFileSync(join(dir, file), "utf8").trim()}\n` };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

if (!sections.length) throw new Error("no bundled packages found in the metafile");
if (!existsSync(dirname(out))) throw new Error(`${dirname(out)} does not exist`);
const rule = `\n${"-".repeat(72)}\n\n`;
writeFileSync(
  out,
  `THIRD-PARTY SOFTWARE NOTICES\n\ndist/htmlartifact.js bundles the following packages. Their licences follow.\n${rule}${sections.map((s) => s.text).join(rule)}`
);
console.log(`${out}: ${sections.map((s) => s.name).join(", ")}`);
