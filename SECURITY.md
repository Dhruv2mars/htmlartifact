# Security

htmlartifact stores HTML that teams treat as internal: plans, specs, reviews,
incident write-ups. This document says what we store, where, who can read it,
how long we keep it, how it is deleted, how we back it up, and what we do when
something goes wrong.

## Reporting a vulnerability

Open a private advisory at
<https://github.com/Dhruv2mars/htmlartifact/security/advisories/new>. Please do
not open a public issue. We acknowledge within 2 business days and aim to fix
critical issues within 7 days. We will credit you unless you ask us not to.

## What we store

| Data | Where | Notes |
|---|---|---|
| Artifact HTML (every version, every page) | Cloudflare R2 (or, until R2 is enabled, D1 table `blobs`), keyed `orgs/<organization>/drafts/<draft>/…` | Encrypted at rest by Cloudflare (AES-256). Never cached by browsers or shared caches (`Cache-Control: private, no-store`). |
| Artifact index: title, description, slug, repo name, git branch/commit subject, filename, sizes | Cloudflare D1 | Encrypted at rest by Cloudflare. |
| Upload request metadata: `source_ip`, `user_agent` | Cloudflare D1 (`draft_versions`) | **Erased after 30 days** by a scheduled job. |
| Workspace name and handle; invite codes (expiring, use-limited) | Cloudflare D1 | |
| Cached profile (name, email) and membership cache (5 minutes) | Cloudflare D1 | Scrubbed when WorkOS reports the user deleted. |
| Accounts, passwords, MFA factors, sessions, SSO and SCIM connections, organizations, memberships | WorkOS | htmlartifact never sees passwords or IdP credentials. |

We do not use analytics, ads, or third-party trackers. Logs (Cloudflare Workers
Logs) hold request paths and errors, never artifact HTML or credentials.

## Who can read an artifact

- An artifact belongs to the **workspace** (WorkOS organization) it was
  published in. Every read checks that the caller is an **active member** of
  that organization, confirmed with WorkOS (cached for at most 5 minutes and
  cleared at once by WorkOS webhooks). A token's organization claim alone is
  never trusted.
- Outsiders, including members of other workspaces, get the same 404 as a
  missing artifact, so a URL reveals nothing. A test sweeps every route with
  credentials from another workspace (`test/isolation.test.js`).
- Credentials: browser sessions are WorkOS sealed sessions in an `HttpOnly`,
  `Secure`, `SameSite=Lax` cookie; the CLI uses WorkOS access tokens bound to
  our client ID; CI uses WorkOS organization API keys. State-changing browser
  routes require a same-origin `Origin`/`Referer`.

## Artifact isolation (sandbox origin)

Artifact HTML may contain inline script. It never runs on the app's origin:

- The app (`htmlartifact.pages.dev`) serves a viewer page that frames the
  artifact from a **separate, cross-site origin**
  (`htmlartifact-usercontent.pages.dev`; `pages.dev` is on the Public Suffix
  List, so the two hosts are different sites). The app's session cookie is
  host-only and never sent there.
- The sandbox origin only accepts a short-lived, HMAC-signed capability scoped
  to one artifact version and one viewer. It re-checks membership and
  revocation on every request, and refuses deleted artifacts.
- Every artifact response also carries a CSP `sandbox` (opaque origin, so no
  storage or cookies), `connect-src 'none'` (no network), `form-action 'none'`,
  `frame-ancestors` limited to the app, and `Referrer-Policy: no-referrer`.
- The CLI (`htmlartifact read`) fetches raw HTML from the app with a bearer
  token; browsers cannot send that token on their own.

## Deletion

- **Artifacts:** `htmlartifact delete <id>` (the author or a workspace admin)
  makes the artifact unreadable immediately and deletes its stored HTML (every
  version and every page, in R2 and D1) and its D1 rows in the same request.
  If any delete fails, a scheduled job retries within 15 minutes, so the grace
  window is at most **15 minutes**. While artifact HTML is stored in D1 (production
  runs on D1 by its zero-cost policy), deleted HTML also stays in D1 Time Travel
  history for its retention window (7 days on Workers Free, 30 on Paid), then is
  gone; see Backups.
- **Workspaces:** `htmlartifact workspace delete --confirm <name>` (admins)
  blocks access at once, then deletes every artifact's R2 objects, every D1 row
  for the workspace, its invites and caches, and the WorkOS organization (which
  ends every membership). Partial failures are retried by the scheduled job.
