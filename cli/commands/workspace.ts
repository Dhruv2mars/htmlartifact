import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/cli";

import { getAuth, leaveWorkspaceSession, switchSession } from "../auth.ts";
import { CMD } from "../env.ts";
import { CliError, reason } from "../errors.ts";
import { jsonFlag, numberFlag, stringFlag, switchFlag } from "../flags.ts";
import { printJson, shellQuote } from "../format.ts";
import { api } from "../http.ts";
import type { Json } from "../state.ts";

// One of the caller's workspaces, by name, handle or ID.
export const resolveWorkspace = (apiUrl: string, apiKey: string, name: string) =>
  Effect.gen(function* () {
    const { workspaces } = (yield* api(apiUrl, "/api/workspaces", { apiKey })) as { workspaces: Json[] };
    const wanted = name.toLowerCase();
    const match = workspaces.find((w) => w.id === name || w.handle === wanted || w.name?.toLowerCase() === wanted);
    if (!match) {
      return yield* new CliError({ kind: "notFound", message: `You are not in a workspace named "${name}". See: htmlartifact workspace list` });
    }
    return match;
  });

// A member of the current workspace, by email.
const findMember = (apiUrl: string, apiKey: string, email: string) =>
  Effect.gen(function* () {
    const { members } = (yield* api(apiUrl, "/api/workspaces/members", { apiKey })) as { members: Json[] };
    const member = members.find((m) => m.email?.toLowerCase() === email.toLowerCase());
    if (!member) return yield* new CliError({ kind: "notFound", message: `${email} is not a member of this workspace.` });
    return member;
  });

// The server enforces the same ranges (its use cap is configurable).
const MAX_INVITE_DAYS = 30;
const checkWhole = (flag: string, value: number | undefined, min: number, max?: number) =>
  value === undefined || (Number.isInteger(value) && value >= min && (max === undefined || value <= max))
    ? Effect.void
    : Effect.fail(
        new CliError({ kind: "usage", message: `--${flag} must be a whole number ${max === undefined ? `of at least ${min}` : `from ${min} to ${max}`}.` })
      );

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
    yield* Console.log(`Invite people with: ${CMD} workspace invite`);
  })
).pipe(Command.withDescription("Create a workspace (you become its admin) and switch to it."));

const invite = Command.make(
  "invite",
  {
    maxUses: numberFlag("max-uses", "How many people can use it (default 50)"),
    days: numberFlag("days", `Days until it expires, 1 to ${MAX_INVITE_DAYS} (default 7)`),
    json: jsonFlag()
  },
  Effect.fn(function* (options) {
    const maxUses = Option.getOrUndefined(options.maxUses);
    const ttlDays = Option.getOrUndefined(options.days);
    yield* checkWhole("max-uses", maxUses, 1);
    yield* checkWhole("days", ttlDays, 1, MAX_INVITE_DAYS);
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, "/api/workspaces/invites", { apiKey, body: { maxUses, ttlDays } });
    if (options.json) return yield* printJson(result);
    yield* Console.log(`Invite to "${result.workspace.name}": ${result.code}`);
    yield* Console.log(`Expires ${result.expiresAt.slice(0, 10)}, up to ${result.maxUses} ${result.maxUses === 1 ? "person" : "people"}.\n`);
    yield* Console.log("They run:");
    yield* Console.log("  npx htmlartifact login");
    yield* Console.log(`  npx htmlartifact workspace join ${result.code}`);
    yield* Console.log(`Or open: ${result.joinUrl}`);
  })
).pipe(Command.withDescription("Create an invite code for your current workspace (admins)."));

