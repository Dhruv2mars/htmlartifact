# htmlartifact

Publish HTML artifacts from coding agents (plans, specs, reviews, reports, UI
mocks) to your team. **Only members of your team can open them.** Everyone
else gets a sign-in page or a 404.

- **Teams are WorkOS organizations.** Sign-in is [WorkOS AuthKit](https://workos.com/authkit),
  so SSO, SCIM provisioning, MFA and domain capture come from WorkOS.
- **Agents publish with a CLI** and a bundled set of default skills, so Claude
  Code, Codex, or any agent that reads `~/.agents/skills` knows how to write,
  publish and read artifacts.
- **Self-hosted.** It needs Node, Postgres, and a disk or any S3-compatible bucket.

```sh
htmlartifact upload plan.html
# URL: https://artifacts.acme.com/d/k3j9x0a1b2c4
# Team: Acme (visible to its members only)
```

## For teammates

```sh
curl -fsSL https://<your-server>/install.sh | sh   # CLI + default skills
htmlartifact login                                  # browser sign-in, works over SSH
```

| Command | What it does |
|---|---|
| `htmlartifact upload <file-or-folder>` | Publish, or publish a new version of the same path |
| `htmlartifact check <path>` | Validate against the server's rules without publishing |
| `htmlartifact read <url>` | Download an artifact using your sign-in (agents use this) |
| `htmlartifact list [--all]` | Your artifacts, or the whole team's |
| `htmlartifact org list` / `org switch <team>` | See or change the team you publish to |
| `htmlartifact whoami` / `logout` | Check or clear your sign-in |

In CI, set `HTMLARTIFACT_API_URL` and `HTMLARTIFACT_TOKEN` (a team API key that
an admin creates on the **Team** page) instead of logging in.

## Default skills

`skills/` ships with the server, and `install.sh` installs all of them:

| Skill | Purpose |
|---|---|
| `htmlartifact` | Publish, update and list artifacts; handle failures |
| `htmlartifact-read` | Open an artifact link someone shared |
| `htmlartifact-design` | How to write an artifact a teammate can actually use |

Add a folder named `htmlartifact-<name>/SKILL.md` to ship another skill to
everyone on the next install.

## How access works

| Who | Credential | Checked on every request |
|---|---|---|
| Browser | AuthKit sign-in, WorkOS sealed-session cookie | Session valid, user is an **active member** of the artifact's organization |
| CLI | WorkOS access token from the device flow (refresh token kept in `~/.htmlartifact`, mode 600) | JWT signature (WorkOS JWKS), then the same membership check |
| CI | WorkOS organization API key | Key valid in WorkOS; its owning org must own the artifact |

- **Membership is confirmed with WorkOS**, never taken from a token claim
  alone. The result is cached for `HTMLARTIFACT_MEMBERSHIP_CACHE_SECONDS`
  (default 300).
- **WorkOS webhooks revoke access immediately.** When a member is removed, a
  user is deleted, or a session or key is revoked, the next request is denied,
  even if the token hasn't expired yet.
- **Other teams get the same 404 as a missing artifact**, so artifact URLs
  reveal nothing to outsiders.
- **People in several teams switch automatically** when they open a link to
  another team they belong to.
- **Artifact HTML runs under a strict CSP.** Scripted pages run in an
  opaque-origin sandbox with no network or storage access, so they can't
  read the session cookie.
- **Nothing is anonymous.** Uploads and reads always need a credential.

## Self-hosting

### 1. WorkOS (free up to 1M monthly active users)

1. Create a WorkOS environment, and enable **AuthKit** under User Management.
2. **Redirects:**
   - Callback URI: `https://<your-server>/auth/callback`
   - Sign-out redirect: `https://<your-server>`
3. **Roles:** keep `admin` and `member`. Optional: add a permission such as
   `artifacts:publish` and set `HTMLARTIFACT_PUBLISH_PERMISSION` to it. Members
   without that permission can read but not publish.
4. **Webhooks** (recommended): add an endpoint at `https://<your-server>/webhooks/workos`
   with these events:
   - `organization_membership.created`, `organization_membership.updated`, `organization_membership.deleted`
   - `user.deleted`
   - `session.revoked`
   - `api_key.revoked`

   Put its secret in `WORKOS_WEBHOOK_SECRET`.
5. Optional:
   - **Audit Logs:** register `artifact.published` and `artifact.deleted`,
     then set `HTMLARTIFACT_AUDIT_LOGS=true`.
   - **API Keys:** enable it for CI publishing.

Team admins set up SSO, directory sync and domain verification themselves:
**Team → Single sign-on and provisioning** opens the WorkOS Admin Portal.

### 2. Run it

```sh
cp .env.example .env    # fill in WorkOS keys, a cookie password, the public URL
docker compose up -d    # app + Postgres, artifacts stored on a volume
```

Without Docker, you need Node 20.10+, Postgres, and [Bun](https://bun.sh) to
build the CLI bundle:

```sh
bun install && bun run build:cli && bun run start
```

### Configuration

| Variable | Required | Meaning |
|---|---|---|
| `HTMLARTIFACT_PUBLIC_BASE_URL` | yes | Public origin, e.g. `https://artifacts.acme.com`. Use `https://*.artifacts.acme.com` to give each artifact its own subdomain (needs wildcard DNS + TLS) |
| `HTMLARTIFACT_COOKIE_PASSWORD` | yes | 32+ random characters; encrypts the session cookie |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | yes | From the WorkOS dashboard |
| `DATABASE_URL` | yes | Postgres connection string |
| `HTMLARTIFACT_STORAGE_DIR` | one of | Store artifacts on disk |
| `AWS_S3_BUCKET_NAME`, `AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | one of | Or any S3-compatible bucket (AWS, R2, MinIO) |
| `WORKOS_WEBHOOK_SECRET` | no | Enables instant revocation |
| `HTMLARTIFACT_PUBLISH_PERMISSION` | no | WorkOS permission required to publish |
| `HTMLARTIFACT_ALLOW_TEAM_CREATION` | no | `false` stops signed-in users from creating new teams |
| `HTMLARTIFACT_AUDIT_LOGS` | no | `true` sends publish/delete events to WorkOS Audit Logs |
| `HTMLARTIFACT_MEMBERSHIP_CACHE_SECONDS` | no | How long a confirmed membership is trusted (default 300) |
| `HTMLARTIFACT_TRUST_PROXY` | no | Express `trust proxy` setting (default: private networks) |
| `HTMLARTIFACT_CLIENT_IP_HEADER` | no | A trusted single-IP header, e.g. `cf-connecting-ip` |
| `MAX_ACCOUNT_HTML_BYTES`, `MAX_PAGES_PER_UPLOAD` | no | Upload limits (4 MiB, 50 pages) |

## Development

```sh
bun install
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres bun run test
```

The tests run the real app against the official
[WorkOS emulator](https://github.com/workos/emulate), a real Postgres and disk
storage. They cover sign-in, cross-team isolation, org switching, webhook
revocation, team admin, CI keys and the CLI end to end.

## Credits

htmlartifact started from the MIT-licensed npm release of
[Postplan](https://www.npmjs.com/package/postplan) 0.0.5 by t3dotgg: its
HTML validator, artifact serving and CLI. The auth, team model, and skills are
new. See `NOTICE`.

## License

MIT
