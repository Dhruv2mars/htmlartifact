# Contributing to htmlartifact

Thanks for helping. Bug reports, fixes, docs and ideas are all welcome.
By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

- **Source:** <https://entire.com/et/dhruv2mars/htmlartifact> (public, on
  [Entire](https://docs.entire.com)). Clone it with the Entire CLI:
  `entire repo clone /et/dhruv2mars/htmlartifact`.
- **Bugs, feature requests, questions and patches:** email
  Dhruv2mars@gmail.com. For a patch, attach `git format-patch origin/main`.
- **Security problems:** never in public. Follow [SECURITY.md](SECURITY.md).

## Ground rules

- **Zero spend.** htmlartifact runs only on free tiers (Cloudflare Pages,
  Workers Free and D1; WorkOS Staging). Changes must not need a paid plan,
  add-on, usage-billed feature or paid third-party service, and must keep
  usage inside the free quotas (README → Storage and the free-tier budget).
  [CLAUDE.md](CLAUDE.md) has the full rule.
- **Workspace isolation is the product.** Any new route must be added to the
  route table in `test/isolation.test.js`, which proves outsiders get a 404.
- **Keep it small.** Prefer the smallest change that works, in the style of
  the code around it. Open an issue first for anything large.

## Setup

You need [Bun](https://bun.sh) and Node.js 24 (the CLI supports Node ≥ 20.10).

```sh
bun install
bun run dev:local   # WorkOS emulator + Worker at http://localhost:8787, fully offline
```

`dev:local` needs no accounts or keys. See the README's Development section for
the CLI and web app loops.

## The merge gate

Changes land on `main` through an Entire trail (a branch plus
`entire trail create`). `bun run check` is the merge gate. It runs everything
the old GitHub Actions CI ran, in order, and stops at the first failure.
Buildkite runs the same command on every push (`.buildkite/pipeline.yml`, the
free hosted `linux-small` queue) and reports it on the trail as a gate:

| Step | What |
|---|---|
| install | `bun install --frozen-lockfile` |
| typecheck | `bun run typecheck`, `typecheck:cli`, `typecheck:web` |
| lint | `bun run lint` under Bun (knip: unused files, exports, dependencies) |
| changelog | `bun scripts/changelog.ts check` (CHANGELOG.md documents the package version) |
| test | `bun run test`: builds the CLI and web app, then the full suite on D1, then on R2 (local only) |
| cli | the built CLI (`--version`, `--help`, `check` on a two-page site) on your Node and on Node 20.10, the `engines` minimum (downloaded once from nodejs.org and checked against its SHASUMS256.txt) |

Buildkite covers Linux; run it locally for macOS. Windows is no longer
tested. A trail merges only when, on its latest commit, rebased on `main`:

- Buildkite's `bun run check` passed, so `entire trail merge --dry-run`
  passes, and every finding from the trail's review agents is fixed or
  dismissed with a reason.
- Bug fixes come with a test that fails without the fix.
- New routes are in the isolation route table (`test/isolation.test.js`).
- `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) has a line for anything a
  user of the CLI or the service would notice.
- It stays on free tiers.

Then `entire trail approve` and `entire trail merge`. Deploying is a separate
step (README → Deploying).

## Dependencies

Nothing opens dependency updates any more. Every few weeks, run `bun outdated`,
update with `bun update` (minor and patch together), and merge it through the
gate like any change. `parse5` and `entities` stay pinned on purpose: the CLI
validator (parse5) and the server validator (HTMLRewriter + entities, the
version parse5 decodes with) are proven equivalent for those exact versions, so
upgrade them by hand only.

## Repository layout

| Path | What |
|---|---|
| `cli/` | The `htmlartifact` CLI (TypeScript + Effect), bundled to `dist/htmlartifact.js` |
| `src/` | The Worker: API, auth, storage, HTML validation, sandbox; `src/ops.ts` is the ops Worker |
| `web/` | The web app (React Router, SSR inside the Worker); see `web/DESIGN.md` |
| `deploy/` | Wrangler configs for the two Pages projects and the ops Worker |
| `scripts/` | Build, deploy, smoke test, WorkOS setup, release helpers |
| `test/` | `node --test` suites against a real local Worker and the WorkOS emulator |

## Releasing

Maintainers only. The tag, the npm version and `package.json` always match.
Release when `main` has CLI changes that npm doesn't (`npm view htmlartifact
gitHead` is the commit the latest version was built from).

1. On a trail, bump `version` in `package.json` and rename `## [Unreleased]`
   in CHANGELOG.md to `## [X.Y.Z] - YYYY-MM-DD` (add a fresh empty
   `## [Unreleased]` above it, and an `[X.Y.Z]:` link to the version's npm page
   at the bottom). Merge it.
2. Log in to npm as an owner of the package (`npm login`), then publish from
   exactly `origin/main`:

   ```sh
   git fetch origin && git switch --detach origin/main
   bun run release -- --dry-run   # the gate, then npm publish --dry-run: lists the tarball
   bun run release                # the gate (skipped if it passed on this commit), npm publish, tag vX.Y.Z on origin
   ```

   npm asks for your 2FA code. `release` refuses a version npm already has; if
   the publish worked but the tag push didn't, run it again and it only tags
   the commit npm recorded (`gitHead`).
3. The release notes are that CHANGELOG section
   (`bun scripts/changelog.ts notes X.Y.Z`).

Releases up to 0.2.2 have npm provenance. Later ones don't: npm can only sign
provenance for builds on a cloud-hosted GitHub Actions or GitLab CI/CD runner,
and this repository has neither. The trusted publisher for GitHub Actions on
npmjs.com is unused now.
