# htmlartifact — checklist

Done = through the CLI alone (as an agent would): sign up/in → create a
workspace → invite → others join → publish → every member can open the
artifact, and nobody outside the workspace can. Verified by tests against the
real Worker runtime + the official WorkOS emulator, and by hand in a browser.

## Done
- [x] Start from postplan 0.0.5 (MIT), rename to htmlartifact, public repo
- [x] Use Postplan for real (CLI, publish, browser, sign-in, list) to learn the workflow
- [x] Serverless: one Cloudflare Worker (Hono) + R2 + D1; no servers, no Docker
- [x] WorkOS AuthKit for accounts, sign-up and workspaces (organizations)
- [x] CLI sign-in through the browser (device flow, relayed by the Worker)
- [x] `workspace create | invite | join | list | switch | members | remove`
- [x] Invite codes: admin-only, expiring, use-limited; also `/join/<code>` links
- [x] Artifacts belong to a workspace; only members can open them (browser, token, CI key)
- [x] Membership checked with WorkOS; webhooks revoke immediately; order-independent
- [x] CSRF origin check, JWT bound to our client, open-redirect guard, strict CSP
- [x] Browser: sign in, workspace feed, mine, version history, join, switch
- [x] Non-member opening a link → join → lands back on the link
- [x] `bun run dev:local`: fully offline stack (emulator + Worker)
- [x] 35 tests (API, browser flows, CLI end-to-end, revocation, security)
- [x] Walked the flow by hand in a browser (Alice publishes via CLI; Bob signs in, joins, opens it)
- [x] Skills removed for now

## Later (by request)
- [ ] Create the WorkOS account; set up a real environment
- [ ] Verify against real WorkOS (device flow, refresh-into-org, webhooks)
- [ ] Deploy the Worker (D1, R2, secrets) and pick the domain
- [ ] Set `DEFAULT_API_URL`, publish the CLI to npm so `npx htmlartifact` works
- [ ] Optional: serve artifacts from a separate domain for extra isolation (Postplan uses per-artifact subdomains)
- [ ] Optional: CI API keys from the CLI (`workspace keys create`), SSO setup links
