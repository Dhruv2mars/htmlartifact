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
| Artifact HTML | Cloudflare R2, or D1 until R2 is switched on (see Storage) |
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
bun run test        # builds the CLI, then the full suite twice: D1 storage, then R2 (real Worker + official WorkOS emulator)
```

`dev:local` seeds `alice@`, `bob@` and `carol@example.com`. Sign in with any of
them on the emulator's login page. The CLI's browser sign-in is auto-approved
as Alice.

## Storage

Artifact HTML is stored in R2 when the Worker has an `ARTIFACTS` bucket bound,
and in D1 otherwise (`src/storage.ts`). Production starts on D1 because R2
needs a card on the Cloudflare account.

- **D1:** each object is split into ≤ 1 MB rows of a `blobs` table, written in
  the same atomic batch as the version that references them, so a fresh
  artifact opens for teammates immediately (D1, not KV: KV is eventually
  consistent). Default limits are lower than on R2: 2 MiB per upload (4 MiB
  for flagged accounts) and 10 pages, which keeps an upload's D1 batch well
  inside Workers Free's 50 queries per request. D1 Free holds 5 GB.
- **R2:** 4 MiB per upload (16 MiB flagged), 50 pages. Reads fall back to D1,
  so objects stored before the switch keep working.
- Deleting an artifact or workspace deletes its objects in both.

**Switching to R2 (no downtime):**

1. Enable R2 in the Cloudflare dashboard (needs a payment method), then:
   `bunx wrangler r2 bucket create htmlartifact-artifacts` (and
   `htmlartifact-artifacts-staging`).
2. Uncomment the `r2_buckets` blocks in `deploy/app`, `deploy/usercontent` and
   `deploy/ops` `wrangler.toml`, and run `bun run deploy:all`. From here new
   artifacts go to R2; existing ones are still read from D1. `/healthz` reports
   `"storage": "r2"`.
3. `bun run migrate:r2` copies every D1 object into R2, downloads it again to
   compare SHA-256, and deletes it from D1 only after it matches. An object
   whose artifact was deleted during the copy is removed from R2 again. It
   refuses to run until `/healthz` reports `"storage": "r2"` (before that, the
   app could neither read moved objects nor delete their R2 copies), and is
   safe to re-run. `--dry-run` reports what would move; `--staging` targets
   staging.

The binding goes in before the migration (not after) so every object is
readable at every moment: during step 3 the app finds each object in R2 or,
until it moves, in D1.

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
   - Optional: R2 for artifact HTML (see Storage); without it, D1 is used.
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
