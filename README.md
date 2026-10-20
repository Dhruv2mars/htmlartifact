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
| `workspace invite` | Invite code + join link (admins). `--max-uses` (1 to 50), `--days` (1 to 30) |
| `workspace invites [--all] [--revoke <code\|all>]` | List live invite codes (`--all`: every code, its status and who joined), or revoke one or all (admins) |
| `workspace join <code-or-link>` | Join with a code or its `/join/` link |
| `workspace list` / `switch <name>` | Your workspaces; change the current one |
| `workspace members` / `remove <email>` | See members; remove one (admins). Access ends immediately, and every invite code issued until then is revoked (they may hold one): share a fresh code with the team |
| `workspace promote <email>` / `demote <email>` | Make a member an admin, or an admin a member (admins). One admin always remains |
| `workspace leave` | Leave the current workspace (its last admin promotes someone first) |
| `upload <file-or-folder>` | Publish. Re-uploading the same path publishes a new version at the same URL. `--slug <name>` gives a stable URL within the workspace (a slug that names another artifact than the path was published to needs `--force`) |
| `read <url-or-id>` | Download an artifact with your sign-in (how agents read links), from any workspace you are in. `--out <file>` picks where; `--workspace <name>` reads a custom URL name there |
| `list [--all] [--workspace <name>]` | Your artifacts, or the whole workspace's; `--workspace` lists another of your workspaces |
| `delete <id-or-url>` | Delete an artifact; its HTML (every version) is erased |
| `prune <id-or-url> --keep <n>` | Delete an artifact's old versions, keeping the latest `n`, to free workspace storage (`check` and `list` show what's used and left) |
| `workspace api-key create [--name <label>]` / `list` / `revoke <id>` | API keys for CI (admins). The key is shown once; it stops working when revoked, when the admin who created it leaves the workspace, or when the workspace is deleted |
| `workspace delete --confirm <name>` | Delete the current workspace and everything in it (admins) |
| `workspace sso` / `directory` / `domains` | WorkOS Admin Portal link for your IT admin: SSO (SAML/OIDC), SCIM directory, or domain verification (admins). SSO and directory links are off unless the deployment sets `HTMLARTIFACT_ENTERPRISE_CONNECTIONS=on` (WorkOS bills each connection) |
| `check <path>` | Validate against the rules without publishing (signed out or offline: markup only) |

Every command takes `--json` for agents: stdout is then one JSON object (an
error too: `{ "ok": false, "error", "kind", "exitCode" }`), and anything else
goes to stderr.

| Exit code | Meaning |
|---|---|
| 0 | Success |
| 1 | Any other failure (server error, conflict, local file) |
| 2 | Usage: bad arguments or flags |
| 3 | Auth: not signed in, sign-in expired, token rejected, or not allowed |
| 4 | Not found: no such artifact, workspace, member or path |
| 5 | Validation: the HTML (or another input) was refused |
| 6 | Network: htmlartifact could not be reached |
| 7 | Rate-limited: still refused after waiting out `Retry-After` once |
| 130 | Interrupted (Ctrl-C) |

### Publishing from CI

In CI, set `HTMLARTIFACT_TOKEN` to a workspace API key instead of logging in.
A workspace admin creates one (it is shown only once):

```sh
npx htmlartifact workspace api-key create --name "GitHub Actions"
```

Save it as a repository secret named `HTMLARTIFACT_TOKEN` (Settings → Secrets
and variables → Actions), then publish from a workflow. Give the upload a
`--slug` (or `--draft <id>`) so every run updates the same URL: a re-upload
otherwise finds its artifact through a path mapping kept in `~/.htmlartifact`,
which a CI run throws away, so each run would publish a new artifact at a new
URL (the CLI warns when it detects CI):

```yaml
# .github/workflows/publish-report.yml
name: Publish report
on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npx --yes htmlartifact upload report.html --slug weekly-report
        env:
          HTMLARTIFACT_TOKEN: ${{ secrets.HTMLARTIFACT_TOKEN }}
```

The key publishes as the workspace (artifacts show the key's name), can't
manage the workspace, and works until it's revoked (`workspace api-key list`,
`workspace api-key revoke <id>`). A WorkOS organization API key also works as
`HTMLARTIFACT_TOKEN`.

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

