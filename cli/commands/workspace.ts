import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/cli";

import { getAuth, leaveWorkspaceSession, switchSession } from "../auth.ts";
import { CliError, reason } from "../errors.ts";
import { jsonFlag, numberFlag, stringFlag } from "../flags.ts";
import { printJson, shellQuote } from "../format.ts";
import { api } from "../http.ts";
import type { Json } from "../state.ts";

const create = Command.make(
  "create",
  {
    name: Argument.String("name").pipe(Argument.withDescription('Workspace name, e.g. "Acme"')),
    json: jsonFlag()
  },
  Effect.fn(function* ({ name, json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, "/api/workspaces", { apiKey, body: { name } });
    yield* switchSession(result.workspace.id);
    if (json) return yield* printJson(result);
    yield* Console.log(`Created workspace "${result.workspace.name}" and switched to it.`);
    yield* Console.log("Invite people with: htmlartifact workspace invite");
  })
).pipe(Command.withDescription("Create a workspace (you become its admin) and switch to it."));

const invite = Command.make(
  "invite",
  {
    maxUses: numberFlag("max-uses", "How many people can use it"),
    days: numberFlag("days", "Days until it expires"),
    json: jsonFlag()
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, "/api/workspaces/invites", {
      apiKey,
      body: { maxUses: Option.getOrUndefined(options.maxUses), ttlDays: Option.getOrUndefined(options.days) }
    });
    if (options.json) return yield* printJson(result);
    yield* Console.log(`Invite to "${result.workspace.name}": ${result.code}`);
    yield* Console.log(`Expires ${result.expiresAt.slice(0, 10)}, up to ${result.maxUses} people.\n`);
    yield* Console.log("They run:");
    yield* Console.log("  npx htmlartifact login");
    yield* Console.log(`  npx htmlartifact workspace join ${result.code}`);
    yield* Console.log(`Or open: ${result.joinUrl}`);
  })
).pipe(Command.withDescription("Create an invite code for your current workspace (admins)."));

const join = Command.make(
  "join",
  {
    code: Argument.String("code").pipe(Argument.withDescription("Invite code, e.g. HA-7KQ2-MX9P-4TRA")),
    json: jsonFlag()
  },
  Effect.fn(function* ({ code, json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, "/api/workspaces/join", { apiKey, body: { code } });
    yield* switchSession(result.workspace.id);
    if (json) return yield* printJson(result);
    yield* Console.log(
      `${result.alreadyMember ? "Already in" : "Joined"} "${result.workspace.name}". It is now your current workspace.`
    );
  })
).pipe(Command.withDescription("Join a workspace with an invite code and switch to it."));

