# htmlartifact — GA checklist

**Done =** in production at https://htmlartifact.pages.dev, two real accounts
walk the CLI flow end to end (sign up → create workspace → invite → join →
publish → member opens artifact → outsider blocked), and deleting an artifact
provably removes its R2 objects (every version).

## Phase 1 — TypeScript
- [x] `src/html-policy.ts` (shared by server + CLI), `tsconfig.json`
- [ ] Server → strict TypeScript (Hono), `bun run typecheck` clean, 37 tests green
- [x] CLI → TypeScript + Effect, built with `bun build --target=node` → `dist/htmlartifact.js`
- [x] CLI commands for Phase 2/3 endpoints (server side pending): `delete`, `workspace delete --confirm`, `workspace sso`, `workspace directory`

## Phase 2 — Security
- [ ] Real deletion: draft delete purges R2 objects for every version/page (+ cron backstop)
- [ ] Artifact HTML on a cross-site sandbox origin (`htmlartifact-usercontent.pages.dev`)
- [ ] Workspace deletion (admin): R2 + D1 + WorkOS org
- [ ] Member offboarding: removal, `user.deleted` PII scrub, admins can delete any artifact
- [ ] Retention: `source_ip`/`user_agent` erased after 30 days
- [ ] Tenant-isolation sweep test over every route
- [ ] SECURITY.md (data handling, incident response, D1 Time Travel backups/restore)

## Phase 3 — WorkOS (scoped)
- [ ] SSO (SAML/OIDC) via Admin Portal link: `workspace sso`
- [ ] Directory Sync (SCIM) via Admin Portal link: `workspace directory`; dsync deprovisioning revokes access
- [ ] MFA on in AuthKit (config only; documented)
- Dropped by Dhruv: Vault/encryption, Audit Logs, Events API, Radar, extra roles, FGA, domain auto-join, export

## Phase 4 — Production
- [ ] Cloudflare Pages project `htmlartifact` (advanced mode `_worker.js`, D1 + R2 bindings)
- [ ] Sandbox Pages project `htmlartifact-usercontent`
- [ ] Cron Worker for scheduled jobs (Pages has no cron triggers)
- [ ] Staging (Pages preview env + staging D1/R2/WorkOS)
- [ ] Rate limits (Workers rate-limit binding), logs/observability, health checks
- [ ] GitHub Actions: tests, deploy, npm publish with provenance
- [ ] Real WorkOS env: redirect URI, webhooks, MFA, SSO/DSync enabled
- [x] `DEFAULT_API_URL` = https://htmlartifact.pages.dev
- [ ] Publish CLI to npm
- [ ] Production walkthrough with two real accounts (item 4)
