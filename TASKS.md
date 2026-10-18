# htmlartifact — build checklist

Done = a teammate in WorkOS org A can publish from the CLI and read in browser + CLI;
a user in org B (or signed out) gets 401/redirect on every artifact URL; the
integration suite proves it; the default skills install with one command; repo public.

## Setup
- [x] Repo from postplan 0.0.5 npm source (MIT), import commit kept for provenance
- [x] Public GitHub repo `Dhruv2mars/htmlartifact`
- [x] Rename postplan → htmlartifact (CLI, env vars, cookies, headers, state dir)

## Auth (WorkOS)
- [x] Research current WorkOS APIs (AuthKit, sessions, CLI device flow, API keys, events)
- [x] Web sign-in via AuthKit, sealed sessions, org switching
- [x] CLI sign-in (device flow or minted keys) scoped to one org
- [x] Artifacts owned by an organization; reads require membership of that org
- [x] Remove anonymous uploads
- [x] Fast revocation (membership removal / user deletion)

## Product
- [x] Filesystem storage backend (S3 stays optional)
- [x] Proxy-agnostic client IP (no Railway assumptions)
- [x] Workspace feed: dashboard + `htmlartifact list --all`
- [x] `htmlartifact read <url>` for agents (authenticated fetch)
- [x] Server-hosted installer: CLI + default skills in one `curl | sh`

## Default skills (shipped in `skills/`)
- [x] `htmlartifact` — publish/update/list
- [x] `htmlartifact-read` — read an artifact URL
- [x] `htmlartifact-design` — how to write a good HTML artifact

## Verify
- [x] Integration tests (real Postgres, fs storage, mocked WorkOS) for every auth boundary
- [x] CLI end-to-end against a local server
- [x] No `postplan` references outside LICENSE/NOTICE/attribution
- [x] README, .env.example, Dockerfile
- [x] Nothing on this machine's postplan setup touched

## Found along the way
- [x] WorkOS emulator lets a refresh switch into a non-member org → membership now verified with WorkOS for every user credential (cached 5 min)
- [x] Emulator requires the API key for device authorize → CLI auth relayed through the server
- [x] Independent security review (Codex gpt-6.1-sol, high): 4 findings fixed with regression tests (CSRF Origin check, JWT client binding, order-independent webhooks, per-team slugs)
- [ ] Docker image build not verified (Docker not installed on this machine)
- [ ] Verify against a real WorkOS staging env (device flow enablement, refresh-switch behaviour)