- **People leaving:** removing a member (`workspace remove`, or the
  identity provider through Directory Sync) ends access on their next request.
  Their artifacts stay with the workspace, as company records; admins can
  delete them. When WorkOS reports a user deleted, we scrub their cached name
  and email.
- **Backups:** deleted D1 rows remain in D1 Time Travel history for its
  retention window (30 days on Workers Paid, 7 on Free), then are gone. That
  includes artifact HTML while it is stored in D1. R2 objects (if R2 is ever
  enabled) have no versioning or backups: once deleted they cannot be restored.

## Backups and restore

D1 Time Travel keeps point-in-time history of the database (30 days on Workers
Paid). R2 holds artifact HTML with Cloudflare's durability; it is not
separately backed up, by design, so that deletion is real.

Restore the database to a point in time:

```sh
# Find a bookmark for the moment before the incident
bunx wrangler d1 time-travel info htmlartifact --timestamp=2026-10-18T09:00:00Z
# Restore (overwrites the live database; take a fresh bookmark first)
bunx wrangler d1 time-travel restore htmlartifact --bookmark=<bookmark>
```

Export a full SQL dump (for example before a risky migration):

```sh
bunx wrangler d1 export htmlartifact --remote --output=htmlartifact-$(date +%F).sql
```

Restoring D1 does not bring back R2 objects deleted after the restore point;
those artifacts will 404.

## Enterprise controls (WorkOS)

- **SSO (SAML/OIDC):** off unless the deployment sets
  `HTMLARTIFACT_ENTERPRISE_CONNECTIONS=on` (WorkOS bills each SSO and
  directory connection). Then `htmlartifact workspace sso` gives an admin a WorkOS
  Admin Portal link to connect the company's identity provider;
  `workspace domains` verifies the email domain that routes people to it.
- **Directory Sync (SCIM):** `htmlartifact workspace directory` gives an
  Admin Portal link to connect the directory. Offboarding uses WorkOS AuthKit
  Directory Provisioning: WorkOS links directory users to accounts, and when
  the directory removes someone it deactivates their membership and revokes
  their sessions. The `organization_membership.updated` webhook makes the app
  re-check the membership live (never trusting the payload, so stale or
  out-of-order events are harmless), and access ends on their next request.
  Directory setup links are refused until WorkOS has enabled Directory
  Provisioning for the environment (`HTMLARTIFACT_DIRECTORY_PROVISIONING=on`),
  so a directory can never sync without offboarding.
- **Offboarding is complete:** a deactivated or removed member also loses
  their user-owned API keys (checked against their live membership), any
  Admin Portal session they opened (portal links carry their user ID and are
  revoked via `POST /portal/revoke_link`), and cannot rejoin through an old
  invite: invite codes are bearer credentials, so removing anyone (by an
  admin, the directory, or WorkOS) revokes every code the workspace issued up
  to that moment; admins issue a fresh one for the team. An inactive
  membership is never reactivated by an invite. Admin Portal sessions also end when an admin
  is demoted, and a link minted while a removal or demotion lands is revoked.
- **MFA:** enabled in AuthKit for password sign-ins.

## Incident response

1. **Triage (within 1 hour of a report):** confirm the issue, rate its
   severity, and name an owner.
2. **Contain:** depending on the issue, revoke sessions or API keys in
   WorkOS (webhooks revoke them here at once), rotate secrets
   (`wrangler pages secret put`; rotating `HTMLARTIFACT_COOKIE_PASSWORD` signs
   everyone out), roll back to the previous deployment
   (`wrangler pages deployment list` / Pages dashboard → Rollback), or take the
   service offline.
3. **Investigate:** Workers Logs (request paths, statuses, errors) and WorkOS
   logs (sign-ins, membership changes). Preserve evidence before restoring
   anything.
4. **Notify:** tell affected workspace admins without undue delay and within
   72 hours of confirming that their data was exposed: what happened, what
   data, what we did, what they should do.
5. **Recover and learn:** fix the root cause, add a test that fails without
   the fix, and write a short post-incident note.

## Secrets

`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_WEBHOOK_SECRET` and
`HTMLARTIFACT_COOKIE_PASSWORD` (32+ characters; also signs sandbox
capabilities) live only in Cloudflare secrets. They are never committed or
logged.
