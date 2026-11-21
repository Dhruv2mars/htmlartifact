# htmlartifact

<sub>Developed on <a href="https://entire.com/et/dhruv2mars/htmlartifact">Entire</a>. The GitHub copy is a read-only mirror for CI; open issues and changes on Entire.</sub>

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
| `login [--workspace <name>]` / `logout` / `whoami` | Sign in or create an account; show who you are and your current workspace. In several workspaces, `login` asks which one at a terminal; elsewhere it keeps the finished sign-in, and `login --workspace <name>` completes it without the browser |
| `workspace create <name>` | New workspace; you are its admin |
| `workspace invite` | Invite code + join link (admins). `--max-uses` (1 to 50), `--days` (1 to 30) |
| `workspace invites [--all] [--revoke <code\|all>]` | List live invite codes (`--all`: every code, its status and who joined), or revoke one or all (admins) |
| `workspace join <code-or-link>` | Join with a code or its `/join/` link |
| `workspace list` / `switch <name>` | Your workspaces; change the current one |
| `workspace members` / `remove <email>` | See members; remove one (admins). Access ends immediately, and every invite code issued until then is revoked (they may hold one): share a fresh code with the team. Fresh codes don't let the removed person back in |
| `workspace removed` / `allow-back <email>` | People you removed, whom invite codes don't let back in; let one rejoin with a code again (admins). Someone who left on their own is never on this list |
| `workspace promote <email>` / `demote <email>` | Make a member an admin, or an admin a member (admins). One admin always remains |
| `workspace leave [--workspace <name>] [--yes]` | Leave the current workspace, or another one. It asks first at a terminal; elsewhere it needs `--yes`. Its last admin promotes someone first. The workspace's invite codes keep working (an admin who leaves revokes the ones they created), and if exactly one workspace is left, it becomes the current one |
| `upload <file-or-folder>` | Publish. Re-uploading the same path publishes a new version at the same URL (the CLI remembers the artifact per workspace and path, so a file published in two workspaces is two artifacts). `--slug <name>` gives a stable URL within the workspace; on a path already published, the slug goes to that artifact. A slug that names another artifact than the path was published to needs `--force`, and so does a new slug for a path whose artifact already has one (else rename it with `--draft <id> --slug <name>`). `--description <text>` sets the description; `--description ""` clears it |
| `read <url-or-id>` | Download an artifact with your sign-in (how agents read links), from any workspace you are in. `--out <file>` picks where; `--workspace <name>` reads a custom URL name there |
| `list [--all] [--workspace <name>]` | Your artifacts, or the whole workspace's; `--workspace` lists another of your workspaces |
| `delete <id-or-url>` | Delete an artifact; its HTML (every version) is erased. An admin deleting someone else's artifact confirms with `--yes` |
| `prune <id-or-url> --keep <n>` | Delete an artifact's old versions, keeping the latest `n`, to free workspace storage (`check` and `list` show what's used and left) |
| `workspace api-key create [--name <label>]` / `list` / `revoke <id>` | API keys for CI (admins). The key is shown once; it stops working when revoked, when the admin who created it leaves the workspace or stops being an admin, or when the workspace is deleted |
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

Some refusals also carry a stable `code` in the `--json` error, with the
fields named here:

| `code` | Command | Exit | Meaning |
|---|---|---|---|
| `slug_names_another_artifact` | `upload --slug` | 2 | The slug names another artifact than the path was published to (`--force` replaces it) |
| `artifact_has_another_slug` | `upload --slug` | 2 | The path's artifact (`draftId`) already has another custom URL (`slug`): rename it with `--draft <id> --slug <name>`, or `--force` for a separate artifact |
| `mapped_artifact_not_found` | `upload` | 4 | The artifact this path was published to (`draftId`) is not in the current workspace: deleted, or (a mapping saved by CLI 0.2.2 or older) in another of your workspaces |
| `confirm_teammate_artifact` | `delete` | 2 | Someone else published it (`author`, `title`, `versionCount`): re-run with `--yes` |
| `cli_too_old` | `upload` | 1 | This CLI is older than the server accepts (`minVersion`; HTTP 426): update with `npx htmlartifact@latest` and run the same command again |
| `daily_budget` | `upload`, admin commands | 7 | Today's D1 write budget for that kind of change is spent (HTTP 429, `Retry-After` until 00:00 UTC) |
| `creation_closed` | `workspace create` | 1 | htmlartifact is full for new teams right now (HTTP 507, `reason`: `storage` or `uploads`); joining with an invite still works |

`upload --json` prints a receipt:

