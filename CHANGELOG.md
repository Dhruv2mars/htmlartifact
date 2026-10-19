# Changelog

Notable changes to the `htmlartifact` CLI and service. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each release is tagged `vX.Y.Z`
with the same version as the npm package (see CONTRIBUTING.md → Releasing).

## [Unreleased]

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

[Unreleased]: https://github.com/Dhruv2mars/htmlartifact/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Dhruv2mars/htmlartifact/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Dhruv2mars/htmlartifact/releases/tag/v0.1.0
