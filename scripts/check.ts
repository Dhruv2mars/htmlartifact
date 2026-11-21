// The merge gate: everything CI on GitHub Actions used to run, in one command.
//   bun run check                 -> every step, in order
//   bun run check -- --part static -> everything but the suites
//   bun run check -- --part d1     -> the suite on D1 (or r2)
//   bun run check -- --part d1 --shard 2/3 -> one shard of it
// CI runs the parts side by side on every mirrored push (.github/workflows/ci.yml):
// together they are exactly the whole gate.
// Stops at the first failure. Then the built CLI runs on this machine's Node and
// on the oldest Node package.json supports (engines), downloaded once from
// nodejs.org and checked against its SHASUMS256.txt. On a clean tree it records
// the commit it passed on, which `bun run ship` and `bun run release` accept.
import { $ } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clean, head, recordPass } from "./gate.ts";

const root = new URL("..", import.meta.url).pathname;
const cache = `${root}node_modules/.cache/htmlartifact`;
const pkg = await Bun.file(`${root}package.json`).json();
const oldest = pkg.engines.node.replace(/^>=\s*/, "").split(".").concat("0", "0").slice(0, 3).join(".");
const current = (await $`node --version`.quiet().text()).trim().replace(/^v/, "");

type Step = [string, () => Promise<void>];

async function run(...cmd: string[]) {
  const code = await Bun.spawn(cmd, { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}`);
}

// The CLI as a user runs it: version, help, and an offline check of a two-page site.
async function cli(node: string) {
  const dir = await mkdtemp(join(tmpdir(), "htmlartifact-check-"));
  try {
    const env = { ...process.env, HTMLARTIFACT_HOME: join(dir, "home") };
    const htmlartifact = (...args: string[]) => $`${node} ${root}dist/htmlartifact.js ${args}`.cwd(dir).env(env).quiet().text();
    const version = (await htmlartifact("--version")).trim();
    if (version !== pkg.version) throw new Error(`--version printed ${version}, want ${pkg.version}`);
    if (!(await htmlartifact("--help")).includes("upload")) throw new Error("--help does not mention upload");
    await mkdir(join(dir, "site/docs"), { recursive: true });
    await Bun.write(join(dir, "site/index.html"), '<!doctype html><title>Home</title><a href="docs/notes.html">notes</a>');
    await Bun.write(join(dir, "site/docs/notes.html"), "<!doctype html><title>Notes</title><p>notes</p>");
    const report = await htmlartifact("check", "site");
    process.stdout.write(report);
    if (!report.includes("2 pages")) throw new Error('check site did not report "2 pages"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function oldestNode() {
  const os = { darwin: "darwin", linux: "linux" }[process.platform as string];
  const arch = { arm64: "arm64", x64: "x64" }[process.arch as string];
  if (!os || !arch) throw new Error(`no Node ${oldest} download for ${process.platform}-${process.arch}; run the check on macOS or Linux`);
  const name = `node-v${oldest}-${os}-${arch}`;
  const node = `${cache}/${name}/bin/node`;
  if (await Bun.file(node).exists()) return node;
  const base = `https://nodejs.org/dist/v${oldest}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums.split("\n").find((line) => line.endsWith(`  ${name}.tar.gz`))?.split(" ")[0];
  const res = await fetch(`${base}/${name}.tar.gz`);
  if (!want || !res.ok) throw new Error(`could not download ${name}.tar.gz (${res.status})`);
  const tarball = new Uint8Array(await res.arrayBuffer());
  const got = new Bun.CryptoHasher("sha256").update(tarball).digest("hex");
  if (got !== want) throw new Error(`${name}.tar.gz: sha256 ${got}, SHASUMS256.txt says ${want}`);
  await mkdir(cache, { recursive: true });
  await Bun.write(`${cache}/${name}.tar.gz`, tarball);
  await $`tar -xzf ${name}.tar.gz && rm ${name}.tar.gz`.cwd(cache);
  return node;
}

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const shardArg = arg("--shard");
if (shardArg !== null && !/^[1-9]\d*\/[1-9]\d*$/.test(shardArg)) throw new Error(`--shard ${shardArg}: want N/M, e.g. 2/3`);

// One suite (D1 or R2 storage), or one shard of it (--shard N/M).
function suite(storage: "d1" | "r2") {
  const shard = shardArg ? [`--test-shard=${shardArg}`] : [];
  return () =>
    run("env", `HTMLARTIFACT_TEST_STORAGE=${storage}`, "node", "--test", "--test-concurrency=1", "--test-timeout=120000", ...shard, "test/*.test.js");
}

const install: Step = ["install", () => run("bun", "install", "--frozen-lockfile")];
const build: Step = ["build", () => run("bun", "run", "pretest")];
const parts: Record<string, Step[]> = {
  static: [
    install,
    ["typecheck", () => run("bun", "run", "typecheck")],
    ["typecheck:cli", () => run("bun", "run", "typecheck:cli")],
    ["typecheck:web", () => run("bun", "run", "typecheck:web")],
    // knip under Node ran out of memory in a 4 GB CI container (oxc-parser), not under Bun.
    ["lint", () => run("bun", "--bun", "run", "lint")],
    ["changelog", () => run("bun", "scripts/changelog.ts", "check")],
    build,
    [`cli on node ${current}`, () => cli("node")],
    [`cli on node ${oldest}`, async () => cli(await oldestNode())]
  ],
  d1: [install, build, ["test on D1", suite("d1")]],
  r2: [install, build, ["test on R2", suite("r2")]]
};
const part = arg("--part");
if (shardArg !== null && part !== "d1" && part !== "r2") throw new Error("--shard needs --part d1 or --part r2");
if (part !== null && !(part in parts)) throw new Error(`--part ${part}: want one of ${Object.keys(parts).join(", ")}`);
// The whole gate: the static steps, then the suite on D1, then on R2.
const steps = part ? parts[part] : [...parts.static, ["test on D1", suite("d1")] as Step, ["test on R2", suite("r2")] as Step];

// A CI container may have no usable git checkout; then there is nothing to record.
const sha = await head().catch(() => "");
const wasClean = sha !== "" && (await clean());
const started = performance.now();
const seconds = (since: number) => `${Math.round((performance.now() - since) / 1000)}s`;
for (const [name, step] of steps) {
  console.log(`\n▶ ${name}`);
  const t = performance.now();
  try {
    await step();
  } catch (error) {
    console.error(`\n✗ check failed at "${name}" after ${seconds(started)}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  console.log(`✓ ${name} (${seconds(t)})`);
}
const recorded = !part && wasClean && (await clean()) && (await head()) === sha;
if (recorded) await recordPass(sha);
console.log(
  `\n✓ check${part ? ` --part ${part}` : ""} passed: ${steps.length} steps in ${seconds(started)} on ${sha.slice(0, 7) || "this tree"}${recorded || !sha ? "" : " plus uncommitted changes"}`
);