const invites = Command.make(
  "invites",
  {
    revoke: stringFlag("revoke", "code", 'Revoke this code ("all" revokes every live code)'),
    all: switchFlag("all", "Also list used-up, expired and revoked codes, with who joined"),
    json: jsonFlag()
  },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    const revoke = Option.getOrUndefined(options.revoke);
    if (revoke) {
      const revoked = yield* api(apiUrl, `/api/workspaces/invites/${encodeURIComponent(revoke)}`, { apiKey, method: "DELETE" });
      if (options.json) return yield* printJson(revoked);
      return yield* Console.log(revoke === "all" ? "Revoked every live invite code." : `Revoked ${revoke}.`);
    }
    const result = (yield* api(apiUrl, `/api/workspaces/invites${options.all ? "?all=1" : ""}`, { apiKey })) as { invites: Json[] };
    if (options.json) return yield* printJson(result.invites);
    if (!result.invites.length) return yield* Console.log(options.all ? "No invite codes yet." : "No live invite codes (--all shows spent ones).");
    for (const i of result.invites) {
      const status = options.all ? `${i.status}, ` : "";
      yield* Console.log(`${i.code}  ${status}used ${i.uses}/${i.maxUses}, expires ${String(i.expiresAt).slice(0, 10)}`);
      for (const j of i.joined || []) {
        yield* Console.log(`  joined: ${j.name || "unknown"}${j.email ? ` <${j.email}>` : ""}, ${String(j.joinedAt).slice(0, 10)}`);
      }
    }
  })
).pipe(Command.withDescription("List live invite codes (--all: every code, with who joined), or revoke one with --revoke <code> (admins)."));

