# htmlartifact — GA checklist

**Done =** in production at https://htmlartifact.pages.dev, two real accounts
walk the CLI flow end to end (sign up → create workspace → invite → join →
publish → member opens artifact → outsider blocked), and deleting an artifact
provably removes its R2 objects (every version).

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
- [ ] Codex review round 10
- [x] SECURITY.md (data handling, incident response, D1 Time Travel backups/restore) — revisit once Phase 2 lands

## Phase 3 — WorkOS (scoped)
- [x] SSO (SAML/OIDC) via Admin Portal link: `workspace sso`
- [x] Directory Sync (SCIM) via Admin Portal link: `workspace directory`; dsync deprovisioning revokes access (membership webhooks)
- [ ] MFA on in AuthKit (config only; documented)
- Dropped by Dhruv: Vault/encryption, Audit Logs, Events API, Radar, extra roles, FGA, domain auto-join, export

## Blocked on Dhruv
- [ ] Enable R2 in the Cloudflare dashboard
- [ ] Write WorkOS keys to `~/.config/htmlartifact/workos.env`
- [ ] Ask WorkOS support to enable AuthKit Directory Provisioning; then set `HTMLARTIFACT_DIRECTORY_PROVISIONING=on` (deploy/app vars) and redeploy

## Phase 4 — Production
- [x] Pages configs `deploy/app`, `deploy/usercontent`, `deploy/ops`; `scripts/build-pages.ts` (verified with `wrangler pages dev`)
- [x] Cloudflare Pages project `htmlartifact` created (exact subdomain) — deploy blocked on R2
- [x] Sandbox Pages project `htmlartifact-usercontent` created (exact subdomain) — deploy blocked on R2
- [x] Ops Worker `src/ops.ts`: cron (R2 delete retries, retention) + rate-limit RPC entrypoint `Ops`
- [x] Staging config (Pages preview env + staging D1 created; staging R2 blocked on R2)
- [x] Rate limits (Workers rate-limit binding), logs/observability, deep `/healthz` (D1 + R2)
- [x] GitHub Actions written: ci.yml, deploy.yml (needs CLOUDFLARE_API_TOKEN secret), release.yml (npm trusted publishing)
- [x] package.json scripts: typecheck, build:pages, deploy:all, smoke
- [ ] Real WorkOS env: redirect URI, webhooks (`scripts/workos-setup.ts` ready; blocked on `~/.config/htmlartifact/workos.env`), MFA (dashboard)
- [x] `DEFAULT_API_URL` = https://htmlartifact.pages.dev
- [ ] First npm publish locally (claims the unclaimed `htmlartifact` name), then enable npm trusted publishing so release.yml publishes with provenance (no long-lived tokens)
- [ ] Create R2 buckets (prod + staging), run workos-setup, deploy:all, smoke
- [ ] Production walkthrough with two real accounts (item 4)
