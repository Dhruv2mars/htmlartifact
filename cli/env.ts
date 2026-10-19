import os from "node:os";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };

// Single source of truth for the version: package.json (inlined in the bundle).
export const VERSION: string = pkg.version;

// The hosted htmlartifact service. Override with --api-url or HTMLARTIFACT_API_URL.
export const DEFAULT_API_URL: string | null = "https://htmlartifact.pages.dev";

export const HTMLARTIFACT_DIR = process.env.HTMLARTIFACT_HOME || path.join(os.homedir(), ".htmlartifact");
export const CONFIG_PATH = path.join(HTMLARTIFACT_DIR, "config.json");
export const CREDENTIALS_PATH = path.join(HTMLARTIFACT_DIR, "credentials.json");
export const DRAFT_BINDINGS_DIR = path.join(HTMLARTIFACT_DIR, "drafts");

export const USER_AGENT = `htmlartifact/${VERSION}`;

// CI: a WorkOS organization API key used instead of a saved sign-in.
export const envToken = (): string | undefined => process.env.HTMLARTIFACT_TOKEN || undefined;

// How to type this CLI again, for next-step hints: `npx htmlartifact` when it
// was run through npx (or bunx/pnpm dlx), so a pasted hint never fails with
// "command not found"; plain `htmlartifact` when it is installed.
const ranOnce =
  process.env.npm_command === "exec" || /[\\/](?:_npx|bunx-[^\\/]*|dlx-[^\\/]*)[\\/]/.test(process.argv[1] || "");
export const CMD: string = ranOnce ? "npx htmlartifact" : "htmlartifact";

// Server messages and fixed hints say `htmlartifact <command>`; say it the way
// this CLI was run.
export const withCmd = (text: string): string =>
  ranOnce ? text.replace(/(^|[\s(`'"])htmlartifact (?=(?:login|logout|whoami|workspace|upload|read|list|delete|check)\b)/g, "$1npx htmlartifact ") : text;
