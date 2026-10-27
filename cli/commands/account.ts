import { Console, Duration, Effect, Option } from "effect";
import { Command } from "effect/cli";

import {
  finishPendingLogin,
  getAuth,
  pickWorkspaceError,
  refreshSession,
  resolveApiUrl,
  selectWorkspace,
  switchSession,
  tokenExpiresAt
} from "../auth.ts";
import { CMD, CREDENTIALS_PATH } from "../env.ts";
import { CliError, reason } from "../errors.ts";
import { apiUrlFlag, jsonFlag, stringFlag } from "../flags.ts";
import { printJson, shellQuote } from "../format.ts";
import { api, postJson, requestJson } from "../http.ts";
import { isInteractive } from "../prompt.ts";
import { readJson, readPendingLogin, removeCredentials, removePendingLogin, saveSession, type Json, type Session } from "../state.ts";

const MAX_POLL_INTERVAL_MS = 60_000;

export const login = Command.make(
  "login",
  {
    apiUrl: apiUrlFlag("Use another htmlartifact service"),
    workspace: stringFlag("workspace", "name", "If you are in several workspaces, start in this one"),
    json: jsonFlag("Print the result as JSON (the sign-in link goes to stderr)")
  },
  Effect.fn(function* (options) {
    // Under --json, stdout is the result alone; the link and progress go to stderr.
    const say = options.json ? Console.error : Console.log;
    const apiUrl = yield* resolveApiUrl(Option.getOrUndefined(options.apiUrl));
    const wanted = Option.getOrUndefined(options.workspace);

    // Signed in, with tokens: save them, then say where the user is.
    const finish = (tokens: Json) =>
      Effect.gen(function* () {
        const session = yield* saveSession(apiUrl, tokens);
        yield* removePendingLogin;
        const me = yield* api(apiUrl, "/api/me", { apiKey: session.accessToken });
        if (!options.json) yield* Console.log(`\nSigned in as ${me.email || me.name}.`);
        // Signed in without a current workspace, but already in some (e.g.
        // joined in the browser, then signed in here with that browser
        // session): use the only one, or say how to pick.
        let workspace = me.workspace as Json | null;
        let others: Json[] = [];
        if (!workspace) {
          const { workspaces } = (yield* api(apiUrl, "/api/workspaces", { apiKey: session.accessToken })) as {
            workspaces: Json[];
          };
          const lower = wanted?.toLowerCase();
          const match =
            workspaces.find((w) => lower !== undefined && (w.id === lower || w.handle === lower || w.name?.toLowerCase() === lower)) ||
            (workspaces.length === 1 ? workspaces[0] : undefined);
          if (match) {
            yield* switchSession(match.id);
            workspace = match;
          } else {
            others = workspaces;
          }
        }
        if (options.json) {
          return yield* printJson({
            ok: true,
            apiUrl,
            name: me.name ?? null,
            email: me.email ?? null,
            workspace: workspace ?? null,
            workspaces: others
          });
        }
        if (workspace) {
          yield* Console.log(`Workspace: ${workspace.name}`);
          yield* Console.log(`Next, publish a page: ${CMD} upload <file.html>`);
        } else if (others.length) {
          yield* Console.log(`You are in ${others.length} workspaces. Pick one:`);
          for (const w of others) yield* Console.log(`  ${CMD} workspace switch ${shellQuote(w.name)}`);
        } else {
          yield* Console.log("You are not in a workspace yet. Next, either:");
          yield* Console.log(`  ${CMD} workspace create "<name>"   start one and invite people`);
          yield* Console.log(`  ${CMD} workspace join <code>       join with an invite code`);
        }
      });

    // A sign-in that finished in the browser but still needs its workspace:
    // naming one finishes it here, with no second trip to the browser.
    const pending = wanted ? readPendingLogin(apiUrl) : null;
    if (wanted && pending) {
      const org = pending.workspaces.find((w) => w.id === wanted || w.name.toLowerCase() === wanted.toLowerCase());
      if (!org) return yield* new CliError(pickWorkspaceError(pending.workspaces, wanted));
      const result = yield* finishPendingLogin(apiUrl, pending.token, org.id);
      if (result.ok) return yield* finish(result.body);
      if (result.status >= 500 || result.status === 429) {
        return yield* new CliError({ message: `Could not finish signing in (${result.body.error || `HTTP ${result.status}`}). Try again shortly.` });
      }
      yield* say("That sign-in has expired: sign in again.\n");
    }

    const start = yield* postJson(`${apiUrl}/api/cli/device`, {});
    if (!start.ok || !start.body.device_code) {
      return yield* new CliError({
        message: `Could not start sign-in at ${apiUrl}: ${start.body.error || `HTTP ${start.status}`}`
      });
    }
    const device = start.body;

    yield* say("Open this link, sign in (or create an account), and confirm the code:\n");
    yield* say(`  ${device.verification_uri_complete || device.verification_uri}\n`);
    yield* say(`  Code: ${device.user_code}\n`);
    yield* say("Waiting for you to finish in the browser...");

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
        poll = yield* selectWorkspace(apiUrl, poll.body, wanted, !options.json && isInteractive());
      }
      if (poll.ok) return yield* finish(poll.body);
      const error = poll.body.error || poll.body.code;
      if (error === "authorization_pending") continue;
      if (error === "slow_down") {
        interval += 5000;
        continue;
      }
      if (error === "expired_token") {
        return yield* new CliError({ kind: "auth", message: "The sign-in link expired. Run: htmlartifact login" });
      }
      return yield* new CliError({
        kind: "auth",
        message: `Sign-in ${error === "access_denied" ? "was denied" : `failed: ${error || poll.status}`}.`
      });
    }
    return yield* new CliError({ kind: "auth", message: "The sign-in link expired. Run: htmlartifact login" });
  })
).pipe(
  Command.withDescription("Sign in, or create an account, in your browser (works over SSH: open the link on any device).")
);

// Ends the saved sign-in's WorkOS session (so its refresh token stops working
// everywhere), then forgets it. Best-effort: the local file goes regardless.
export const logout = Command.make(
  "logout",
  { json: jsonFlag() },
  Effect.fn(function* (options) {
    const session = readJson<Session | null>(CREDENTIALS_PATH, null);
    let problem: string | null = null;
    if (session?.refreshToken && session.apiUrl) {
      problem = yield* endSession(session).pipe(
        Effect.catch((error) => Effect.succeed<string | null>(error.message || reason(error)))
      );
      if (problem) {
        yield* Console.error(`Note: could not end the session on ${session.apiUrl} (${problem}). It ends when it expires.`);
      }
    }
    yield* removeCredentials;
    if (options.json) {
      return yield* printJson({ ok: true, wasSignedIn: !!session?.refreshToken, sessionEnded: !!session?.refreshToken && !problem });
    }
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
    if (me.workspace) {
      yield* Console.log(`Workspace: ${me.workspace.name} (${me.workspace.role || "member"})`);
    } else {
      if (me.removedFrom) yield* Console.log(`You no longer have access to "${me.removedFrom}".`);
      const { workspaces } = (yield* api(apiUrl, "/api/workspaces", { apiKey })) as { workspaces: Json[] };
      yield* Console.log(
        workspaces.length
          ? `Workspace: none selected (${CMD} workspace switch <name>; you are in ${workspaces.map((w) => w.name).join(", ")})`
          : `Workspace: none yet (${CMD} workspace create <name> | workspace join <code>)`
      );
    }
    yield* Console.log(`Service: ${apiUrl}`);
  })
).pipe(Command.withDescription("Show who you are signed in as, and your current workspace."));
