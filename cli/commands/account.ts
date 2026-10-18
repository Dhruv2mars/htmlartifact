import { Console, Duration, Effect, Option } from "effect";
import { Command } from "effect/cli";

import { getAuth, resolveApiUrl, selectWorkspace } from "../auth.ts";
import { CliError } from "../errors.ts";
import { apiUrlFlag, jsonFlag, stringFlag } from "../flags.ts";
import { printJson } from "../format.ts";
import { api, postJson } from "../http.ts";
import { removeCredentials, saveSession } from "../state.ts";

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

export const logout = Command.make("logout", {}, () =>
  removeCredentials.pipe(Effect.andThen(Console.log("Signed out.")))
).pipe(Command.withDescription("Forget the saved sign-in on this machine."));

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