No servers to run. One Worker bundle (`src/index.ts`) is deployed to two
Cloudflare Pages projects, plus a small ops Worker:

| Piece | Service |
|---|---|
| API, web pages | Pages project `htmlartifact` ([Hono](https://hono.dev)), https://htmlartifact.pages.dev |
| Artifact HTML, served to viewers | Pages project `htmlartifact-usercontent`: the same bundle on a separate, cross-site origin (SECURITY.md) |
| Cron (deletion retries, 30-day retention) and rate limits | Worker `htmlartifact-ops` (`src/ops.ts`) |
| Artifact HTML, index, invites, caches | Cloudflare D1 (schema created automatically; see Storage) |
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
bun run typecheck && bun run typecheck:cli && bun run typecheck:web
bun run lint        # knip: unused files, exports and dependencies
bun run test        # builds the CLI, then the full suite twice: D1 storage, then R2 (real Worker + official WorkOS emulator)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

`dev:local` seeds `alice@`, `bob@` and `carol@example.com`. Sign in with any of
them on the emulator's login page. The CLI's browser sign-in is auto-approved
as Alice.

## Storage and the free-tier budget

htmlartifact runs entirely on free tiers: Cloudflare Workers Free, Pages, D1
and R2's free tier, and WorkOS's free tier. It must never be billed
(`CLAUDE.md`, zero spend). Past a Workers or D1 quota, Cloudflare returns
errors until the daily reset (00:00 UTC) instead of charging.

Artifact HTML lives in R2 when the `ARTIFACTS` bucket is bound, and in D1
otherwise (`src/storage.ts`). Metadata (workspaces, versions, counters) is
always in D1. On D1, each object is split into ≤ 1 MB rows of a `blobs` table,
written in the same atomic batch as the version that references them. Either
way a fresh artifact opens for teammates at once (not KV: KV is eventually
consistent), and deleting an artifact or workspace deletes every object of
every version.

### Why R2 can't bill

R2 needs a payment card and has no spending cap: past its free tier it bills.
So the cap is built into the architecture, and every R2 cost is bounded below
the free tier (R2 pricing, checked 2026-10-20):

| R2 free tier (per month) | Bound |
|---|---|
| 10 GB-month of storage (average of each day's peak) | Uploads stop when the HTML stored, all workspaces and versions, would pass 9 GB (`HTMLARTIFACT_STORAGE_LIMIT_BYTES`). Checked in the same D1 transaction that commits the version, so concurrent uploads can't overshoot it |
| 1,000,000 Class A operations (PutObject, ListObjects, …) | A daily budget in D1 (`daily_budget`): 30,000 a day (`HTMLARTIFACT_R2_CLASS_A_PER_DAY`), so at most 31 × 30,000 = 930,000 a month. Each page an upload writes is one; each list a deletion makes is one. An upload that doesn't fit is refused before anything is written (HTTP 429, `Retry-After` to 00:00 UTC); a deletion that doesn't fit stays queued and the ops cron retries it |
| 10,000,000 Class B operations (GetObject, HeadObject) | Not counted, bounded by construction: only the Worker can reach the bucket, every request makes at most one R2 read (serving a page, or `/healthz`), and Workers Free stops at 100,000 requests a day for the whole account (Pages Functions included). So at most 31 × 100,000 = 3,100,000 a month |
| DeleteObject, egress | Free |

The bound holds only while the Worker is the only way in. So, on the
Cloudflare account:

- The bucket stays private: no `r2.dev` URL and no custom domain
  (`bun run deploy:all` refuses to deploy otherwise).
- No R2 S3 API tokens, and no other bucket on the account (the free tier is
  per account; staging stays on D1).
- Standard storage only (Infrequent Access has no free tier), and Workers
  stays on the Free plan.

`bun run migrate:r2` moves HTML already in D1 into R2 once (about one Class A
and one Class B operation per object, outside the daily budget; a few hundred
objects at most).

### Other free quotas

The app's own limits keep usage inside the other free quotas (numbers from
Cloudflare's docs: Workers limits, D1 limits and pricing, Pages Functions
pricing, checked 2026-10-19):

| Free quota | App limit or usage |
|---|---|
| D1: 500 MB per database (5 GB per account) | Uploads stop when the database would pass 450 MB (`HTMLARTIFACT_DATABASE_LIMIT_BYTES`); each workspace holds at most 50 MiB of HTML on D1, 250 MiB on R2, every version counted (`HTMLARTIFACT_WORKSPACE_QUOTA_BYTES`); 1 MiB per upload (2 MiB flagged), 10 pages |
| D1: 50 queries per request | An upload is one batch of ~2 statements per page + 1 per MB (D1 storage) + ~8 |
| D1: 100,000 rows written, 5 million rows read per day; past either, every query fails until 00:00 UTC | Uploads draw on a daily budget of rows written (`daily_budget`): 40,000 for the deployment (`HTMLARTIFACT_UPLOAD_ROWS_PER_DAY`) and 4,000 per workspace (`HTMLARTIFACT_UPLOAD_ROWS_PER_WORKSPACE_DAY`), counted as 2 × (4 + pages + D1 chunks) per upload to cover index entries: ~300 one-page uploads per workspace a day. Past it, HTTP 429 with `Retry-After` to 00:00 UTC, so no tenant can use up the day for everyone. Opening an artifact reads ~10 rows |
| Workers: 10 ms CPU per request (with a burst allowance) | The server validates HTML with the native HTMLRewriter (`src/html-policy-server.ts`); the CLI checks pages locally first (`src/html-policy.ts`, with line numbers). Measured in production: 1 MB pages pass even after the burst allowance is spent. If heavy uploads exhaust it, Cloudflare answers 503 for a few seconds and the CLI retries. CPU, not storage, sets the upload limits, so they are the same on R2 |
| Workers + Pages Functions: 100,000 requests per day, shared by the app, the sandbox and the ops Worker | Opening an artifact in a browser is 2 requests (app page + sandbox frame); per-user rate limits (uploads 30/min, checks 60/min, sign-in polling per device code) and per-IP limits on API-key validation; the ops cron runs every 15 minutes (96/day) |
| Cron triggers: 5 per account | 1 |
| D1 Time Travel: 7 days | Deleted HTML stored in D1 stays restorable for 7 days (SECURITY.md); R2 deletes are immediate |
| Pages static assets: unlimited | — |

## Deploying

Production deploys from `main` through GitHub Actions (`.github/workflows/deploy.yml`),
once CI has passed on the pushed commit; `staging` deploys to
https://staging.htmlartifact.pages.dev the same way. To run your own copy:

1. Cloudflare: create the Pages projects `htmlartifact` and
   `htmlartifact-usercontent` and a D1 database, and put its ID in
   `deploy/app/wrangler.toml`, `deploy/usercontent/wrangler.toml` and
   `deploy/ops/wrangler.toml` (the hostnames in those files are this
   deployment's; change them for yours).
2. WorkOS: create an environment with AuthKit, put `WORKOS_API_KEY` and
   `WORKOS_CLIENT_ID` in `~/.config/htmlartifact/workos.env`, set your app's
   URL in `scripts/workos-setup.ts` (`app`, hardcoded to this deployment), and
   run `bun scripts/workos-setup.ts`. It registers the redirect URI
   `<app>/auth/callback` and the webhook `<app>/webhooks/workos`
   (`organization_membership.*`, `organization.deleted`, `user.deleted`,
   `session.revoked`, `api_key.revoked`), and stores the secrets on both Pages
   projects and the ops Worker.
3. Set `HTMLARTIFACT_COOKIE_PASSWORD` (32+ characters) the same way on both
   Pages projects: `bunx wrangler pages secret put HTMLARTIFACT_COOKIE_PASSWORD --project-name=<project>`.
4. `bun run deploy:all` (ops Worker, then both Pages projects), then
   `bun run smoke -- https://<app host>`.

The CLI defaults to `https://htmlartifact.pages.dev` (`DEFAULT_API_URL` in
`cli/env.ts`); point it elsewhere with `HTMLARTIFACT_API_URL`. Releases are
published to npm by CI ([CONTRIBUTING.md](CONTRIBUTING.md#releasing)).

## Credits

htmlartifact started from the MIT-licensed npm release of
[Postplan](https://www.npmjs.com/package/postplan) 0.0.5 by t3dotgg. The HTML
validator, artifact serving rules and CLI upload flow come from it. See
`NOTICE`.

## Security

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for attribution.
