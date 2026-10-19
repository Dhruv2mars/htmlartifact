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
| `workspace invites [--revoke <code\|all>]` | List live invite codes, or revoke one or all (admins) |
| `workspace join <code>` | Join with a code |
| `workspace list` / `switch <name>` | Your workspaces; change the current one |
| `workspace members` / `remove <email>` | See members; remove one (admins). Access ends immediately, and every invite code issued until then is revoked (they may hold one): share a fresh code with the team |
| `upload <file-or-folder>` | Publish. Re-uploading the same path publishes a new version at the same URL. `--slug <name>` gives a stable URL within the workspace |
| `read <url>` | Download an artifact with your sign-in (how agents read links) |
| `list [--all]` | Your artifacts, or the whole workspace's |
| `delete <id-or-url>` | Delete an artifact; its HTML (every version) is erased |
| `workspace delete --confirm <name>` | Delete the current workspace and everything in it (admins) |
| `workspace sso` / `directory` / `domains` | WorkOS Admin Portal link for your IT admin: SSO (SAML/OIDC), SCIM directory, or domain verification (admins). SSO and directory links are off unless the deployment sets `HTMLARTIFACT_ENTERPRISE_CONNECTIONS=on` (WorkOS bills each connection) |
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
| Artifact HTML | Cloudflare R2, or D1 until R2 is switched on (see Storage) |
| Artifact index, invites, caches | Cloudflare D1 (schema created automatically) |
| Accounts, sign-up, workspaces (organizations), SSO | [WorkOS](https://workos.com) AuthKit |
| Web pages | React Router (SSR) in `web/`, rendered by the Worker; Hono decides the page and its status |
| CLI | TypeScript + [Effect](https://effect.website), bundled by Bun for Node.js ≥ 20.10, published to npm, run with `npx` |

## Development

```sh
bun install
bun run dev:local   # WorkOS emulator + Worker at http://localhost:8787, fully offline
bun run build       # CLI (TypeScript + Effect, cli/) → dist/htmlartifact.js
HTMLARTIFACT_API_URL=http://localhost:8787 node dist/htmlartifact.js login
bun run typecheck:cli
bun run dev:web     # the web app alone (React Router + Vite) with fixture data, http://localhost:5173
bun run build:web   # web/build: the SSR bundle the Worker imports, plus static assets
bun run test        # builds the CLI, then the full suite twice: D1 storage, then R2 (real Worker + official WorkOS emulator)
```

`dev:local` seeds `alice@`, `bob@` and `carol@example.com`. Sign in with any of
them on the emulator's login page. The CLI's browser sign-in is auto-approved
as Alice.

## Storage and the free-tier budget

htmlartifact runs entirely on Cloudflare's free plans (Workers Free, Pages, D1)
and WorkOS Staging, with no payment card on the Cloudflare account, so it
cannot be billed: past a quota, Cloudflare returns errors until the daily reset
(00:00 UTC) instead of charging. See `CLAUDE.md` (zero spend).

Artifact HTML lives in D1 (`src/storage.ts`): each object is split into
≤ 1 MB rows of a `blobs` table, written in the same atomic batch as the version
that references them, so a fresh artifact opens for teammates immediately (D1,
not KV: KV is eventually consistent). Deleting an artifact or workspace
deletes every chunk of every version.

The app's own limits keep usage inside the free quotas (numbers from
Cloudflare's docs: Workers limits, D1 limits and pricing, Pages Functions
pricing, checked 2026-10-19):

| Free quota | App limit or usage |
|---|---|
| D1: 500 MB per database (5 GB per account) | Uploads stop when the database would pass 450 MB (`HTMLARTIFACT_DATABASE_LIMIT_BYTES`); each workspace holds at most 50 MiB of HTML, every version counted (`HTMLARTIFACT_WORKSPACE_QUOTA_BYTES`); 1 MiB per upload (2 MiB flagged), 10 pages |
| D1: 50 queries per request | An upload is one batch of ~2 statements per page + 1 per MB + ~8 |
| D1: 100,000 rows written, 5 million rows read per day | An upload writes ~6–30 rows (artifact, version, pages, chunks, counters); opening an artifact reads ~10 |
| Workers: 10 ms CPU per request (with a burst allowance) | The server validates HTML with the native HTMLRewriter (`src/html-policy-server.ts`); the CLI checks pages locally first (`src/html-policy.ts`, with line numbers). Measured in production: 1 MB pages pass even after the burst allowance is spent. If heavy uploads exhaust it, Cloudflare answers 503 for a few seconds and the CLI retries |
| Workers + Pages Functions: 100,000 requests per day, shared by the app, the sandbox and the ops Worker | Opening an artifact in a browser is 2 requests (app page + sandbox frame); per-user rate limits (uploads 30/min, checks 60/min, sign-in polling per device code) and per-IP limits on API-key validation; the ops cron runs every 15 minutes (96/day) |
| Cron triggers: 5 per account | 1 |
| D1 Time Travel: 7 days | Deleted HTML stays restorable for 7 days (SECURITY.md) |
| Pages static assets: unlimited | — |

R2 is not used: it needs a payment card and Cloudflare documents no hard
spending cap for it (only billing at listed rates past the free tier), so it
does not meet the zero-spend rule. The code still supports an `ARTIFACTS` R2
binding (reads fall back to D1; `bun run migrate:r2` copies D1 blobs into R2
with SHA-256 verification), and the suite tests both backends, but enabling
R2 is optional future work only if Cloudflare ever offers a hard cap that
guarantees $0.

## Deploying (later)

1. WorkOS:
   - Create an environment and enable AuthKit.
   - Add the redirect URI `https://<host>/auth/callback`.
   - Add a webhook to `https://<host>/webhooks/workos` for these events:
     - `organization_membership.*`
     - `user.deleted`
     - `session.revoked`
     - `api_key.revoked`, `api_key.deleted`
     (`bun scripts/workos-setup.ts` does all of this through the WorkOS API.)
2. Cloudflare:
   - Run `wrangler d1 create htmlartifact` and put the ID in `wrangler.toml`.
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
