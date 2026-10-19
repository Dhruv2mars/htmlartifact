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
const writeJson = (file: string, value: unknown, mode = 0o600): Effect.Effect<void, CliError | FileError> =>
  attempt(() => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
    fs.chmodSync(temp, mode);
    // Windows refuses to replace a file another process has open for a moment
    // (EPERM/EBUSY/EACCES): retry briefly rather than lose a rotated token.
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(temp, file);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 20 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  });

// Reads a JSON state file, or null when it does not exist. A corrupt file is
// moved aside, not silently reset, so it can still be recovered by hand.
const readStateJson = <T>(file: string): Effect.Effect<T | null, CliError | FileError> =>
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

// Refresh tokens are single-use: concurrent CLI runs (parallel agent
// commands) take turns refreshing through this lock file, and each re-reads
// the credentials once it holds the lock. Best-effort: a lock older than
// LOCK_STALE_MS is taken over (its holder crashed), and after LOCK_WAIT_MS
// the run goes ahead without it rather than hang.
const LOCK_PATH = `${CREDENTIALS_PATH}.lock`;
const LOCK_WAIT_MS = 15_000;
// Longer than the longest a live refresh can hold it (a 30 s request, or
// three retries of up to 20 s), so a slow holder is never taken over.
const LOCK_STALE_MS = 120_000;

function tryLock(): boolean {
  try {
    fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(LOCK_PATH, "wx", 0o600);
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
    try {
      if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) fs.rmSync(LOCK_PATH, { force: true });
    } catch {
      // Released meanwhile: the next try takes it.
    }
    return false;
  }
}

const acquireLock = Effect.gen(function* () {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    if (tryLock()) return true;
    yield* Effect.sleep(50 + Math.floor(Math.random() * 100));
  }
  return false;
});

const releaseLock = (held: boolean) =>
  Effect.sync(() => {
    if (!held) return;
    try {
      if (fs.readFileSync(LOCK_PATH, "utf8") === String(process.pid)) fs.rmSync(LOCK_PATH, { force: true });
    } catch {
      // Already gone.
    }
  });

export const withCredentialsLock = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(acquireLock, () => effect, releaseLock);

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
