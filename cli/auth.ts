import { Effect } from "effect";

import { CONFIG_PATH, CREDENTIALS_PATH, DEFAULT_API_URL, envToken } from "./env.ts";
import { CliError } from "./errors.ts";
import { postJson } from "./http.ts";
import { readJson, saveSession, type Json, type Session } from "./state.ts";

export interface Auth {
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
        new CliError({ message: "No htmlartifact server configured. Run: htmlartifact login --api-url https://<your-server>" })
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

// WorkOS rotates refresh tokens on every use: persist the new pair at once.
export const refreshSession = (session: Partial<Session>, options: { organizationId?: string } = {}) =>
  Effect.gen(function* () {
    const { organizationId } = options;
    const result = yield* postJson(`${session.apiUrl}/api/cli/token`, {
      refresh_token: session.refreshToken,
      ...(organizationId ? { organization_id: organizationId } : {})
    });
    if (!result.ok) {
      const why = result.body.error_description || result.body.message || result.body.error || result.status;
      if (organizationId) return yield* new CliError({ message: `Could not switch workspace: ${why}` });
      return yield* new CliError({ message: `Your sign-in expired (${why}). Run: htmlartifact login` });
    }
    return yield* saveSession(session.apiUrl as string, result.body);
  });

// The bearer credential for every request: HTMLARTIFACT_TOKEN (CI: a WorkOS
// organization API key) or the saved sign-in, refreshed when it expires.
export const getAuth = (apiUrlOverride?: string) =>
  Effect.gen(function* () {
    const apiUrl = yield* resolveApiUrl(apiUrlOverride);
    const token = envToken();
    if (token) return { apiUrl, apiKey: token } satisfies Auth;

    const session = readJson<Session | null>(CREDENTIALS_PATH, null);
    if (!session?.refreshToken) return yield* new CliError({ message: "Not signed in. Run: htmlartifact login" });
    if (session.apiUrl !== apiUrl) {
      return yield* new CliError({
        message: `Signed in to ${session.apiUrl}, not ${apiUrl}. Run: htmlartifact login --api-url ${apiUrl}`
      });
    }
    const fresh = tokenExpiresAt(session.accessToken) > Date.now() + 30_000 ? session : yield* refreshSession(session);
    return { apiUrl, apiKey: fresh.accessToken } satisfies Auth;
  });

// Several workspaces and no --workspace: list them and stop, not guess.
export const selectWorkspace = (apiUrl: string, pending: Json, name: string | undefined) =>
  Effect.gen(function* () {
    const choices: Array<{ id: string; name: string }> = pending.organizations || [];
    const wanted = name?.toLowerCase();
    const org = wanted ? choices.find((o) => o.id === name || o.name.toLowerCase() === wanted) : undefined;
    if (!org) {
      const names = choices.map((o) => `  ${o.name}`).join("\n");
      return yield* new CliError({ message: `You are in several workspaces. Run again with --workspace <name>:\n${names}` });
    }
    return yield* postJson(`${apiUrl}/api/cli/token`, {
      pending_authentication_token: pending.pending_authentication_token,
      organization_id: org.id
    });
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
    return Effect.fail(new CliError({ message: `${target.origin} is not your htmlartifact server (${api.origin}).` }));
  }
  return Effect.void;
}