const list = Command.make(
  "list",
  { json: jsonFlag() },
  Effect.fn(function* ({ json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const { workspaces } = (yield* api(apiUrl, "/api/workspaces", { apiKey })) as { workspaces: Json[] };
    if (json) return yield* printJson(workspaces);
    if (!workspaces.length) return yield* Console.log("No workspaces yet.");
    for (const w of workspaces) yield* Console.log(`${w.current ? "*" : " "} ${w.name}  (${w.role || "member"})`);
  })
).pipe(Command.withDescription("List your workspaces (* = current)."));

const switchCommand = Command.make(
  "switch",
  { name: Argument.String("name").pipe(Argument.withDescription("Workspace name or ID")) },
  Effect.fn(function* ({ name }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const { workspaces } = (yield* api(apiUrl, "/api/workspaces", { apiKey })) as { workspaces: Json[] };
    const wanted = name.toLowerCase();
    const match = workspaces.find((w) => w.id === name || w.handle === wanted || w.name?.toLowerCase() === wanted);
    if (!match) {
      return yield* new CliError({ message: `You are not in a workspace named "${name}". See: htmlartifact workspace list` });
    }
    yield* switchSession(match.id);
    yield* Console.log(`Switched to "${match.name}".`);
  })
).pipe(Command.withDescription("Make another of your workspaces the current one."));

const members = Command.make(
  "members",
  { json: jsonFlag() },
  Effect.fn(function* ({ json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const { members } = (yield* api(apiUrl, "/api/workspaces/members", { apiKey })) as { members: Json[] };
    if (json) return yield* printJson(members);
    for (const m of members) yield* Console.log(`${m.name} <${m.email}>  ${m.role || "member"}`);
  })
).pipe(Command.withDescription("List the members of your current workspace."));

const remove = Command.make(
  "remove",
  { email: Argument.String("email").pipe(Argument.withDescription("Member to remove")) },
  Effect.fn(function* ({ email }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const { members } = (yield* api(apiUrl, "/api/workspaces/members", { apiKey })) as { members: Json[] };
    const member = members.find((m) => m.email?.toLowerCase() === email.toLowerCase());
    if (!member) return yield* new CliError({ message: `${email} is not a member of this workspace.` });
    yield* api(apiUrl, `/api/workspaces/members/${member.id}`, { apiKey, method: "DELETE" });
    yield* Console.log(`Removed ${email}.`);
  })
).pipe(Command.withDescription("Remove someone from your current workspace (admins). Their access ends immediately."));

const deleteWorkspace = Command.make(
  "delete",
  {
    confirm: stringFlag("confirm", "name", "The current workspace's exact name, to confirm"),
    json: jsonFlag()
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    if (Option.isNone(options.confirm)) {
      const me = yield* api(apiUrl, "/api/me", { apiKey });
      const name: string = me.workspace?.name || "<workspace name>";
      return yield* new CliError({
        message: [
          `Deleting a workspace erases every artifact in it (every version) and cannot be undone.`,
          `To confirm, run: htmlartifact workspace delete --confirm ${shellQuote(name)}`
        ].join("\n")
      });
    }
    const name = options.confirm.value;
    const result = yield* api(apiUrl, "/api/workspaces/current", { apiKey, method: "DELETE", body: { confirm: name } });

    // The saved sign-in still points into the deleted workspace: refresh out of it.
    const refreshed = yield* leaveWorkspaceSession().pipe(
      Effect.as(null),
      Effect.catch((error) => Effect.succeed(error.message || reason(error)))
    );
    if (options.json) {
      yield* printJson(result);
    } else {
      yield* Console.log(`Deleted workspace "${name}". Every artifact in it (every version) is erased.`);
      yield* Console.log("See your other workspaces with: htmlartifact workspace list");
    }
    if (refreshed) {
      yield* Console.error(`Warning: deleted, but could not refresh your sign-in: ${refreshed}`);
    }
  })
).pipe(Command.withDescription("Delete your current workspace and every artifact in it (admins). Needs --confirm <name>."));

const portal = (name: string, intent: "sso" | "dsync" | "domain_verification", explanation: string, description: string) =>
  Command.make(
    name,
    { json: jsonFlag() },
    Effect.fn(function* ({ json }) {
      const { apiUrl, apiKey } = yield* getAuth();
      const result = yield* api(apiUrl, "/api/workspaces/portal", { apiKey, body: { intent } });
      if (json) return yield* printJson(result);
      yield* Console.log(`WorkOS Admin Portal: ${result.url}`);
      yield* Console.log(explanation);
    })
  ).pipe(Command.withDescription(description));

const sso = portal(
  "sso",
  "sso",
  "Your IT admin opens this link to connect your SAML or OIDC identity provider, so members sign in with SSO.",
  "Get a WorkOS Admin Portal link to set up SSO (SAML/OIDC) for your workspace (admins)."
);

const directory = portal(
  "directory",
  "dsync",
  "Your IT admin opens this link to connect your SCIM directory, so people are added and removed automatically.",
  "Get a WorkOS Admin Portal link to connect a SCIM directory to your workspace (admins)."
);

const domains = portal(
  "domains",
  "domain_verification",
  "Your IT admin opens this link to verify your company's email domain (needed before SSO or a directory can claim it).",
  "Get a WorkOS Admin Portal link to verify your workspace's domain (admins)."
);

export const workspace = Command.make("workspace").pipe(
  Command.withDescription("Create, join, and manage workspaces."),
  Command.withSubcommands([create, invite, join, list, switchCommand, members, remove, deleteWorkspace, sso, directory, domains])
);
