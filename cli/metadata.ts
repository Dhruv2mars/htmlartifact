import { execFileSync } from "node:child_process";
import path from "node:path";

// `files`: the uploaded pages, relative to `cwd`. The commit fields describe
// them, not the repository: a version's label on the history page is its
// commit subject, and HEAD's message says nothing about a file it doesn't
// contain. Committed as uploaded: the last commit that changed them.
// Otherwise (changed, untracked or ignored): HEAD as the base they were made
// on, no subject, and dirty.
export function collectGitMetadata(cwd: string, files: string[]) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const parsedRemote = parseRemote(remote);
  const head = git(["rev-parse", "HEAD"], cwd);
  // Paths are literal (a page named ":x.html" is not pathspec magic).
  const tracked = repoRoot !== null && git(["--literal-pathspecs", "ls-files", "--error-unmatch", "--", ...files], cwd) !== null;
  const changed = tracked ? git(["--literal-pathspecs", "status", "--porcelain", "--", ...files], cwd) : null;
  const clean = head !== null && changed === "";
  const last = clean ? git(["--literal-pathspecs", "log", "-1", "--format=%H%n%s", "--", ...files], cwd)?.split("\n") : undefined;

  return {
    repoOrg: parsedRemote.org || inferOrgFromRoot(repoRoot),
    repoName: parsedRemote.name || (repoRoot ? path.basename(repoRoot) : null),
    repoHost: parsedRemote.host || null,
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitCommitSha: last?.[0] || head,
    gitCommitSubject: last?.[1] ?? null,
    // null when not a git repo; otherwise whether the uploaded files differ from what is committed.
    gitDirty: repoRoot === null ? null : !clean
  };
}

// Best-effort CI provenance. GitHub Actions is detected precisely (with a run
// URL); other CI systems are flagged generically. Nothing here is trusted for
// authorization — it is metadata for the dashboard and audit trail only.
export function collectCiMetadata(): Record<string, string | null> {
  const env = process.env;
  if (env.GITHUB_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      ciProvider: "github_actions",
      ciRunUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
      ciActor: env.GITHUB_ACTOR || null
    };
  }
  if (env.CI) {
    return { ciProvider: "unknown" };
  }
  return {};
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

interface Remote {
  host?: string;
  org?: string;
  name?: string;
}

function parseRemote(remote: string | null): Remote {
  if (!remote) return {};

  const cleaned = remote.replace(/\.git$/, "");
  const sshMatch = cleaned.match(/^[^@]+@([^:]+):([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { host: sshMatch[1], org: sshMatch[2], name: path.basename(sshMatch[3] ?? "") };
  }

  try {
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { host: url.hostname, org: parts[0], name: parts.at(-1) };
    }
  } catch {
    // Fall through to path parsing.
  }

  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { org: parts.at(-2), name: parts.at(-1) };
  }

  return {};
}

function inferOrgFromRoot(repoRoot: string | null): string | null {
  if (!repoRoot) return null;
  return path.basename(path.dirname(repoRoot));
}
