import { Console, Duration, Effect } from "effect";

import { CONFIG_PATH, CREDENTIALS_PATH, DEFAULT_API_URL, envToken } from "./env.ts";
import { CliError } from "./errors.ts";
import { shellQuote } from "./format.ts";
import { postJson, type JsonResult } from "./http.ts";
import { ask } from "./prompt.ts";
import {
  readJson,
  removePendingLogin,
  savePendingLogin,
  saveSession,
  withCredentialsLock,
  type Json,
  type PendingLogin,
  type Session
} from "./state.ts";

interface Auth {
  apiUrl: string;
  apiKey: string;
}

export const resolveApiUrl = (override?: string): Effect.Effect<string, CliError> =>
  Effect.suspend(() => {
    const config = readJson<Json>(CONFIG_PATH, {});
    const credentials = readJson<Json>(CREDENTIALS_PATH, {});
    const apiUrl: string | null =
      override || process.env.HTMLARTIFACT_API_URL || credentials.apiUrl || config.apiUrl || DEFAULT_API_URL;
    if (!apiUrl) {
      return Effect.fail(
        new CliError({ kind: "usage", message: "No htmlartifact server configured. Run: htmlartifact login --api-url https://<your-server>" })
      );
    }
    return Effect.succeed(apiUrl.replace(/\/+$/, ""));
  });

export function tokenExpiresAt(token: unknown): number {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] ?? "", "base64url").toString("utf8"));
    return Number(payload.exp) * 1000 || 0;
  } catch {
    return 0;
  }
}

// A refresh the server rate-limited (429) or could not serve (503) is retried
// this many times, waiting Retry-After (capped) or 1s, 2s, 4s between tries.
const REFRESH_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 20;

const requestRefresh = (apiUrl: string, refreshToken: string | undefined, organizationId: string | undefined) =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt += 1) {
      const result = yield* postJson(`${apiUrl}/api/cli/token`, {
        refresh_token: refreshToken,
        ...(organizationId ? { organization_id: organizationId } : {})
      });
      if ((result.status !== 429 && result.status !== 503) || attempt >= REFRESH_RETRIES) return result;
      const wait = Math.min(MAX_RETRY_WAIT_SECONDS, result.retryAfter ?? 2 ** attempt);
      yield* Effect.sleep(Duration.seconds(Math.max(wait, 0.1)));
    }
  });

// WorkOS refused the refresh token itself: used, revoked or expired.
const isSpent = (result: JsonResult) => result.body.error === "invalid_grant" || result.status === 401;

// A saved sign-in newer than `than` (another CLI run refreshed meanwhile), or null.
function newerSession(than: Partial<Session>): Session | null {
  const saved = readJson<Session | null>(CREDENTIALS_PATH, null);
  if (!saved?.refreshToken || saved.apiUrl !== than.apiUrl || saved.refreshToken === than.refreshToken) return null;
  return saved;
}

const isFresh = (session: Partial<Session>) => tokenExpiresAt(session.accessToken) > Date.now() + 30_000;

// WorkOS rotates refresh tokens on every use: persist the new pair at once.
// Concurrent CLI runs take turns (withCredentialsLock) and each re-reads the
// saved pair first, so a token another run already rotated is not reused.
export const refreshSession = (session: Partial<Session>, options: { organizationId?: string } = {}) =>
  withCredentialsLock(
    Effect.gen(function* () {
      const { organizationId } = options;
      let current: Partial<Session> = session;
      const latest = newerSession(current);
      if (latest) {
        if (!organizationId && isFresh(latest)) return latest;
        current = latest;
      }
      let result = yield* requestRefresh(current.apiUrl as string, current.refreshToken, organizationId);
      if (!result.ok && isSpent(result)) {
        // Rotated by a run that went ahead without the lock: retry once with its token.
        const newer = newerSession(current);
        if (newer) {
          if (!organizationId && isFresh(newer)) return newer;
          current = newer;
          result = yield* requestRefresh(current.apiUrl as string, current.refreshToken, organizationId);
        }
      }
      if (!result.ok) {
        const why = result.body.error_description || result.body.message || result.body.error || `HTTP ${result.status}`;
        if (result.status === 429) {
          return yield* new CliError({
            kind: "rateLimit",
            message: "htmlartifact is rate-limiting sign-in refreshes right now. You are still signed in: try again in a minute."
          });
        }
        if (result.status >= 500) {
          const action = organizationId ? "switch workspace" : "refresh your sign-in";
          return yield* new CliError({
            message: `Could not ${action} (${why}). You are still signed in: try again shortly.`
          });
        }
        if (organizationId) return yield* new CliError({ kind: "auth", message: `Could not switch workspace: ${why}` });
        return yield* new CliError({ kind: "auth", message: `Your sign-in expired (${why}). Run: htmlartifact login` });
      }
      return yield* saveSession(current.apiUrl as string, result.body);
    })
  );

