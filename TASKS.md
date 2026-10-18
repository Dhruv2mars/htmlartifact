# htmlartifact — GA checklist

**Done =** in production at https://htmlartifact.pages.dev, two real accounts
walk the CLI flow end to end (sign up → create workspace → invite → join →
publish → member opens artifact → outsider blocked), and deleting an artifact
provably removes its stored HTML (every version; D1 blobs until R2 is on).

## Phase 1 — TypeScript
- [x] `src/html-policy.ts` (shared by server + CLI), `tsconfig.json`
- [x] Server → strict TypeScript (Hono), `bun run typecheck` clean, 37 tests green
- [x] CLI → TypeScript + Effect, built with `bun build --target=node` → `dist/htmlartifact.js`
- [x] CLI commands for Phase 2/3 endpoints (server side pending): `delete`, `workspace delete --confirm`, `workspace sso`, `workspace directory`

## Phase 2 — Security
- [x] Real deletion: draft delete purges R2 objects for every version/page (+ cron backstop)
- [x] Artifact HTML on a cross-site sandbox origin (`htmlartifact-usercontent.pages.dev`), session-bound capabilities
- [x] Workspace deletion (admin): R2 + D1 + WorkOS org
- [x] Member offboarding: removal, `user.deleted` PII scrub, admins can delete any artifact
- [x] Retention: `source_ip`/`user_agent` erased after 30 days
- [x] Tenant-isolation sweep test over every route (37 routes, route table enforced; no leak found)
- [x] Codex (gpt-6.1-sol, high) security review round 4: 3 fixed (dsync deprovisioning, durable upload rollback, PII restore race); legacy-key finding N/A (no pre-branch prod data)
- [x] Codex review round 5: dsync handler re-reads directory state (stale events) and keeps per-directory-user email history (renames); other fixes confirmed sound
- [x] Codex review round 6: hand-rolled dsync reconciliation had 4 concurrency holes → replaced with WorkOS AuthKit Directory Provisioning (WorkOS owns directory→account linking; existing epoch-fenced membership webhook ends access); dsync portal gated on `HTMLARTIFACT_DIRECTORY_PROVISIONING=on`
- [x] Codex review round 7: invites can't reactivate offboarded members; user-owned API keys follow live membership; Admin Portal links carry the admin's ID and are revoked on removal/deactivation (dropped-table finding N/A: never deployed)
- [x] Codex review round 8: removed people can't rejoin via old invites until `workspace reinstate`; portal sessions revoked on demotion; links minted across offboarding revoked (live re-check); auth-test flake (shared race winner) fixed
- [x] Codex review round 9 (retried after an OpenAI safety-filter false positive): removal marker had ordering races → replaced with time-bounded invite revocation on removal (one-way, order-independent); no reinstate command needed
- [x] Review round 10 (Claude Opus; Codex at usage limit until 23:28): revoke on `.deleted` unconditionally, never on created/updated; user.deleted revokes in their workspaces; join undone if its code was revoked mid-join; admins can list/revoke invite codes (`workspace invites`)
- [x] Review round 11 (Claude Opus): removed-outside-app rejoin undone by the late .deleted event (joins table: which code admitted whom); undo is queued + grants nothing meanwhile; undo's own webhook revokes nothing; user.deleted uses live/joined workspaces only; revoke-all unbounded; HA-prefix parsing fix
- [x] Review round 12 (Claude Opus), my part: stale join rows; reclaim a membership whose undo is queued; undo drops the membership cache; undo on partial join failure; cron favours fewest attempts; admins (and org CI keys for CI artifacts) can update teammates' artifacts; sandbox limits list downloads/plain links; expired capability asks for a reload
- [x] Round 12 agent: auth rate limits (key format check, hashed negative cache, per-IP limiter before WorkOS validation; device/refresh limits keyed per token; CLI 429 backoff, refresh lock + re-read, logout revokes the session) — merged, 134/134
- [x] Round 12 agent: HTML validated in bounded memory (custom parse5 tree adapter, no child lists: 4 MB dense page 258 MB → 9 MB peak heap; 0 diffs vs old validator on ~300k generated pages); size checked before parsing; upload body cap 3× + 64 KiB
- [ ] Once real WorkOS keys land, verify: /portal/revoke_link responses (unknown user → ?), org API key values start with `sk_`, revokeSession 404 for unknown session
- [x] Review round 13 (Claude Opus): validator stops at depth limit, caps attributes (linear duplicate check; parse5 pinned 7.3.0), checks declarative shadow roots; IPv6 /64 limits; recently-valid keys skip IP bucket; streamed body size limit; CLI lock/rename hardening — 155/155
- [x] D1 blob storage (R2 needs a card): `blobs` chunked ≤1 MB, written in the version's atomic batch; R2 when ARTIFACTS bound (reads fall back to D1); deletion clears both; suite runs on both backends; `bun run migrate:r2` (copy → SHA-256 verify → delete from D1; refuses to delete until /healthz says r2); README Storage section
- [ ] Tomorrow (Dhruv's card): enable R2 + Workers Paid ($5/mo: Free caps CPU at 10 ms/request ≈ uploads > ~150 KB fail with 1102), then README → Storage → Switching to R2
- [x] Final Codex review (gpt-6.1-sol): one finding (migration could re-upload HTML of an artifact deleted mid-copy) → fixed: post-upload reference check drops it (queued retry), script refuses to run until the app reads R2; everything else confirmed (157/157 on D1 and on R2)
- [x] PR #1 opened (ga/production → main); not merged (Dhruv merges)
- [x] SECURITY.md (data handling, incident response, D1 Time Travel backups/restore) — revisit once Phase 2 lands

## Phase 3 — WorkOS (scoped)
- [x] SSO (SAML/OIDC) via Admin Portal link: `workspace sso`
- [x] Directory Sync (SCIM) via Admin Portal link: `workspace directory`; dsync deprovisioning revokes access (membership webhooks)
- [ ] MFA on in AuthKit (config only; documented)
- Dropped by Dhruv: Vault/encryption, Audit Logs, Events API, Radar, extra roles, FGA, domain auto-join, export

## Blocked on Dhruv
- [ ] Write WorkOS keys to `~/.config/htmlartifact/workos.env`
- [ ] Ask WorkOS support to enable AuthKit Directory Provisioning; then set `HTMLARTIFACT_DIRECTORY_PROVISIONING=on` (deploy/app vars) and redeploy

## Phase 4 — Production
- [x] Pages configs `deploy/app`, `deploy/usercontent`, `deploy/ops`; `scripts/build-pages.ts` (verified with `wrangler pages dev`)
- [x] Cloudflare Pages project `htmlartifact` created (exact subdomain) — deploys on D1 storage, blocked only on workos.env
- [x] Sandbox Pages project `htmlartifact-usercontent` created (exact subdomain) — deploys on D1 storage, blocked only on workos.env
- [x] Ops Worker `src/ops.ts`: cron (R2 delete retries, retention) + rate-limit RPC entrypoint `Ops`
- [x] Staging config (Pages preview env + staging D1 created; staging R2 comes with the switch)
- [x] Rate limits (Workers rate-limit binding), logs/observability, deep `/healthz` (D1 + R2)
- [x] Limits that survive offices and agents: API key format check + negative cache + per-IP validation limit; sign-in limited per device code / refresh token (loose per-IP ceiling); CLI backs off on 429, coordinates refreshes (lock + re-read); `logout` revokes the WorkOS session
- [x] GitHub Actions written: ci.yml, deploy.yml (needs CLOUDFLARE_API_TOKEN secret), release.yml (npm trusted publishing)
- [x] package.json scripts: typecheck, build:pages, deploy:all, smoke
- [ ] Real WorkOS env: redirect URI, webhooks (`scripts/workos-setup.ts` ready; blocked on `~/.config/htmlartifact/workos.env`), MFA (dashboard)
- [x] `DEFAULT_API_URL` = https://htmlartifact.pages.dev
- [ ] First npm publish locally (claims the unclaimed `htmlartifact` name), then enable npm trusted publishing so release.yml publishes with provenance (no long-lived tokens)
- [ ] Run workos-setup, deploy:all (D1 storage), smoke
- [ ] Production walkthrough with two real accounts (item 4)
