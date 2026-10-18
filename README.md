# htmlartifact

Publish HTML artifacts from coding agents (plans, specs, reviews, reports,
mocks) to your **workspace**. Everyone in the workspace can open them; nobody
else can.

It's like [Postplan](https://www.npmjs.com/package/postplan), but private to a
team. Everything works from a terminal, so an agent like Claude can run the
whole flow.

## How it works

```sh
# 1. Sign in or create an account (opens a browser once; works over SSH)
npx htmlartifact login

# 2. One person creates the workspace and invites people
npx htmlartifact workspace create "Acme"
npx htmlartifact workspace invite          # → HA-7KQ2-MX9P-4TRA

# 3. Everyone else joins with the code
npx htmlartifact login
npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA

# 4. Anyone publishes; every member can open the link
npx htmlartifact upload plan.html          # → https://…/d/k3j9x0a1b2c4
npx htmlartifact read https://…/d/k3j9x0a1b2c4
```

| Command | What it does |
|---|---|
| `login` / `logout` / `whoami` | Sign in or create an account; show who you are and your current workspace |
| `workspace create <name>` | New workspace; you are its admin |
| `workspace invite` | Invite code + join link (admins). `--max-uses`, `--days` |
| `workspace join <code>` | Join with a code |
| `workspace list` / `switch <name>` | Your workspaces; change the current one |
| `workspace members` / `remove <email>` | See members; remove one (admins). Access ends immediately |
| `workspace reinstate <email>` | Let someone who was removed rejoin with an invite code (admins) |
| `upload <file-or-folder>` | Publish. Re-uploading the same path publishes a new version at the same URL. `--slug <name>` gives a stable URL within the workspace |
| `read <url>` | Download an artifact with your sign-in (how agents read links) |
| `list [--all]` | Your artifacts, or the whole workspace's |
| `delete <id-or-url>` | Delete an artifact; its HTML (every version) is erased |
| `workspace delete --confirm <name>` | Delete the current workspace and everything in it (admins) |
| `workspace sso` / `directory` / `domains` | WorkOS Admin Portal link for your IT admin: SSO (SAML/OIDC), SCIM directory, or domain verification (admins) |
| `check <path>` | Validate against the rules without publishing |

Every command takes `--json` for agents. In CI, set `HTMLARTIFACT_TOKEN` to a
WorkOS organization API key instead of logging in.

The web app has the same flow for people who prefer a browser: sign in, see
the workspace's artifacts, and join with a code or a `/join/<code>` link.

## Who can see what

- **An artifact belongs to the workspace it was published in.** Only active
  members of that workspace can open it, in a browser or with a token.
- **Signed-out visitors are sent to sign in.** Members of other workspaces get
  a 404 that looks exactly like a missing page, so a URL reveals nothing.
- **Membership is confirmed with WorkOS,** not taken from a token alone.
  It's cached for 5 minutes, and WorkOS webhooks revoke it at once when
  someone is removed.
- **Artifact HTML runs under a strict CSP.** Scripted pages run in an
  opaque-origin sandbox, so they can't read the session or act as the app.
- **Only admins can create invite codes.** Codes expire (7 days by default)
  and have a use limit.

## Architecture

No servers to run. htmlartifact is one Cloudflare Worker:

| Piece | Service |
|---|---|
| API, web pages, artifact serving | Cloudflare Workers ([Hono](https://hono.dev)) |
| Artifact HTML | Cloudflare R2 |
| Artifact index, invites, caches | Cloudflare D1 (schema created automatically) |
| Accounts, sign-up, workspaces (organizations), SSO | [WorkOS](https://workos.com) AuthKit |
| CLI | TypeScript + [Effect](https://effect.website), bundled by Bun for Node.js ≥ 20.10, published to npm, run with `npx` |

## Development

```sh
bun install
bun run dev:local   # WorkOS emulator + Worker at http://localhost:8787, fully offline
bun run build       # CLI (TypeScript + Effect, cli/) → dist/htmlartifact.js
HTMLARTIFACT_API_URL=http://localhost:8787 node dist/htmlartifact.js login
bun run typecheck:cli
bun run test        # builds the CLI, then 38 tests: real Worker (workerd) + official WorkOS emulator
```

`dev:local` seeds `alice@`, `bob@` and `carol@example.com`. Sign in with any of
them on the emulator's login page. The CLI's browser sign-in is auto-approved
as Alice.

## Deploying (later)

1. WorkOS:
   - Create an environment and enable AuthKit.
   - Add the redirect URI `https://<host>/auth/callback`.
   - Add a webhook to `https://<host>/webhooks/workos` for these events:
     - `organization_membership.*`
     - `user.deleted`
     - `session.revoked`
     - `api_key.revoked`
2. Cloudflare:
   - Run `wrangler d1 create htmlartifact` and put the ID in `wrangler.toml`.
   - Run `wrangler r2 bucket create htmlartifact-artifacts`.
   - Run `wrangler secret put` for `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
     `WORKOS_WEBHOOK_SECRET` and `HTMLARTIFACT_COOKIE_PASSWORD` (32+ chars).
   - Run `bun run deploy`.
3. The CLI defaults to `https://htmlartifact.pages.dev` (`DEFAULT_API_URL` in
   `cli/env.ts`). Publish it to npm; `prepublishOnly` builds the bundle, so
   the package has no runtime dependencies.

## Credits

htmlartifact started from the MIT-licensed npm release of
[Postplan](https://www.npmjs.com/package/postplan) 0.0.5 by t3dotgg. The HTML
validator, artifact serving rules and CLI upload flow come from it. See
`NOTICE`.

## License

MIT