```jsonc
{
  "ok": true,
  "action": "updated",          // "created" (new artifact), "updated" (new version), "unchanged" (same content: no new version)
  "draftId": "k3j9x0a1b2c4",    // never changes; `--draft <id>` always updates this artifact
  "slug": "weekly-report",      // or null
  "versionNumber": 4,
  "url": "https://…/w/acme/weekly-report",
  "rawUrl": "https://…/w/acme/weekly-report/raw",   // the HTML with a token (`read`); its source in a browser
  "versionUrl": "https://…/d/k3j9x0a1b2c4/v/4",     // this version, pinned
  "contentHash": "…",
  "totalBytes": 18213,          // the HTML's size
  "storedBytes": 4120,          // what the workspace's storage counts (pages go up and are stored gzip-compressed); null from older servers
  "account": "Alice",
  "workspace": "Acme",
  "pages": null,                // multi-page uploads: [{ "path", "url" }]
  "changedFields": ["description"], // what else this upload changed: "title", "description", "slug"
  "updateCommand": "htmlartifact upload report.html --draft k3j9x0a1b2c4",
  "warnings": [],               // e.g. the title changed (another document at a reused path?), CI without --slug
  "notices": []                 // the warnings that have a stable code: [{ "code": "cli_outdated", "message", "fix" }]
}
```

The CLI names itself in its User-Agent (`htmlartifact/<version>`). An upload
from a CLI older than the newest on npm (`HTMLARTIFACT_LATEST_CLI_VERSION`,
default the server's own version) gets the `cli_outdated` notice (and the same
text in `warnings`); one older than the server's floor
(`HTMLARTIFACT_MIN_CLI_VERSION`, default 0.2.1) is refused with `cli_too_old`.

