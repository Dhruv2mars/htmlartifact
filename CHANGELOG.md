# Changelog

Notable changes to the `htmlartifact` CLI and service. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each release is tagged `vX.Y.Z`
with the same version as the npm package (see CONTRIBUTING.md → Releasing).

## [Unreleased]

### Changed

- The CLI exits with a distinct code per kind of failure: 2 usage, 3 auth,
  4 not found, 5 validation, 6 network, 7 rate-limited (README → Exit codes).
- Every command takes `--json`, including `read`, `login`, `logout`,
  `workspace switch` and `workspace remove`, and under `--json` errors are a
  JSON object on stdout too.
- `upload --slug` that names a different artifact than the one the path was
  published to stops and says so (`--force` goes ahead), and an explicit slug
  never rebinds the path.
- `upload` in CI without `--slug` or `--draft` warns that every run publishes
  a new URL.
- `check <path>` works signed out (markup only) and reports line:column for
  each issue.
- A 429 is retried once after its `Retry-After`.

### Fixed

- `read --out` writes the stored bytes exactly (a UTF-8 byte order mark was
  dropped). `upload` refuses a file that is not UTF-8 instead of altering it.
- A rejected `HTMLARTIFACT_TOKEN` says the token was rejected, not "Not
  signed in", and `--json` errors say `npx htmlartifact` when run through npx.
- An expired sign-in link says "The sign-in link expired. Run: htmlartifact
  login" instead of "Sign-in failed: expired_token".
- The too-large message says by how much an upload is over ("1 byte over the
  1 MiB limit", not "1 MiB … limit 1 MiB"), and its fix no longer points at a
  flag no admin can set.

## [0.1.2]

### Fixed

- `login` after joining a workspace in the browser no longer says "You are
  not in a workspace yet": when the sign-in has no current workspace but you
  are in one, it switches to it (`--workspace <name>` picks among several, or
  it lists them with the `workspace switch` command). `whoami` says the same.

## [0.1.1]

Fixes from a first-time-user walkthrough of the live site and `npx htmlartifact`.

### Fixed

- Next-step hints and errors say `npx htmlartifact …` when the CLI was run
  through npx, so a pasted hint no longer fails with "command not found".
- `read` takes an artifact ID as well as a URL, like `delete`.
- Deleting a teammate's artifact as a plain member says why (only its author
  or a workspace admin can) instead of "Artifact not found".
- `login` into a workspace ends with the next step (`upload`), and the upload
  receipt's update command uses the path as you typed it.
- Web: the sign-in page for an invite link says it's an invite and shows the
  `workspace join` command; the artifact 404 says what to do next.

## [0.1.0]

First release.

### Added

- CLI (`npx htmlartifact`): `login`/`logout`/`whoami`, `upload`, `read`,
  `list`, `delete`, `check`, and `workspace` commands (create, invite, invites,
  join, list, switch, members, remove, delete, sso, directory, domains). Every
  command takes `--json`; CI signs in with a WorkOS organization API key in
  `HTMLARTIFACT_TOKEN`.
- Workspaces backed by WorkOS AuthKit organizations: membership checked live
  with WorkOS, revoked at once by webhooks; outsiders get the same 404 as a
  missing artifact.
- Artifact HTML served from a separate, cross-site sandbox origin with
  short-lived, viewer-bound capabilities and a strict CSP.
- Real deletion of artifacts and workspaces (every version and page), 30-day
  erasure of upload IP and user agent, and offboarding that revokes sessions,
  API keys, Admin Portal links and invite codes.
- HTML validation in the CLI (parse5, with line numbers) and on the server
  (Cloudflare HTMLRewriter, never looser than the CLI).
- Web app (React Router): landing, docs, sign-in, workspace feed, artifact
  history, workspaces, join links.
- Runs entirely on free tiers: Cloudflare Pages, Workers Free and D1 (artifact
  HTML stored in D1), with per-workspace and database quotas and rate limits
  sized to them.

[Unreleased]: https://github.com/Dhruv2mars/htmlartifact/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Dhruv2mars/htmlartifact/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Dhruv2mars/htmlartifact/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Dhruv2mars/htmlartifact/releases/tag/v0.1.0
