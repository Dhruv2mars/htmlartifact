import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";

import { CREDENTIALS_PATH, DRAFT_BINDINGS_DIR, HTMLARTIFACT_DIR } from "./env.ts";
import { attempt, reason, type FileError, type CliError } from "./errors.ts";

// Loosely typed JSON from disk or the server.
export type Json = { [key: string]: any };

export interface Session {
  apiUrl: string;
  accessToken: string;
  refreshToken: string;
  organizationId: string | null;
  email: string | null;
  updatedAt: string;
}

export interface DraftMapping {
  draftId: string;
  slug: string | null;
  publicUrl: string;
  rawUrl: string;
  latestVersionNumber: number;
  apiUrl?: string;
  file?: string;
  updatedAt?: string;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Reads a JSON file, or `fallback` when it is missing or unreadable.
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Writes through a temp file and rename, so a crash or a concurrent CLI run
// never leaves half-written JSON behind.
export const writeJson = (file: string, value: unknown, mode = 0o600): Effect.Effect<void, CliError | FileError> =>
  attempt(() => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  });

// Reads a JSON state file, or null when it does not exist. A corrupt file is
// moved aside, not silently reset, so it can still be recovered by hand.
export const readStateJson = <T>(file: string): Effect.Effect<T | null, CliError | FileError> =>
  attempt(() => {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Warning: could not read ${file}: ${reason(error)}`);
      }
      return null;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      const aside = `${file}.corrupt-${Date.now()}`;
      fs.renameSync(file, aside);
      console.error(`Warning: ${file} was not valid JSON. Moved it to ${aside}.`);
      return null;
    }
  });

export const saveSession = (apiUrl: string, tokens: Json): Effect.Effect<Session, CliError | FileError> => {
  const session: Session = {
    apiUrl,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    organizationId: tokens.organization_id || null,
    email: tokens.user?.email || null,
    updatedAt: new Date().toISOString()
  };
  return attempt(() => fs.mkdirSync(HTMLARTIFACT_DIR, { recursive: true, mode: 0o700 })).pipe(
    Effect.andThen(writeJson(CREDENTIALS_PATH, session, 0o600)),
    Effect.as(session)
  );
};

export const removeCredentials = attempt(() => fs.rmSync(CREDENTIALS_PATH, { force: true }));

// Each (API URL, path) binding is its own file, so concurrent uploads and
// uploads to different APIs never rewrite each other's mappings.
function draftBindingPath(apiUrl: string, file: string): string {
  return path.join(DRAFT_BINDINGS_DIR, `${sha256(`${apiUrl}\n${file}`)}.json`);
}

// Finds the draft a path was last published to on this API.
export const findDraftMapping = (apiUrl: string, file: string) =>
  readStateJson<DraftMapping>(draftBindingPath(apiUrl, file));

export const saveDraftMapping = (apiUrl: string, file: string, entry: DraftMapping) =>
  writeJson(draftBindingPath(apiUrl, file), { ...entry, apiUrl, file, updatedAt: new Date().toISOString() });

// Forgets every local path that was published to `draftId` on this API.
// Returns how many mappings were removed.
export const removeDraftMappings = (apiUrl: string, draftId: string): Effect.Effect<number, CliError | FileError> =>
  attempt(() => {
    let names: string[];
    try {
      names = fs.readdirSync(DRAFT_BINDINGS_DIR);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(DRAFT_BINDINGS_DIR, name);
      const entry = readJson<Partial<DraftMapping> | null>(file, null);
      if (entry?.apiUrl === apiUrl && entry.draftId === draftId) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    }
    return removed;
  });
