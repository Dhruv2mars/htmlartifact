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
