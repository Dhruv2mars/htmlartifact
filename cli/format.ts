import { Console, Effect } from "effect";

import { formatBytes, formatIssue, validateUpload, type Issue } from "../src/html-policy.ts";
import { withCmd } from "./env.ts";
import type { UploadSource } from "./source.ts";
import type { Json } from "./state.ts";

// Straight to stdout: under --json, Console.log goes to stderr (see main.ts).
export const printJson = (value: unknown) =>
  Effect.sync(() => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  });

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export interface Receipt {
  ok: true;
  action: "created" | "updated" | "unchanged";
  draftId: string;
  slug: string | null;
  versionNumber: number;
  url: string;
  rawUrl: string;
  versionUrl: string;
  contentHash: string;
  totalBytes: number;
  account: string | null;
  workspace: string | null;
  pages: Array<{ path: string; url?: string }> | null;
  updateCommand: string;
  warnings: string[];
}

export const printReceipt = (receipt: Receipt) =>
  Effect.gen(function* () {
    const headline = {
      created: "Published",
      updated: "Published a new version",
      unchanged: `Unchanged: this content is already version ${receipt.versionNumber}`
    }[receipt.action];
    yield* Console.log(headline);
    yield* Console.log(`URL: ${receipt.url}`);
    yield* Console.log(`Raw HTML: ${receipt.rawUrl}`);
    if (receipt.versionUrl) yield* Console.log(`Version URL: ${receipt.versionUrl}`);
    yield* Console.log(`Artifact ID: ${receipt.draftId}`);
    yield* Console.log(`Version: ${receipt.versionNumber}`);
    if (receipt.pages) yield* Console.log(`Pages: ${receipt.pages.map((page) => page.path).join(", ")}`);
    yield* Console.log(`Workspace: ${receipt.workspace} (members only)`);
    yield* Console.log(`Update: ${receipt.updateCommand}`);
    for (const warning of receipt.warnings) {
      yield* Console.warn(`Warning: ${warning}`);
    }
  });

// The markup rules, checked locally with parse5: exact line and column for
// every issue. The server checks again (with the account's limits) on upload.
export function validateLocally(source: UploadSource) {
  return validateUpload(source.body.files || [{ path: "index.html", html: source.body.html }]);
}

// Fallback for `check` when offline or signed out: the bundled validator
// knows the markup rules, but not the account, its limits, or whether scripts
// are allowed. Signed out, a page that passes is ready as far as can be told.
export function offlineReport(
  source: UploadSource | null,
  why: { networkError: string; signedOut?: undefined } | { signedOut: string; networkError?: undefined }
): Json {
  const validation = source ? validateLocally(source) : null;
  return {
    ok: why.signedOut !== undefined && validation !== null && validation.ok,
    offline: true,
    ...why,
    ...(validation && {
      markupOk: validation.ok,
      totalBytes: validation.totalBytes,
      pages: validation.pages.map((page) => ({ path: page.path, bytes: page.bytes, title: page.title, hasScripts: page.hasScripts })),
      issues: validation.issues,
      errors: validation.errors,
      warnings: validation.warnings
    })
  };
}

export const printCheckReport = (report: Json) =>
  Effect.gen(function* () {
    yield* Console.log(`htmlartifact ${report.cliVersion} -> ${report.apiUrl}`);
    if (report.signedOut) {
      yield* Console.log(withCmd(report.signedOut));
      yield* Console.log("Checked markup locally. Account and limits were not checked.");
    } else if (report.offline) {
      yield* Console.log(`Offline: ${report.networkError}`);
      yield* Console.log("Checked markup locally. Account and limits were not checked.");
    } else if (report.limits) {
      yield* Console.log(`Account: ${report.account?.name}`);
      yield* Console.log(`Workspace: ${report.workspace?.name}`);
      yield* Console.log(`Limit: ${formatBytes(report.limits.maxBytes)} per upload, ${report.limits.maxPages} page(s)`);
    }
    if (report.slug) {
      yield* Console.log(
        `Custom URL "${report.slug.slug}": ${report.slug.status}${report.slug.message ? `. ${report.slug.message}` : ""}`
      );
    }
    if (report.path && report.pages) {
      const count = `${report.pages.length} page${report.pages.length === 1 ? "" : "s"}`;
      yield* Console.log(`\n${report.path} (${count}, ${formatBytes(report.totalBytes)})`);
    }
    for (const issue of (report.issues || []) as Issue[]) {
      yield* Console.log(`${issue.level === "error" ? "Error" : "Warning"}: ${formatIssue(issue)}`);
    }
    if (!report.issues) {
      for (const error of report.errors || []) yield* Console.log(`Error: ${error}`);
    }
    yield* Console.log(report.ok ? "\nReady." : "\nNot ready.");
  });

export function timeAgo(value: unknown): string {
  if (!value) return "unknown";
  const then = new Date(value as string).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units: Array<[string, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [name, secs] of units) {
    const amount = Math.floor(seconds / secs);
    if (amount >= 1) return `${amount} ${name}${amount === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
