import { Console, Duration, Effect, Option } from "effect";
import { Command } from "effect/cli";

import { getAuth, refreshSession, resolveApiUrl, selectWorkspace, tokenExpiresAt } from "../auth.ts";
import { CREDENTIALS_PATH } from "../env.ts";
import { CliError, reason } from "../errors.ts";
import { apiUrlFlag, jsonFlag, stringFlag } from "../flags.ts";
import { printJson } from "../format.ts";
import { api, postJson, requestJson } from "../http.ts";
import { readJson, removeCredentials, saveSession, type Session } from "../state.ts";

const MAX_POLL_INTERVAL_MS = 60_000;

export const login = Command.make(
  "login",
  {
    apiUrl: apiUrlFlag("Use another htmlartifact service"),
    workspace: stringFlag("workspace", "name", "If you are in several workspaces, start in this one")
  },
  Effect.fn(function* (options) {
    const apiUrl = yield* resolveApiUrl(Option.getOrUndefined(options.apiUrl));
    const start = yield* postJson(`${apiUrl}/api/cli/device`, {});
    if (!start.ok || !start.body.device_code) {
      return yield* new CliError({
        message: `Could not start sign-in at ${apiUrl}: ${start.body.error || `HTTP ${start.status}`}`
      });
    }
    const device = start.body;

    yield* Console.log("Open this link, sign in (or create an account), and confirm the code:\n");
    yield* Console.log(`  ${device.verification_uri_complete || device.verification_uri}\n`);
    yield* Console.log(`  Code: ${device.user_code}\n`);
    yield* Console.log("Waiting for you to finish in the browser...");

    let interval = Number(device.interval || 5) * 1000;
    const deadline = Date.now() + Number(device.expires_in || 300) * 1000;
    while (Date.now() < deadline) {
      yield* Effect.sleep(Duration.millis(interval));
      let poll = yield* postJson(`${apiUrl}/api/cli/token`, { device_code: device.device_code });
      // Rate-limited (by htmlartifact or WorkOS): back off like slow_down and
      // keep polling; the device code stays valid until the deadline.
      if (poll.status === 429) {
        interval = Math.min(MAX_POLL_INTERVAL_MS, interval + 5000);
        const extra = (poll.retryAfter ?? 0) * 1000 - interval;
        if (extra > 0) yield* Effect.sleep(Duration.millis(Math.min(extra, MAX_POLL_INTERVAL_MS)));
        continue;
      }
      if (poll.body.code === "organization_selection_required") {
        poll = yield* selectWorkspace(apiUrl, poll.body, Option.getOrUndefined(options.workspace));
      }
      if (poll.ok) {
        const session = yield* saveSession(apiUrl, poll.body);
        const me = yield* api(apiUrl, "/api/me", { apiKey: session.accessToken });
        yield* Console.log(`\nSigned in as ${me.email || me.name}.`);
        if (me.workspace) {
          yield* Console.log(`Workspace: ${me.workspace.name}`);
        } else {
          yield* Console.log("You are not in a workspace yet. Next, either:");
          yield* Console.log('  htmlartifact workspace create "<name>"   start one and invite people');
          yield* Console.log("  htmlartifact workspace join <code>       join with an invite code");
        }
        return;
      }
      const error = poll.body.error || poll.body.code;
      if (error === "authorization_pending") continue;
      if (error === "slow_down") {
        interval += 5000;
        continue;
      }
      return yield* new CliError({
        message: `Sign-in ${error === "access_denied" ? "was denied" : `failed: ${error || poll.status}`}.`
      });
    }
    return yield* new CliError({ message: "Sign-in timed out. Run htmlartifact login again." });
  })
).pipe(
  Command.withDescription("Sign in, or create an account, in your browser (works over SSH: open the link on any device).")
);

// Ends the saved sign-in's WorkOS session (so its refresh token stops working
// everywhere), then forgets it. Best-effort: the local file goes regardless.
export const logout = Command.make(
  "logout",
  {},
  Effect.fn(function* () {
    const session = readJson<Session | null>(CREDENTIALS_PATH, null);
    if (session?.refreshToken && session.apiUrl) {
      const problem = yield* endSession(session).pipe(
        Effect.catch((error) => Effect.succeed<string | null>(error.message || reason(error)))
      );
      if (problem) {
        yield* Console.error(`Note: could not end the session on ${session.apiUrl} (${problem}). It ends when it expires.`);
      }
    }
    yield* removeCredentials;
    yield* Console.log("Signed out.");
  })
).pipe(Command.withDescription("Sign out: end the saved sign-in's session and forget it on this machine."));

// null once the server has ended the session, else why not.
const endSession = (session: Session) =>
  Effect.gen(function* () {
    const accessToken =
      tokenExpiresAt(session.accessToken) > Date.now() + 30_000
        ? session.accessToken
        : (yield* refreshSession(session)).accessToken;
    const result = yield* requestJson(`${session.apiUrl}/api/cli/logout`, {
      apiKey: accessToken,
      method: "POST",
      body: {},
      timeoutMs: 10_000
    });
    return result.ok ? null : String(result.body.error || `HTTP ${result.status}`);
  });

export const whoami = Command.make(
  "whoami",
  { json: jsonFlag() },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    const me = yield* api(apiUrl, "/api/me", { apiKey });
    if (options.json) return yield* printJson({ ...me, apiUrl });
    yield* Console.log(`User: ${me.name}${me.email ? ` <${me.email}>` : ""}`);
    yield* Console.log(
      me.workspace
        ? `Workspace: ${me.workspace.name} (${me.workspace.role || "member"})`
        : "Workspace: none yet (htmlartifact workspace create <name> | workspace join <code>)"
    );
    yield* Console.log(`Service: ${apiUrl}`);
  })
).pipe(Command.withDescription("Show who you are signed in as, and your current workspace."));