const join = Command.make(
  "join",
  {
    code: Argument.String("code").pipe(Argument.withDescription("Invite code (e.g. HA-7KQ2-MX9P-4TRA) or its /join/ link")),
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
  { name: Argument.String("name").pipe(Argument.withDescription("Workspace name or ID")), json: jsonFlag() },
  Effect.fn(function* ({ name, json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const match = yield* resolveWorkspace(apiUrl, apiKey, name);
    yield* switchSession(match.id);
    if (json) return yield* printJson({ ok: true, workspace: { ...match, current: true } });
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
  { email: Argument.String("email").pipe(Argument.withDescription("Member to remove")), json: jsonFlag() },
  Effect.fn(function* ({ email, json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const member = yield* findMember(apiUrl, apiKey, email);
    const removed = yield* api(apiUrl, `/api/workspaces/members/${member.id}`, { apiKey, method: "DELETE" });
    if (json) return yield* printJson(removed);
    yield* Console.log(`Removed ${email}.`);
    yield* Console.log("Every invite code issued until now was revoked (they may have held one).");
    yield* Console.log(`Create a new one with: ${CMD} workspace invite`);
  })
).pipe(
  Command.withDescription(
    "Remove someone from your current workspace (admins). Their access ends immediately, and every earlier invite code is revoked."
  )
);

const setRole = (name: "promote" | "demote", role: "admin" | "member", description: string) =>
  Command.make(
    name,
    { email: Argument.String("email").pipe(Argument.withDescription("A member of your current workspace")), json: jsonFlag() },
    Effect.fn(function* ({ email, json }) {
      const { apiUrl, apiKey } = yield* getAuth();
      const member = yield* findMember(apiUrl, apiKey, email);
      const result = yield* api(apiUrl, `/api/workspaces/members/${member.id}`, { apiKey, method: "PATCH", body: { role } });
      if (json) return yield* printJson(result);
      yield* Console.log(result.unchanged ? `${email} is already ${role === "admin" ? "an admin" : "a member"}.` : `${email} is now ${role === "admin" ? "an admin" : "a member"}.`);
    })
  ).pipe(Command.withDescription(description));

const promote = setRole("promote", "admin", "Make a member of your current workspace an admin (admins).");
const demote = setRole("demote", "member", "Make an admin of your current workspace a regular member (admins). One admin always remains.");

const leave = Command.make(
  "leave",
  { json: jsonFlag() },
  Effect.fn(function* ({ json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, "/api/workspaces/leave", { apiKey, method: "POST", body: {} });
    // The saved sign-in still points into the workspace just left: refresh out of it.
    const refreshed = yield* leaveWorkspaceSession().pipe(
      Effect.as(null),
      Effect.catch((error) => Effect.succeed(error.message || reason(error)))
    );
    if (json) {
      yield* printJson(result);
    } else {
      yield* Console.log(`Left "${result.workspace.name}".`);
      yield* Console.log(`See your other workspaces with: ${CMD} workspace list`);
    }
    if (refreshed) yield* Console.error(`Warning: left, but could not refresh your sign-in: ${refreshed}`);
  })
).pipe(Command.withDescription("Leave your current workspace. Its last admin must promote someone else first."));

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
        kind: "usage",
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
      yield* Console.log(`See your other workspaces with: ${CMD} workspace list`);
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

const apiKeyCreate = Command.make(
  "create",
  { name: stringFlag("name", "name", 'A label, e.g. "GitHub Actions" (default "CI")'), json: jsonFlag() },
  Effect.fn(function* (options) {
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, "/api/workspaces/api-keys", {
      apiKey,
      body: { name: Option.getOrUndefined(options.name) }
    });
    if (options.json) return yield* printJson(result);
    yield* Console.log(`Created API key "${result.key.name}" (${result.key.id}) for "${result.workspace.name}".\n`);
    yield* Console.log(`  ${result.token}\n`);
    yield* Console.log("This is the only time it is shown. Store it as the HTMLARTIFACT_TOKEN secret in CI.");
    yield* Console.log(`It stops working if you leave the workspace. Revoke it with: ${CMD} workspace api-key revoke ${result.key.id}`);
  })
).pipe(Command.withDescription("Create an API key for CI (HTMLARTIFACT_TOKEN) in your current workspace (admins)."));

const apiKeyList = Command.make(
  "list",
  { json: jsonFlag() },
  Effect.fn(function* ({ json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const { keys } = (yield* api(apiUrl, "/api/workspaces/api-keys", { apiKey })) as { keys: Json[] };
    if (json) return yield* printJson(keys);
    if (!keys.length) return yield* Console.log(`No API keys. Create one with: ${CMD} workspace api-key create`);
    for (const k of keys) {
      const used = k.lastUsedAt ? `last used ${String(k.lastUsedAt).slice(0, 10)}` : "never used";
      yield* Console.log(`${k.id}  ${k.name}  by ${k.createdBy?.name || k.createdBy?.id}, created ${String(k.createdAt).slice(0, 10)}, ${used}`);
    }
  })
).pipe(Command.withDescription("List your current workspace's live API keys (admins)."));

const apiKeyRevoke = Command.make(
  "revoke",
  { id: Argument.String("id").pipe(Argument.withDescription("Key ID, from: workspace api-key list")), json: jsonFlag() },
  Effect.fn(function* ({ id, json }) {
    const { apiUrl, apiKey } = yield* getAuth();
    const result = yield* api(apiUrl, `/api/workspaces/api-keys/${encodeURIComponent(id)}`, { apiKey, method: "DELETE" });
    if (json) return yield* printJson(result);
    yield* Console.log(`Revoked ${id}. CI jobs using it stop working now.`);
  })
).pipe(Command.withDescription("Revoke an API key (admins)."));

const apiKeyCommand = Command.make("api-key").pipe(
  Command.withDescription("Create, list, and revoke API keys for CI (admins)."),
  Command.withSubcommands([apiKeyCreate, apiKeyList, apiKeyRevoke])
);

export const workspace = Command.make("workspace").pipe(
  Command.withDescription("Create, join, and manage workspaces."),
  Command.withSubcommands([
    create,
    invite,
    invites,
    join,
    list,
    switchCommand,
    members,
    remove,
    promote,
    demote,
    leave,
    deleteWorkspace,
    apiKeyCommand,
    sso,
    directory,
    domains
  ])
);
