# htmlartifact — GA checklist

## Open-source cleanup (2026-10-19, branch chore/oss-cleanup)
Done = every item below is proven by `gh` output or the repo page in a browser,
CI is green on the PR, and the PR is open and ready for Dhruv to merge.
- [ ] Dead code removed (knip clean, wired into CI as `bun run lint`); typecheck ×3 + full suite green
- [ ] README, SECURITY.md, docs and TASKS.md match what shipped (Pages + ops Worker, D1 only)
- [ ] CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md (supported versions); private vulnerability reporting on
- [ ] LICENSE/NOTICE attribution to postplan verified against the npm tarball; vendored skills credited
- [ ] Issue forms, PR template, labels
- [ ] CI required on main via branch protection
- [ ] Dependabot (bun + GitHub Actions) and Dependabot alerts/security updates
- [ ] CodeQL and secret scanning (push protection)
- [ ] Release automation: CHANGELOG.md, tag `vX.Y.Z` = package.json = npm version
- [ ] Repo description, topics, homepage URL, social preview; Discussions; wiki off

## Dashboard setup (2026-10-19)
Done = requested WorkOS credentials saved and checked without exposing values, MFA saved, support request sent, and Cloudflare GitHub secrets listed; any blocked step records its exact stopping point.
- [x] WorkOS environment and local credential file (directory 700, file 600): Staging (WorkOS Staging for GA; Production is a post-GA step, only on Dhruv's go-ahead). Existing key copied through clipboard, values not printed.
- [x] WorkOS AuthKit TOTP MFA: enabled AuthKit prerequisite in Staging; Authentication → Features → Multi-factor auth changed Off → Required, saved and verified Required.
- [x] WorkOS Directory Provisioning support request: exact requested text sent through dashboard Contact support; confirmed “Message sent” / email follow-up; no ticket ID or environment-ID field shown.
- [x] Cloudflare scoped deploy token and GitHub Actions secrets: htmlartifact GitHub Actions Active, 1 Account, Pages/Workers Scripts/D1 Edit + Account Settings/User Details Read, no expiry/IP filter; CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID verified by name in Dhruv2mars/htmlartifact. Clipboard cleared.

**Done =** in production at https://htmlartifact.pages.dev, two real accounts
walk the CLI flow end to end (sign up → create workspace → invite → join →
publish → member opens artifact → outsider blocked), and deleting an artifact
provably removes its stored HTML (every version; D1 blobs).

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
- [x] (verified in the production walkthrough, Phase 4) Once real WorkOS keys land, verify: /portal/revoke_link responses (unknown user → ?), org API key values start with `sk_`, revokeSession 404 for unknown session
- [x] Review round 13 (Claude Opus): validator stops at depth limit, caps attributes (linear duplicate check; parse5 pinned 7.3.0), checks declarative shadow roots; IPv6 /64 limits; recently-valid keys skip IP bucket; streamed body size limit; CLI lock/rename hardening — 155/155
- [x] D1 blob storage (permanent: R2 has no hard spending cap, so it is not used): `blobs` chunked ≤1 MB, written in the version's atomic batch; R2 when ARTIFACTS bound (reads fall back to D1); deletion clears both; suite runs on both backends; `bun run migrate:r2` (copy → SHA-256 verify → delete from D1; refuses to delete until /healthz says r2); README Storage section; R2 migration kept only as optional future work
- [x] Zero-spend policy (Dhruv: not a penny): no card on Cloudflare — R2 has no hard cap, Workers Paid is $5/mo. Production stays on Workers Free + D1 permanently. SSO/Directory Sync links off by default (WorkOS bills $125/connection/mo); `HTMLARTIFACT_ENTERPRISE_CONNECTIONS=on` to offer them
- [x] Validation parses without source locations first (re-parses with them only to report issues): ~10–25% less CPU
- [x] Server validates with the native HTMLRewriter (`src/html-policy-server.ts`; parse5 stays in the CLI, `src/html-policy.ts`; shared rules in `src/html-policy-rules.ts`): parse5 cost 13–29 ms cold for 5–20 KB → error 1102. Selective callbacks (source pre-scan picks tag/attribute selectors), markers for script/title text, `<noscript>` read twice, `<select>`/`<frameset>`/template-`<col>` contexts and malformed SVG/MathML refused as `ambiguous-markup` (lol-html's foreign-content model differs: nested-svg breakouts, self-closed roots, ignored end tags). Never looser than parse5: ~150k generated pages, 0 violations; 300 realistic reports identical (test/html-policy-server.test.js)
- [x] `htmlartifact upload` checks markup locally with parse5 first (line/column; nothing sent on errors)
- [x] Measured production on Workers Free after the HTMLRewriter switch: reports/charts 5 KB–2 MB all pass 5/5 with burst allowance; after ~9 back-to-back 2 MB uploads Cloudflare returns 1102 (503) for large uploads while ≤1 MB reports and ≤500 KB charts still pass. D1-mode default lowered to 1 MiB (2 MiB flagged); CLI retries uploads on Cloudflare's 503 (5/15/30 s). Original note: (local workerd, validator only: ~1 ms warm / ~5 ms cold for 5 KB; 500 KB chart-heavy ~15–20 ms; 2 MiB chart-heavy ~50–90 ms, dense table ~8 ms — 2 MiB chart pages will not fit 10 ms)
- [x] Final Codex review (gpt-6.1-sol): one finding (migration could re-upload HTML of an artifact deleted mid-copy) → fixed: post-upload reference check drops it (queued retry), script refuses to run until the app reads R2; everything else confirmed (157/157 on D1 and on R2)
- [x] PR #1 opened (ga/production → main); not merged (Dhruv merges)
- [x] SECURITY.md (data handling, incident response, D1 Time Travel backups/restore) — revisit once Phase 2 lands

## Phase 3 — WorkOS (scoped)
- [x] SSO (SAML/OIDC) via Admin Portal link: `workspace sso`
- [x] Directory Sync (SCIM) via Admin Portal link: `workspace directory`; dsync deprovisioning revokes access (membership webhooks)
- [x] MFA on in AuthKit (Staging; Multi-factor auth Required, saved 2026-10-19)
- Dropped by Dhruv: Vault/encryption, Audit Logs, Events API, Radar, extra roles, FGA, domain auto-join, export

## Blocked on Dhruv
(nothing blocks GA; WorkOS Directory Provisioning request is with WorkOS support)
- [x] Write WorkOS keys to `~/.config/htmlartifact/workos.env` (Staging; verified 2026-10-19)
- [ ] WorkOS support asked 2026-10-19 to enable AuthKit Directory Provisioning (message sent, email follow-up pending); after confirmation set `HTMLARTIFACT_DIRECTORY_PROVISIONING=on` (deploy/app vars) and redeploy

## Phase 4 — Production
- [x] Pages configs `deploy/app`, `deploy/usercontent`, `deploy/ops`; `scripts/build-pages.ts` (verified with `wrangler pages dev`)
- [x] Cloudflare Pages project `htmlartifact` created (exact subdomain) — deploys on D1 storage, blocked only on workos.env
- [x] Sandbox Pages project `htmlartifact-usercontent` created (exact subdomain) — deploys on D1 storage, blocked only on workos.env
- [x] Ops Worker `src/ops.ts`: cron (R2 delete retries, retention) + rate-limit RPC entrypoint `Ops`
- [x] Staging config (Pages preview env + staging D1 created; no R2, zero-spend)
- [x] Rate limits (Workers rate-limit binding), logs/observability, deep `/healthz` (D1 + R2)
- [x] Limits that survive offices and agents: API key format check + negative cache + per-IP validation limit; sign-in limited per device code / refresh token (loose per-IP ceiling); CLI backs off on 429, coordinates refreshes (lock + re-read); `logout` revokes the WorkOS session
- [x] GitHub Actions: ci.yml, deploy.yml (CLOUDFLARE_API_TOKEN secret), release.yml (npm trusted publishing; since the OSS cleanup it releases on a package.json version bump merged to main)
- [x] package.json scripts: typecheck, build:pages, deploy:all, smoke
- [x] Real WorkOS env: redirect URI, webhooks (`scripts/workos-setup.ts`), MFA (dashboard)
- [x] `DEFAULT_API_URL` = https://htmlartifact.pages.dev
- [ ] (Dhruv, after merging chore/oss-cleanup) First npm publish locally from `main` (`npm publish --access public`; claims the unclaimed `htmlartifact` name), then add the repo + `release.yml` as trusted publisher on npmjs.com, then run the Release workflow to tag `v0.1.0` (CONTRIBUTING.md → Releasing)
- [x] workos-setup (redirect URI, webhook 7 events, secrets on both Pages projects + ops), deploy:all (D1 storage), smoke: all ok
- [x] Production walkthrough with two real accounts (2026-10-19, htmlartifact.pages.dev, real CLI + browser):
  - A (dhruv+haa@swayu.io): CLI device login → sign-up, email code, MFA (TOTP) enrollment → `workspace create "GA Walkthrough"` → `workspace invite` → `upload --slug ga-plan` (v1)
  - B (dhruv+hab@swayu.io): CLI device login → sign-up + MFA; as outsider: CLI read 404 (same as missing), browser shows "workspace you are not in", anonymous curl 401, no content leaked
  - B `workspace join <code>` → CLI read byte-identical to A's upload; browser shows the artifact framed from htmlartifact-usercontent.pages.dev (sandboxed)
  - A publishes v2, then `delete`: production D1 blobs 2 → 0 chunks, versions 2 → 0, drafts 0, queue empty; B's read → 404
  - Real WorkOS checks: org API keys are `sk_` + URL-safe (matches format check); /portal/revoke_link unknown user 200, unknown org 404; revokeSession unknown 404
- [x] (fixed) BLOCKER found in walkthrough: Workers Free enforces 10 ms CPU; parse5 validation cold costs ~13 ms at 5 KB → error 1102 for uploads > ~1–5 KB once burst allowance is spent. Fixed: server validation on native HTMLRewriter (CLI keeps parse5), Phase 2

## Zero-spend rule (CLAUDE.md, 2026-10-19)
- [x] Merged main (rules in CLAUDE.md/AGENTS.md)
- [x] R2: Cloudflare's R2 pricing page documents no hard spending cap → not enabled; D1 storage permanent; docs/config no longer present R2 or any paid plan as a pending step
- [x] Free-tier budget documented (README: Storage and the free-tier budget) with official quotas vs app limits
- [x] D1 Free caps a database at 500 MB: uploads stop at 450 MB (database size from D1's size_after), and each workspace holds at most 50 MiB of HTML (workspace_usage counter, moved in the upload and deletion batches)
