# Contributing to htmlartifact

Thanks for helping. Bug reports, fixes, docs and ideas are all welcome.
By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

- **Questions and ideas:** [Discussions](https://github.com/Dhruv2mars/htmlartifact/discussions).
- **Bugs and feature requests:** [open an issue](https://github.com/Dhruv2mars/htmlartifact/issues/new/choose).
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

## Before you open a pull request

Run what CI runs:

```sh
bun run typecheck && bun run typecheck:cli && bun run typecheck:web
bun run lint                     # knip: unused files, exports, dependencies
bun scripts/changelog.ts check   # CHANGELOG.md documents the package version
bun run test                     # full suite on D1, then on R2 (local only)
```

Then:

- Add a test that fails without your change, for bug fixes.
- Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for
  anything a user of the CLI or the service would notice.
- Fill in the pull request template. `main` is protected: CI must pass before
  a pull request can merge.

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

Maintainers only. Tags, GitHub releases and npm versions always match because
CI derives all three from `package.json`:

1. Open a pull request that bumps `version` in `package.json` and renames
   `## [Unreleased]` in CHANGELOG.md to `## [X.Y.Z] - YYYY-MM-DD` (add a fresh
   empty `## [Unreleased]` above it and update the compare links).
2. Merge it. `.github/workflows/release.yml` runs on `main`: if the tag
   `vX.Y.Z` does not exist yet, it runs the checks, publishes `htmlartifact@X.Y.Z`
   to npm (trusted publishing, with provenance), then creates the tag and a
   GitHub release whose notes are that CHANGELOG section.

The very first publish is manual, because npm trusted publishing is set up
in a package's settings on npmjs.com, so the package has to exist:

1. From an up-to-date `main`, run `npm publish --access public` (the
   `prepublishOnly` script builds the CLI), then run the Release workflow
   (Actions → Release → Run workflow). It sees the version on npm and only
   creates the tag and GitHub release.
2. Add the trusted publisher just before the next release, not earlier: a new
   configuration expires unless its first publish succeeds within 2 days. On
   npmjs.com → htmlartifact → Settings → Trusted publishing, add GitHub
   Actions with this repository and workflow `release.yml`, and allow direct
   `npm publish` (new configurations allow only `npm stage publish` by
   default). Then merge the version bump; the Release workflow's publish
   validates the configuration.
