import pkg from "../package.json" with { type: "json" };

// The CLI says its version in its User-Agent: "htmlartifact/<version>"
// (cli/env.ts). Uploads from a CLI older than this server's own version get a
// `cli_outdated` notice; older than the floor, they are refused (`cli_too_old`):
// those CLIs miss fixes that keep a publish on the right artifact. The
// header can be spoofed, so this only steers honest clients; other clients
// (no such User-Agent) are not checked.

// The version this server was built with: the newest CLI it knows.
export const LATEST_CLI_VERSION: string = pkg.version;

// The oldest CLI that may upload (HTMLARTIFACT_MIN_CLI_VERSION overrides it).
// Before 0.2.1, `upload --slug` did not name the artifact it expected, so a
// slug renamed and reused elsewhere was silently overwritten (CHANGELOG: 0.2.1).
export const MIN_CLI_VERSION = "0.2.1";

/** The CLI version in a User-Agent, or null when it isn't htmlartifact's CLI. */
export function cliVersion(userAgent: string | undefined): string | null {
  const match = /^htmlartifact\/(\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?)(?:\s|$)/.exec(userAgent || "");
  return match ? match[1]! : null;
}

/** Semver order of two x.y.z[-pre] versions (a pre-release sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [core = "", pre] = version.split(/-(.*)/s);
    return { parts: core.split(".").map(Number), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
