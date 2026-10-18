---
name: htmlartifact
description: Publish an HTML artifact (plan, spec, report, review, mock, status page) that only the user's team can open, and return its link. Use when the user says htmlartifact, or asks to publish, share, or post something for their team, org, or workspace; to update an artifact they already published; to list the team's artifacts; or when an htmlartifact command fails. Never use it for postplan.
---

# htmlartifact

Publishes a page to the user's htmlartifact server. Only members of their
current team can open the link; everyone else gets a sign-in page or a 404.
Write the page with the `htmlartifact-design` skill. Open links someone shares
with the `htmlartifact-read` skill.

## Steps

1. **Check readiness:** `htmlartifact whoami`.
   - "Not signed in": ask the user to run `htmlartifact login` themselves (it
     opens a browser). Do not try to sign in for them.
   - "command not found": ask for their server URL, then have them run
     `curl -fsSL <server>/install.sh | sh`.
   - Check that the `Team:` line is the team that should see the page. If not,
     run `htmlartifact org list` and ask before `htmlartifact org switch <team>`.
2. **Write the page** following `htmlartifact-design`: one self-contained
   `.html` file, or a folder with an `index.html`. Keep the source at a durable
   path (inside the repo it is about, or `~/htmlartifacts/<name>.html`), never a
   temp dir: that path is how updates find the same artifact.
3. **Validate:** `htmlartifact check <path>`. Fix every error, and treat each
   warning as something that will break for the reader. Done when it prints
   `Ready.`
4. **Publish:** `htmlartifact upload <path> --json`. Read the exit code
   directly; do not pipe the output through `head` or `tail`.
5. **Report** the `url` and the `team` from the receipt. It is published only
   when the receipt says `"ok": true`.

## Updating

- **Re-upload the same path** (`htmlartifact upload <path>`) to publish a new
  version at the same URL. Regenerate the whole page each time: a version is a
  full snapshot, not a patch.
- **Moved or renamed the file?** Run `htmlartifact upload <new-path> --draft <id>`
  once; later bare uploads from the new path update the same artifact.
- **Stable URL across machines:** `--slug <name>` publishes at `/t/<team-id>/<name>`,
  and the same slug always updates that artifact. Slugs are per team.
- Use `--new` only when the user explicitly wants a separate artifact.

## Finding things

- `htmlartifact list`: what the user published in the current team.
- `htmlartifact list --all`: everything the team has published.
- The web dashboard at the server URL shows the same, plus version history.

## Failures

| Message | Do this |
|---|---|
| `Not signed in` / `sign-in expired` | Ask the user to run `htmlartifact login` |
| `Upload rejected (HTTP 422)` | Fix the listed issues, then `check` again |
| `HTTP 403 … permission` | The user's team role cannot publish; tell them |
| `HTTP 409 … custom URL` | Pick another `--slug` |
| `Could not reach …` | Network or server problem; report it, do not retry in a loop |

In CI, set `HTMLARTIFACT_TOKEN` (a team API key from the Team page) and
`HTMLARTIFACT_API_URL`; no login is needed.
