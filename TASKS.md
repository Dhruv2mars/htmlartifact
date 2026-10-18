# htmlartifact — build checklist

Done = a teammate in WorkOS org A can publish from the CLI and read in browser + CLI;
a user in org B (or signed out) gets 401/redirect on every artifact URL; the
integration suite proves it; the default skills install with one command; repo public.

## Setup
- [x] Repo from postplan 0.0.5 npm source (MIT), import commit kept for provenance
- [x] Public GitHub repo `Dhruv2mars/htmlartifact`
- [x] Rename postplan → htmlartifact (CLI, env vars, cookies, headers, state dir)

## Auth (WorkOS)
- [ ] Research current WorkOS APIs (AuthKit, sessions, CLI device flow, API keys, events)
- [ ] Web sign-in via AuthKit, sealed sessions, org switching
- [ ] CLI sign-in (device flow or minted keys) scoped to one org
- [ ] Artifacts owned by an organization; reads require membership of that org
- [ ] Remove anonymous uploads
- [ ] Fast revocation (membership removal / user deletion)

## Product
- [ ] Filesystem storage backend (S3 stays optional)
- [ ] Proxy-agnostic client IP (no Railway assumptions)
- [ ] Workspace feed: dashboard + `htmlartifact list --all`
- [ ] `htmlartifact read <url>` for agents (authenticated fetch)
- [ ] Server-hosted installer: CLI + default skills in one `curl | sh`

## Default skills (shipped in `skills/`)
- [ ] `htmlartifact` — publish/update/list
- [ ] `htmlartifact-read` — read an artifact URL
- [ ] `htmlartifact-design` — how to write a good HTML artifact

## Verify
- [ ] Integration tests (real Postgres, fs storage, mocked WorkOS) for every auth boundary
- [ ] CLI end-to-end against a local server
- [ ] No `postplan` references outside LICENSE/NOTICE/attribution
- [ ] README, .env.example, Dockerfile
- [ ] Nothing on this machine's postplan setup touched