// The bearer credential for every request: HTMLARTIFACT_TOKEN (CI: a WorkOS
// organization API key) or the saved sign-in, refreshed when it expires.
export const getAuth = (apiUrlOverride?: string) =>
  Effect.gen(function* () {
    const apiUrl = yield* resolveApiUrl(apiUrlOverride);
    const token = envToken();
    if (token) return { apiUrl, apiKey: token } satisfies Auth;

    const session = readJson<Session | null>(CREDENTIALS_PATH, null);
    if (!session?.refreshToken) return yield* new CliError({ kind: "auth", message: "Not signed in. Run: htmlartifact login" });
    if (session.apiUrl !== apiUrl) {
      return yield* new CliError({
        kind: "auth",
        message: `Signed in to ${session.apiUrl}, not ${apiUrl}. Run: htmlartifact login --api-url ${apiUrl}`
      });
    }
    const fresh = isFresh(session) ? session : yield* refreshSession(session);
    return { apiUrl, apiKey: fresh.accessToken } satisfies Auth;
  });

// One of a sign-in's workspaces, by name or ID.
const pickFrom = (workspaces: PendingLogin["workspaces"], name: string) =>
  workspaces.find((w) => w.id === name || w.name.toLowerCase() === name.toLowerCase());

// Finishes a pending sign-in in `organizationId`. Spent either way, unless the
// server could not answer.
export const finishPendingLogin = (apiUrl: string, token: string, organizationId: string) =>
  Effect.gen(function* () {
    const result = yield* postJson(`${apiUrl}/api/cli/token`, { pending_authentication_token: token, organization_id: organizationId });
    if (result.ok || (result.status < 500 && result.status !== 429)) yield* removePendingLogin;
    return result;
  });

// Signed in, but in several workspaces and none named (or not one of them):
// the sign-in is kept, so it is never thrown away. At a terminal the user
// picks; otherwise they finish with `login --workspace <name>`, no browser.
export const selectWorkspace = (apiUrl: string, pending: Json, name: string | undefined, interactive: boolean) =>
  Effect.gen(function* () {
    const workspaces: PendingLogin["workspaces"] = (pending.organizations || []).map((o: Json) => ({ id: o.id, name: o.name }));
    const token: string = pending.pending_authentication_token;
    yield* savePendingLogin({ apiUrl, token, workspaces, savedAt: Date.now() });
    let org = name ? pickFrom(workspaces, name) : undefined;
    if (!org && interactive) org = yield* askWorkspace(workspaces, name);
    if (!org) return yield* new CliError(pickWorkspaceError(workspaces, name));
    return yield* finishPendingLogin(apiUrl, token, org.id);
  });

export const pickWorkspaceError = (workspaces: PendingLogin["workspaces"], name: string | undefined) => ({
  kind: "usage" as const,
  message: [
    name ? `You are not in a workspace named "${name}".` : "You are in several workspaces.",
    "You are signed in: pick one to finish (no need to open the link again):",
    ...workspaces.map((w) => `  htmlartifact login --workspace ${shellQuote(w.name)}`)
  ].join("\n"),
  details: { workspaces: workspaces.map((w) => w.name) }
});

// Numbered choices on stderr; a number or a name picks. Undefined if input ends.
const askWorkspace = (workspaces: PendingLogin["workspaces"], name: string | undefined) =>
  Effect.gen(function* () {
    yield* Console.error(`\n${name ? `You are not in a workspace named "${name}". ` : ""}You are in several workspaces:`);
    for (const [i, w] of workspaces.entries()) yield* Console.error(`  ${i + 1}) ${w.name}`);
    for (;;) {
      const answer = yield* ask(`Workspace [1-${workspaces.length}]: `);
      if (answer === null) return undefined;
      const number = Number(answer);
      const org = Number.isInteger(number) && number >= 1 ? workspaces[number - 1] : pickFrom(workspaces, answer);
      if (org) return org;
      yield* Console.error(`Type a number from 1 to ${workspaces.length}, or a name.`);
    }
  });

// Moves the saved CLI sign-in into another workspace (token refresh).
export const switchSession = (organizationId: string) =>
  envToken()
    ? Effect.void
    : refreshSession(readJson<Partial<Session>>(CREDENTIALS_PATH, {}), { organizationId }).pipe(Effect.asVoid);

// Refreshes the saved sign-in with no workspace: after the current one is gone.
export const leaveWorkspaceSession = () =>
  envToken() ? Effect.void : refreshSession(readJson<Partial<Session>>(CREDENTIALS_PATH, {})).pipe(Effect.asVoid);

// Never send the token anywhere but this server (or its artifact subdomains).
export function assertOwnServer(target: URL, apiUrl: string): Effect.Effect<void, CliError> {
  const api = new URL(apiUrl);
  if (target.protocol !== api.protocol || !(target.host === api.host || target.host.endsWith(`.${api.host}`))) {
    return Effect.fail(new CliError({ kind: "usage", message: `${target.origin} is not your htmlartifact server (${api.origin}).` }));
  }
  return Effect.void;
}