A page with no `<title>` is named after its first `<h1>`, else its file name.
A pruned version's URL answers agents with a 404 that says so and gives the
latest version (`X-Htmlartifact-Latest-Version`); members' browsers go to the
artifact's history.

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
bun run check       # the merge gate: all of the above and the built CLI on Node 20.10
```

The source is at <https://entire.com/et/dhruv2mars/htmlartifact>. See
[CONTRIBUTING.md](CONTRIBUTING.md) before sending a change.

`dev:local` seeds `alice@`, `bob@` and `carol@example.com`. Sign in with any of
them on the emulator's login page. The CLI's sign-in link opens a local page
where you pick which user the CLI signs in as and confirm its code, so several
people can be tested side by side (one `HTMLARTIFACT_HOME` each).

## Storage and the free-tier budget

htmlartifact runs entirely on Cloudflare's free plans (Workers Free, Pages, D1)
and WorkOS Staging, with no payment card on the Cloudflare account, so it
cannot be billed: past a quota, Cloudflare returns errors until the daily reset
(00:00 UTC) instead of charging. See `CLAUDE.md` (zero spend).

Artifact HTML lives in D1 (`src/storage.ts`): each object is split into
≤ 1 MB rows of a `blobs` table, written in the same atomic batch as the version
that references them, so a fresh artifact opens for teammates immediately (D1,
not KV: KV is eventually consistent). Deleting an artifact or workspace
deletes every chunk of every version (test/deletion.test.js checks every
table for leftovers after each kind of deletion).

The CLI (0.3.0 and later) sends each page gzip-compressed. The server inflates
it inside validation (1 MiB of HTML per upload at most; one gzip member with
nothing after it), stores the bytes it received (a `.gz` key), and serves them
with `Content-Encoding: gzip`, inflating only for clients that don't accept
gzip. Quotas count stored bytes, so a workspace holds 3–7× more HTML. Versions
stored before that stay plain text and keep serving. Inflating a dense 1 MiB
page takes about 2 ms of CPU.

The app's own limits keep usage inside the free quotas (numbers from
Cloudflare's docs: Workers limits, D1 limits and pricing, Pages Functions
pricing, checked 2026-10-19):

| Free quota | App limit or usage |
|---|---|
| D1: 500 MB per database (5 GB per account) | Uploads stop when the database would pass 450 MB (`HTMLARTIFACT_DATABASE_LIMIT_BYTES`); each workspace holds at most 50 MiB of HTML, every version counted (`HTMLARTIFACT_WORKSPACE_QUOTA_BYTES`); 1 MiB per upload (2 MiB flagged), 10 pages |
| D1: 50 queries per request | An upload is one batch of ~2 statements per page + 1 per MB + ~8 |
| D1: 100,000 rows written per day | Three budgets, each counted as D1 measures it (`meta.rows_written`, index entries included) and split per workspace: uploads 40,000 a day, one workspace 4,000 (`HTMLARTIFACT_UPLOAD_ROWS_PER_DAY`, `…_PER_WORKSPACE_DAY`); social writes 20,000 / 2,000 (`HTMLARTIFACT_ENGAGE_ROWS_…`, none yet); invites, CI keys, joins, role changes and new workspaces 20,000 / 2,000 (`HTMLARTIFACT_OPS_ROWS_…`). A one-page upload writes 19 rows (14 for a new version of an artifact, 7 for unchanged content), so a workspace can publish about 280 versions a day and the deployment about 2,800. Past a budget, that kind of change gets a 429 with `Retry-After` until 00:00 UTC, and the others keep working; reading, signing in, webhooks, removing members, leaving, revoking and deleting are never budgeted and write in the remaining 20,000 |
| New workspaces (beta gate) | Creating a workspace (API and web) closes while the database holds more than 60% of its limit, or once the upload budget was 80% spent on 3 of the last 7 days: `creation_closed`, HTTP 507. Joining with an invite stays open |
| D1: 5 million rows read per day | Lists read one page of 100 (keyset cursor on an index); opening an artifact reads ~10 rows. Not budgeted in the app: past it, Cloudflare refuses D1 queries (errors, no charge) until 00:00 UTC |
| Workers: 10 ms CPU per request (with a burst allowance) | The server validates HTML with the native HTMLRewriter (`src/html-policy-server.ts`); the CLI checks pages locally first (`src/html-policy.ts`, with line numbers). Measured in production: 1 MB pages pass even after the burst allowance is spent. If heavy uploads exhaust it, Cloudflare answers 503 for a few seconds and the CLI retries |
| Workers + Pages Functions: 100,000 requests per day, shared by the app, the sandbox and the ops Worker | Opening an artifact in a browser is 2 requests (app page + sandbox frame); per-user rate limits (uploads 30/min, checks 60/min, sign-in polling per device code) and per-IP limits on API-key validation; the ops cron runs every 15 minutes (96/day). Not budgeted in the app (counting would cost a D1 write per request): past it, Cloudflare answers Worker and Functions requests with Error 1027 (no charge) until 00:00 UTC, so artifacts, sign-in and the API are down for the rest of the day; static assets stay free and unlimited (checked 2026-10-21: Workers limits, Pages Functions pricing) |
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

## Deploying

Production (https://htmlartifact.pages.dev) runs `main`. A maintainer ships it
from a local checkout once a trail is merged:

```sh
git fetch origin && git switch --detach origin/main
bun run ship   # bun run check (skipped if it passed on this commit), deploy:all, smoke
```

`bun run check` counts as passed if it passed in this checkout or, with the
[`gh` CLI](https://cli.github.com) logged in, in a successful CI run of the same
commit on the GitHub mirror; otherwise `ship` runs it first.

`ship` refuses unless HEAD is exactly `origin/main` with a clean tree, and
prints the commit of the last production deployment before it deploys (Pages
records the commit of each deployment; the ops Worker version is tagged with
it). It needs
Cloudflare credentials: `bunx wrangler login`, or `CLOUDFLARE_API_TOKEN` (Pages,
Workers Scripts and D1 Edit) and `CLOUDFLARE_ACCOUNT_ID`. `bun run ship --
--staging` does the same for `origin/staging` and
https://staging.htmlartifact.pages.dev. If smoke fails, roll back: Cloudflare
dashboard → Workers & Pages → each Pages project → Deployments → Rollback,
and `bunx wrangler rollback` in `deploy/ops`.

To run your own copy:

1. Cloudflare: create two Pages projects (the app and the sandbox for artifact
   HTML) and a D1 database. Every name and URL of a deployment lives in
   `deploy/app/wrangler.toml`, `deploy/usercontent/wrangler.toml` and
   `deploy/ops/wrangler.toml`: set yours there (project `name`s, the D1
   `database_id`, `HTMLARTIFACT_PUBLIC_BASE_URL` and
   `HTMLARTIFACT_SANDBOX_ORIGIN`, the ops Worker's name in the app's
   `[[services]]`). The scripts below read them from there.
2. WorkOS: create an environment with AuthKit, put `WORKOS_API_KEY` and
   `WORKOS_CLIENT_ID` in `~/.config/htmlartifact/workos.env`, check the plan
   with `bun scripts/workos-setup.ts --dry-run`, then run it without
   `--dry-run`. It registers the redirect URI `<app>/auth/callback` and the
   webhook `<app>/webhooks/workos` (`organization_membership.*`,
   `organization.deleted`, `user.deleted`, `session.revoked`,
   `api_key.revoked`), and stores the secrets on both Pages projects and the
   ops Worker.
3. Set `HTMLARTIFACT_COOKIE_PASSWORD` (32+ characters) the same way on both
   Pages projects: `bunx wrangler pages secret put HTMLARTIFACT_COOKIE_PASSWORD --project-name=<project>`.
4. `bun run deploy:all` (ops Worker, then both Pages projects), then
   `bun run smoke` (or `bun run smoke -- <app url> <sandbox url>` for any
   other host).

The CLI defaults to `https://htmlartifact.pages.dev` (`DEFAULT_API_URL` in
`cli/env.ts`); point it elsewhere with `HTMLARTIFACT_API_URL`. Releases are
published to npm with `bun run release` ([CONTRIBUTING.md](CONTRIBUTING.md#releasing)).

## Credits

htmlartifact started from the MIT-licensed npm release of
[Postplan](https://www.npmjs.com/package/postplan) 0.0.5 by t3dotgg. The HTML
validator, artifact serving rules and CLI upload flow come from it. See
`NOTICE`.

## Security

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for attribution.
