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
- [ ] Real deletion: draft delete purges R2 objects for every version/page (+ cron backstop)
- [ ] Artifact HTML on a cross-site sandbox origin (`htmlartifact-usercontent.pages.dev`)
- [ ] Workspace deletion (admin): R2 + D1 + WorkOS org
- [ ] Member offboarding: removal, `user.deleted` PII scrub, admins can delete any artifact
- [ ] Retention: `source_ip`/`user_agent` erased after 30 days
- [ ] Tenant-isolation sweep test over every route
- [x] SECURITY.md (data handling, incident response, D1 Time Travel backups/restore) — revisit once Phase 2 lands

## Phase 3 — WorkOS (scoped)
- [ ] SSO (SAML/OIDC) via Admin Portal link: `workspace sso`
- [ ] Directory Sync (SCIM) via Admin Portal link: `workspace directory`; dsync deprovisioning revokes access
- [ ] MFA on in AuthKit (config only; documented)
- Dropped by Dhruv: Vault/encryption, Audit Logs, Events API, Radar, extra roles, FGA, domain auto-join, export

## Phase 4 — Production
- [x] Pages configs `deploy/app`, `deploy/usercontent`, `deploy/ops`; `scripts/build-pages.ts` (verified with `wrangler pages dev`)
- [ ] Cloudflare Pages project `htmlartifact` created + deployed (needs wrangler login)
- [ ] Sandbox Pages project `htmlartifact-usercontent` created + deployed
- [ ] Ops Worker `src/ops.ts`: cron (R2 delete retries, retention) + rate-limit RPC entrypoint `Ops`
- [ ] Staging (Pages preview env + staging D1/R2/WorkOS)
- [ ] Rate limits (Workers rate-limit binding), logs/observability, health checks
- [x] GitHub Actions written: ci.yml, deploy.yml (needs CLOUDFLARE_API_TOKEN secret), release.yml (npm trusted publishing)
- [ ] package.json scripts: typecheck, build:pages, deploy:all, smoke (CLI: build, typecheck:cli done)
- [ ] Real WorkOS env: redirect URI, webhooks, MFA, SSO/DSync enabled
- [x] `DEFAULT_API_URL` = https://htmlartifact.pages.dev
- [ ] First npm publish locally (claims the unclaimed `htmlartifact` name), then enable npm trusted publishing so release.yml publishes with provenance (no long-lived tokens)
- [ ] Production walkthrough with two real accounts (item 4)
