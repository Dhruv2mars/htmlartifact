# Changelog

Notable changes to the `htmlartifact` CLI and service. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each release is tagged `vX.Y.Z`
with the same version as the npm package (see CONTRIBUTING.md → Releasing).

## [Unreleased]

### Added

- `workspace api-key create [--name] | list | revoke <id>` (admins): API keys
  for CI, accepted as `HTMLARTIFACT_TOKEN`. The key is shown once and stored
  only as a hash. It stops working when revoked, when the admin who created it
  leaves the workspace, or when the workspace is deleted. The README's CI
  section has a GitHub Actions example.
- `workspace leave`, and `workspace promote <email>` / `demote <email>`
  (admins). A workspace always keeps one admin: its last admin can't leave
  or be demoted.
- `workspace invites --all` also lists used-up, expired and revoked codes,
  with each code's status and who joined with it.
- `list --workspace <name>` lists another of your workspaces without
  switching; `read <custom-url-name> --workspace <name>` opens an artifact by
  its custom URL there.
- `prune <id-or-url> --keep <n>` deletes an artifact's old versions to free
  workspace storage, keeping the latest `n` (the URL and current version
  stay). Its author or a workspace admin can prune (API:
  `DELETE /api/drafts/:id/versions?keepLatest=N`).
- `check` and `list` show the workspace's storage used and left (`usage` in
  `--json`).
- `list` says who published the current version when it isn't the author
  (`updatedBy` in `--json`), and the upload receipt warns when you publish
  over a teammate's artifact.

### Changed

- `read` (and any CLI sign-in) opens artifacts in every workspace you are an
  active member of, as the browser does; uploads and deletes still act only
  on your current workspace. API keys still read only their own workspace.
- `list --json` prints `{ "drafts": [...], "usage": {...} }` instead of a bare
  array.
- Updating a teammate's artifact (by `--draft` or their `--slug`) is refused
  with HTTP 403, like deleting it, instead of 409.

### Fixed

- `workspace join` takes the full `/join/` link that `workspace invite`
  prints, not just the code.
- Joining with a used-up or revoked code of a workspace you are already in
  says "Already in …" instead of "invalid, expired, or used up".
- `workspace invite` refuses `--days` or `--max-uses` outside the allowed
  range (HTTP 422 with the range) instead of silently clamping them, and says
  "1 person" for a single use.
- `workspace remove` says that every earlier invite code was revoked, and how
  to create a new one.
- A removed member is told "You no longer have access to <workspace>"
  instead of "You are not in a workspace yet". Their artifacts are marked
  "(former member)" in `list --all` and the web feed, and deleting one as a
  plain member says only an admin can.
- Parallel uploads can no longer overshoot the workspace's storage quota or
  the database size guard: the check and the counter now commit in one
  transaction with the version.
- `workspace list` no longer shows a workspace that was just deleted.
- Deleting a multi-page artifact gave back more storage than it had used.

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
