# htmlartifact — GA checklist

## Run 3 fixes → 0.2.0 (2026-10-20)
Done = every R3-n finding below is fixed by a merged PR or marked skipped with
the reason; htmlartifact@0.2.0 published with provenance and tagged v0.2.0;
`npx htmlartifact@latest --version` → 0.2.0; Deploy green on main; live smoke
passes; a signed-out sanity pass on the published CLI.

Fix PRs (each merged after a green `test`): #14 CI keys, #15 server integrity,
#16 web, #17 CLI, #18 workspaces. Also merged: #5 nanoid 6 (Worker only), #6
GitHub Actions bumps, #9 WorkOS notes, #12 TASKS.
- [x] R3-1 parallel uploads overshoot the quota: #15 (quota and DB guard gate the version INSERT in the same D1 batch)
- [x] R3-2 `--slug` overwrites another artifact and rebinds the path: #17 (`--force` required, explicit slug never rebinds)
- [x] R3-3 `workspace join <link>` fails: #18
- [x] R3-4 `read --out` drops a BOM; non-UTF-8 altered: #17 (raw bytes; strict UTF-8, exit 5)
- [x] R3-5 just-deleted workspace still listed: #15
- [x] R3-6 "Not signed in" after last workspace deleted: #15 investigated, **not reproduced and not in our code** (most likely WorkOS revoked that session itself); tests pin `/api/me` → 200 with `workspace: null` after deletion. Still unconfirmed
- [x] R3-7 no way to create the CI credential: #14 (app-issued workspace API keys, hashed in D1; WorkOS org API keys not clearly free, cost evidence in the PR)
- [x] R3-8 no `workspace leave` / promote: #18 (`leave`, `promote`, `demote`; last admin kept)
- [x] R3-9 no version pruning, no usage visibility: #15 (`prune --keep`, `usage` in `check`/`list`)
- [x] R3-10 no cross-workspace view: #18 (`list`/`read --workspace`). Not done: an "all my workspaces" feed, parent orgs
- [x] R3-11 teammates can't see version history on the web: #16 (`/history/<id>`, 404 copy). Not done: CLI `versions <id>` (needs a versions API)
- [x] R3-12 spent/revoked invite codes vanish: #18 (`invites --all`, `invite_joins`)
- [x] R3-13 removed member's artifacts unmarked: #18 ("(former member)")
- [ ] R3-14 gaps (roles, sharing, SSO/Directory Sync off for zero spend, nested orgs): **skipped, stay as gaps**
- [x] R3-15 CLI `read` limited to the current workspace: #18 (bearer reads by active membership; writes and API keys stay scoped)
- [x] R3-16 `invite` silently clamps: #18 (422 with the range; "1 person")
- [x] R3-17 `workspace remove` doesn't say codes were revoked: #18
- [x] R3-18 exit codes always 1; `--json` gaps: #17 (codes 2–7; JSON errors; `--json` everywhere)
- [x] R3-19 CI runs without `--slug` make new URLs: #17 (warning) + README CI section (#14, #17)
- [x] R3-20 rejected `HTMLARTIFACT_TOKEN` says "Not signed in": #17
- [x] R3-21 `check` needs sign-in, `line: null`: #17
- [x] R3-22 generic join errors: #18 ("Already in …")
- [x] R3-23 removed member told "not in a workspace yet": #18
- [x] R3-24 join page gaps: #16 (expiry/uses left, bogus code says so, member offered Open/Switch). Kept: the signed-out page doesn't name the workspace (privacy)
- [x] R3-25 raw `expired_token`: #17
- [x] R3-26 web /workspaces without `npx`: #16
- [x] R3-27 admin overwrite keeps member as author: #15 (`updatedBy`, receipt warning)
- [x] R3-28 `Retry-After` ignored; update conflict 409: #15 (403) + #17 (one retry)
- [x] R3-29 large-uploads message: #17
- [x] Release PR #19 (0.2.0 bump, CHANGELOG, TASKS, README exit code 130) merged with green `test` (26e4e38)
- [x] Release workflow (run 39387102116): htmlartifact@0.2.0 published with SLSA provenance (sigstore logIndex 3333168543), tag v0.2.0 and GitHub release on 26e4e38; suite 216/216 in the publish step. npm's "bin[htmlartifact] … invalid and removed" warning also appeared for 0.1.2; the registry keeps `bin` for both
- [x] `npx htmlartifact@latest --version` → 0.2.0 (fresh HOME and npm cache)
- [x] Deploy green on main (run 39387926557); `bun run smoke` 11/11
- [x] Sanity pass (throwaway HOME): `login --help` ok; signed-out `check` on a file with an external script → "Checked markup locally", `line 6:1`, exit 5 (`--json` too: `offline: true`, line/column); `whoami` → exit 3
- [ ] Nit (found in the sanity pass): `check --json` signed out has `signedOut: "Not signed in. Run: htmlartifact login"` without `npx` (the human output says `npx htmlartifact login`)

## Real-world run 3 (2026-10-20, branch test/real-world-run3)
Done = three delegates (A startup of 5, B multi-level org, C engineering/CI) finish
their scenarios end to end against prod (https://htmlartifact.pages.dev,
`npx htmlartifact@latest` 0.1.2); every finding has evidence (commands, output,
screenshots, URLs) and repro steps, ranked bug / security / friction / missing
feature, with a suggested fix; HTML summary published; test data cleaned up; PR
open. No product code changed.

Aliases: dhruv+r3a1…r3a5 (A), dhruv+r3b1…r3b5 (B), dhruv+r3c1…r3c2 (C) @swayu.io;
workspaces prefixed "R3"; persona dirs under /tmp/r3/<persona>/ (HOME + HTMLARTIFACT_HOME);
one Helium profile (`--user-data-dir`) per persona; Helium GUI serialized with a lock.
- [x] Preflight: nested haiku computer-use subagent works (list_apps); Gmail code search works (code in snippet); per-persona Helium profiles via `--profile-directory=R3-<persona>` forwarded to the running Helium (a second `--user-data-dir` instance is invisible to computer-use: cgWindowNotFound)
- [x] Was blocked: Mac screen locked (CGSSessionScreenIsLocked=1) → computer-use sees no windows; delegates launched and wait at their first GUI step
- [ ] A: startup of 5 (founder, cofounder, 2 engineers, designer)
- [x] B: multi-level org (Exec / Eng / Sales; cross-workspace isolation): done, 5 personas, workspaces deleted; evidence /tmp/r3/evidence/B
  - Verified: B-1 against src/auth.ts:109-119 (bearer = strict org equality, cookie auto-switches); B quoted a README sentence that doesn't exist, finding stands without it. B-7 unconfirmed (seen once)
  - Process incident: b1's web sign-in and device confirm ran in the user's NORMAL Default Helium window (a haiku agent used `open -a Helium <url>`), 03:17–03:33 UTC; B also drove computer-use itself after 3 haiku attempts grabbed the wrong window. Cleaned: authkit.app + htmlartifact.pages.dev site data deleted in Default (cookie DB checked: none left), the stray tab closed; the 3 extra Helium profiles (created by the coordinator's first protocol) deleted via the profile picker, only "You" remains
- [x] C: engineering team (CI/agent use, limits, exit codes): done, 2 personas, 44 artifacts deleted, workspace deleted; evidence /tmp/r3/evidence/C
  - Verified against raw/ + code: C-1 (race1-3 all created, next 507 at 50.5 MiB; src/api.ts:666 checks before the batch), C-2 (slug collision outputs), C-5, C-8 (`response.text()` drafts.ts:65), C-10, C-12. No 503/1102/1015/D1 errors across ~50 × 1 MiB uploads + one 35-request rate-limit probe
- [x] Verify each delegate's findings against its evidence (A: invite clamps, join-link normalisation, removal timing, cleanup; B: auth.ts bearer scoping; C: quota race, slug collision, BOM, check, stale list)
- [x] Merged, ranked report below (29 findings: 0 security, 6 bugs, 8 missing features/gaps, 15 friction); HTML summary published in the T3 thread (html_render)
- [x] Cleanup: artifacts deleted, personas removed, workspaces deleted, all logged out; leftovers listed below
- [x] Commit, push, PR (linked)

### Run 3 report (ranked; findings only, no product code changed)
Evidence: `~/htmlartifact-evidence/run3/{A,B,C}/` on Dhruv's Mac (FINDINGS.md per delegate with verbatim output, log.md, raw outputs, screenshots; scanned: no tokens). IDs in brackets are the delegates' finding IDs. Every item below was checked by the coordinator against the evidence file and the cited code, except where marked.

**Security: no holes found.** Passed, with evidence:
- Cross-workspace isolation: a Sales member probing Eng (and the reverse) through CLI `read`/`delete`/`list --all`, the browser `/d/<id>`, and raw curl with their token on `/d/<id>/raw`, `/w/<handle>/<slug>`, `/d/<id>/v/1`, `DELETE /api/drafts/<id>` gets a 404 byte-identical to a nonexistent id (body 1665 B, ~0.8 s); sandbox origin without a capability 404; anonymous 401/302 [B, log.md Test 1]
- Removal is immediate: `remove` returned 04:01:09, the removed cofounder's CLI `list`/`read`/`upload` refused by 04:01:12, browser reload 404 [A removal-cli-probe.txt, B b5-browser-after-removal-*.png]; invite codes issued before the removal revoked (not listed; CLI and browser join refused) [A post-removal.txt]
- Use limits hold (1-use code admits exactly one) [A cli-joins.txt]; members refused on every admin action with a clear message [A, B, C]; a Sales admin has no reach into Eng [B]; teammates can't overwrite/delete others' artifacts (409/403) [C]
- Scripted mockup runs in the sandbox frame (htmlartifact-usercontent.pages.dev), clicks update the DOM [A a5-mockup-script-ran.png]; 0.1.2 login-after-browser-join fix holds [A]
- `read --out` byte-identical for latest, `/v/1`, `/raw`, slug URL, multi-page subpage [C read-sha.txt]; upload limits exact (1,048,576 B ok, +1 B → 422; 10 pages ok, 11 → 422); quota 507 clear; token refresh under 3 parallel uploads ok [C]
- Free tier: ~50 × 1 MiB uploads, 6 parallel uploads and one 35-request rate-limit probe: no 503/1102/1015, no D1 error [C]

**Bugs**
1. **R3-1 Parallel uploads overshoot the 50 MiB workspace quota** (med) [C-1]. Repro: fill to 49.6 MiB; 3 concurrent `upload raceN.html` (300 KB) → all `created`; next upload → 507 "50.5 MiB of 50 MiB". Cause: `src/api.ts:666` reads usage, the increment lands in a later batch (`:785-790`); the 450 MB database guard has the same gap. Fix: make the quota a conditional `UPDATE workspace_usage … WHERE stored_bytes + ? <= ?` inside the version's batch and gate the `draft_versions` insert on it.
2. **R3-2 `--slug` silently overwrites another artifact and rebinds the file's path** (med) [C-2]. Repro: `upload bench.html --slug bench-dashboard`; `upload changelog.html --slug changelog`; `upload changelog.html --slug bench-dashboard` → `updated` v2 of the dashboard (title now "Changelog"), no warning; afterwards plain `upload changelog.html` keeps updating the dashboard. Fix: `cli/commands/drafts.ts:137-141` warn + require `--force` when the slug resolves to a different artifact than the path's mapping; don't rebind on an explicit slug (`:209`); receipt warning in `src/api.ts:611-627`.
3. **R3-3 `workspace join <the /join/ link that invite prints>` fails** (low) [A-4]. Repro: `workspace join https://htmlartifact.pages.dev/join/HA-U26W-BUDE-E4XG` → "That invite code is invalid, expired, or used up."; the bare code works. Cause: `src/ids.ts:38` strips non-alphanumerics from the whole URL. Fix: take the last path segment, or match `HA-?[0-9A-Z]{4}-?…`.
4. **R3-4 `read --out` drops a UTF-8 BOM; non-UTF-8 uploads silently altered** (low) [C-8]. Repro: 132-byte BOM+CRLF file → stored intact, `read --out` writes 129 B; Latin-1 é → U+FFFD (111 → 113 B). Fix: `cli/commands/drafts.ts:65` write `Buffer.from(await response.arrayBuffer())`; `cli/source.ts:26,40` decode with `TextDecoder("utf-8", { fatal: true })` and report non-UTF-8.
5. **R3-5 `workspace list` still shows a just-deleted workspace (~60 s)** (low) [C-12]. Repro: `workspace delete --confirm "R3 EngTeam"` → `workspace list` → `R3 EngTeam (admin)`. Fix: filter organizations in `deleted_workspaces` (`src/api.ts:189-197`).
6. **R3-6 After its last workspace is deleted, one persona's CLI said "Not signed in", others "No workspaces yet"** (low, **unconfirmed**: seen once at B's cleanup, not reproduced; B log/FINDINGS B-7). Look at session revocation on `organization.deleted` (`src/webhooks.ts`).

**Missing features / gaps**
7. **R3-7 No way for an admin to create the CI credential the README prescribes** (high) [C-3]. README: "In CI, set HTMLARTIFACT_TOKEN to a WorkOS organization API key"; no CLI command, route or portal intent creates one (`src/api.ts:368-374` portal accepts sso/dsync/domain_verification only). Workaround (user access token from credentials.json) expires in 300 s, then "Not signed in". Fix: admin-only `workspace api-key create|revoke` backed by WorkOS org API keys (confirm free on Staging first), or document that the operator issues keys.
8. **R3-8 No `workspace leave`, no promote/transfer admin** (med) [A-3]. `workspace leave` → `Unknown subcommand`; sole admin `remove` self → "You cannot remove yourself." Fix: `DELETE /api/workspaces/members/me` reusing the removal path (refuse for the last admin) + `workspace leave`; optional `workspace promote <email>`.
9. **R3-9 No version pruning, no usage visibility** (med) [C-7]. One artifact reached v49 then 507; the only remedy is `delete` (URL and history lost); `check`/`list --json` show no usage. Fix: `DELETE /api/drafts/:id/versions?keepLatest=N` (src/purge.ts, decrement `workspace_usage`); usage in `/api/check` and `list`.
10. **R3-10 No cross-workspace view for leadership; no parent org; no `--workspace` flag** (med gap) [B-2]. Exec must join each department and `workspace switch`; `list --all --workspace "R3 Sales"` → `Unrecognized flag`. Fix (design): `--workspace <name>` on read/list, or an "all my workspaces" feed.
11. **R3-11 Teammates can't see version history on the web; 404 copy misleading** (low) [A-8]. `/mine/<teammate's id>` → "…your current workspace cannot see it" although `/d/<id>` and `/v/1` open. Fix: workspace-scoped history page (`src/web.ts:62-80`), `htmlartifact versions <id>`.
12. **R3-12 Spent/revoked invite codes vanish from `workspace invites`** (low) [A-11]. Fix: `--all` with status and who joined (`joins` table, `src/api.ts:252-266`).
13. **R3-13 A removed member's artifacts stay in the feed under their name, unmarked** (low, product decision) [A-12]. Fix: "(former member)" marker or `workspace remove --delete-artifacts`; adjust the 403 copy (`src/api.ts:438`).
14. **R3-14 Gaps (recorded, not bugs)** [B-3, B-4]: only admin/member roles (no viewer, per-artifact or cross-workspace sharing; dropped scope, Phase 3); SSO and Directory Sync off for zero spend (`workspace sso`/`directory` → "isn't available on this deployment yet. Contact support"); only domain verification is reachable; no nested orgs.

**Friction**
15. **R3-15 CLI `read <url>` only works in the current workspace; the browser auto-switches** (med) [B-1]. Repro: b1 (member of Eng) `workspace switch "R3 Sales"` → `read <Eng URL>` → "HTTP 404 … Not found in your current workspace"; the browser opens it. Cause: `src/auth.ts:118` bearer = strict org equality vs cookie auto-switch (`:71-76`, `:116`). Fix: for reads, grant if `activeMembership(viewer, draft.organization_id)`; keep writes scoped.
16. **R3-16 `invite` silently clamps options** (med) [A-1]. `--days 90 --max-uses 1000` → 30 days/50 uses; `--max-uses 0` → 1 ("up to 1 people"); `--days -3` → 1 day; all exit 0. Cause: `clampInt` at `src/api.ts:229-230`. Fix: 422 with the allowed range; validate in `cli/commands/workspace.ts:31-41`; "1 person".
17. **R3-17 `workspace remove` doesn't say it revoked every invite code** (med) [A-2, B-5]. Output is only "Removed <email>."; the team's shared link silently dies. Fix: `cli/commands/workspace.ts:138` add "Every invite code issued until now was revoked; create a new one with: npx htmlartifact workspace invite".
18. **R3-18 Exit codes always 1; `--json` errors not JSON for most commands; `read`/`login`/`logout` lack `--json`** (med) [C-4]. README says every command takes `--json`. Fix: `cli/main.ts:34-43` distinct codes (usage/auth/not-found/validation/network/rate-limit) and JSON errors under `--json`.
19. **R3-19 CI runs without `--slug` create a new URL every run** (med) [C-6]. Path mapping lives in `~/.htmlartifact/drafts` (`cli/state.ts:160-169`), thrown away by CI. Fix: warn when CI is detected (`cli/metadata.ts:25`) and neither `--slug` nor `--draft` is given; document next to HTMLARTIFACT_TOKEN.
20. **R3-20 Rejected `HTMLARTIFACT_TOKEN` says "Not signed in. Run: htmlartifact login"** (low-med) [C-5]; JSON path also skips the `npx` rewrite. Fix: say the env token was rejected (`cli/auth.ts:114-115`, `cli/http.ts:93-104`).
21. **R3-21 `check` needs sign-in and reports `line: null`; `upload` of the same file gives line:col** (low-med) [C-10]. Fix: merge local parse5 issues into the report and fall back to the offline report when signed out (`cli/commands/drafts.ts:234-252`).
22. **R3-22 Join errors are all one generic message, even "already a member"** (low) [A-5]. Fix: on a failed reservation, check membership in the code's org and return `alreadyMember` (`src/api.ts:452-464`).
23. **R3-23 Removed member is told "You are not in a workspace yet"; 404 hint points to an empty `workspace list`** (low) [A-6]. Fix: specific "You no longer have access to <workspace>" when a revoked marker exists (`src/api.ts:556-563`).
24. **R3-24 Join page: no expiry/uses left; bogus code still asks to sign up; current member offered "Join" to their own workspace; signed-out page doesn't name the workspace** (low) [A-7, B-6 (naming may be a deliberate privacy choice)]. Fix: `src/web.ts:119-135` + `web/app/pages/Join.tsx`.
25. **R3-25 Expired device code → raw "Sign-in failed: expired_token."** (low) [A-9]. Fix: `cli/commands/account.ts:94-96` map to "The sign-in link expired. Run: npx htmlartifact login".
26. **R3-26 Web /workspaces shows `htmlartifact …` without `npx`** (low) [A-10]. `web/app/pages/Workspaces.tsx:38,109-110`.
27. **R3-27 Admin overwrite via a member's slug keeps the member as author** (low) [C-9]. Fix: `updatedBy` in list; receipt warning.
28. **R3-28 CLI ignores `Retry-After` on 429; update conflict is 409 where delete is 403** (low) [C-11]. Fix: carry `retryAfter` in `requestJson` (`cli/http.ts:52-63`), retry once; 403 for the update case.
29. **R3-29 "ask an admin for the large-uploads flag" can't be acted on (no admin can set it); "1048577 bytes (1 MiB) … limit 1048576 bytes (1 MiB)"** (low) [C-12]. `src/html-policy-rules.ts:513`.

Observation (WorkOS config, not product code): AuthKit sign-up asks for a password (min 10 chars) and then an email code; no email-code-only path [A].

**Process notes (this run, not product):** the Mac screen was locked at the start (computer-use sees no windows; waited for unlock). Dhruv asked for his Default Helium profile only: the 3 extra profiles the first protocol created were deleted via the profile picker; personas then used private windows. Dhruv was browsing in Helium at the same time, so computer-use (which drives the key window) lost focus repeatedly; B's haiku agent ran `open -a Helium <url>` and B's b1-ceo signed in in Dhruv's normal window (03:17–03:33 UTC); cleaned (site data for authkit.app and htmlartifact.pages.dev deleted, cookie DB checked, stray tab closed). B also drove computer-use itself after three haiku attempts grabbed the wrong window, against the rule. Not covered: C did not view its artifacts in the browser; A did not verify WorkOS org deletion in WorkOS (dashboard/API off-limits).

**Left behind:** 12 WorkOS Staging users dhruv+r3a1…a5, r3b1…b5, r3c1…c2@swayu.io (the product has no account deletion). Workspaces R3 Startup, R3 Exec, R3 Eng, R3 Sales, R3 EngTeam deleted with every artifact (A and C: delete output and empty `list --all` saved; B: recorded in its checklist and consistent with post-delete `whoami`, raw delete output not saved). All personas logged out (no credentials.json left). Local: /tmp/r3 persona dirs (no credentials), evidence copy in ~/htmlartifact-evidence/run3.

## First-time-user usability run (2026-10-19, branch usability/first-run)
Done = a fresh user goes from zero to a shared artifact a teammate can open by
following only the README/landing page, with no dead ends; fixes merged and
deployed; live smoke green; `npx htmlartifact@latest` is the fixed version.

Run 1 (live site + `npx htmlartifact@latest` 0.1.0, new Staging accounts, incognito browser, isolated HOMEs):
- [x] Landing page → `npx htmlartifact login`: device link opened, sign-up (email code, MFA enrollment), "Confirm" → CLI "Signed in as Ada… not in a workspace yet. Next, either: …"
- [x] A: `workspace create "Usability Run"` → `workspace invite` (code + `/join/` link) → `check plan.html` → `upload plan.html` (v1) → re-upload same path (v2, same URL) → `list` / `list --json`
- [x] A in the browser: `/d/<id>` → sign-in round trip → artifact in the sandbox frame; `/` shows the workspace feed
- [x] A web Sign out → **broken**: ended on error.workos.com `app-homepage-url-not-found`. Fixed by the WorkOS thread (Staging Sign-out URI https://htmlartifact.pages.dev, Default); re-tested: lands on the landing page
- [x] B opens the `/join/<code>` link signed out → sign-up → back on "Join Usability Run"; **before joining**, B opens A's link → 404 (looks like a missing page) → Join workspace → feed → artifact opens
- [x] B CLI: `login` (picked up the workspace) → `list` → `list --all` → `read <url>` / `read --out` (byte-identical to A's file) → `upload notes.html --slug ben-notes` → `workspace members`; `workspace invite` as a member → "Only workspace admins can do that."
- [x] Signed out (fresh HOME): `read`/`upload`/`list`/`whoami` → "Not signed in. Run: htmlartifact login"
- [x] A `delete <url>` → B `read` → 404 with a hint; A (admin) `delete <B's id>` → ok

Friction found → fixed (0.1.1):
- [x] CLI hints said `htmlartifact …`, which isn't on PATH for `npx` users ("command not found"): hints and errors now say `npx htmlartifact …` when run through npx/bunx/dlx (`CMD`/`withCmd` in cli/env.ts)
- [x] `read <id>` → "Not a URL" although `delete` takes IDs: `read` takes an ID too
- [x] Member deleting a teammate's artifact (that they can see in `list --all`) → "Artifact not found.": now 403 "only they or a workspace admin can delete it"
- [x] `login` into a workspace printed no next step: now "Next, publish a page: … upload <file.html>"; the upload receipt's Update command uses the path as typed
- [x] Signed-out `/join/<code>` page was the generic sign-in: now "You're invited to a workspace" plus the `workspace join <code>` command
- [x] Artifact 404 said "your current team cannot see it" with no next step: now says it may belong to a workspace you're not in, ask for an invite
- [x] Released: PR #8 merged (9781ba6); Release workflow published htmlartifact@0.1.1 with npm provenance (sigstore log 3324402422), tag v0.1.1; `npx htmlartifact@latest --version` → 0.1.1
- [x] Deploy for 9781ba6 was cancelled at 30 min (test step: workerd fatal SQLITE_BUSY, ops-cron tests hung 300 s each; also cancelled 535b8be). Deployed 9781ba6 with `deploy:all` from a clean origin/main worktree; smoke 11/11; new 404 and invite copy confirmed live. PR #10: Deploy runs after CI passes on the pushed commit instead of re-running the suite; Cloudflare token scoped to the deploy step

Run 2 (live, CLI 0.1.1, MFA off, new accounts C dhruv+hae / D dhruv+haf):
- [x] C: `npx htmlartifact@latest login` → sign-up (email code, no MFA) → Confirm; every hint says `npx htmlartifact …`; `workspace create "Run Two"` → `invite` → `upload plan.html` (scripted) → `list`; Update hint uses `plan.html`
- [x] C web: `/d/<id>` → sign-in round trip → "script ran" inside the sandbox frame (`allow-scripts`, cross-site origin) → Sign out → landing page (sign-out fix holds)
- [x] D opens `/join/<code>` signed out → "You're invited to a workspace" + `workspace join` command → sign-up → back on "Join Run Two"; before joining, `/d/<id>` → new 404 copy ("…a workspace you are not in… ask them for an invite"); Join → artifact opens
- [x] **Found:** D `npx htmlartifact login` after joining in the browser → "You are not in a workspace yet" (the device flow reused the browser's pre-join AuthKit session, so the token has no organization; `workspace list` shows Run Two). Fixed in 0.1.2: login switches into the only workspace (or `--workspace`, or lists `workspace switch` commands); whoami says so. Verified live with the local build: "Workspace: Run Two"
- [x] D CLI: `list --all` → `read <id> --out` (byte-identical) → `delete <C's id>` → "That artifact belongs to a teammate; only they or a workspace admin can delete it." → own upload → `delete <url>`; C `delete` → D `read` → 404 with hint
- [x] Shipped: PR #10 (Deploy after CI, Sol-reviewed in 2 rounds: tip check, FIFO `queue: max`, same-repo and main/staging-only dispatch, token scoped to the deploy step) → first run f106c90 deployed in 44 s, smoke 11/11; PR #11 (1af6c51) → Release published htmlartifact@0.1.2 with provenance, tag v0.1.2; Deploy green; `npx htmlartifact@latest --version` → 0.1.2; smoke 11/11

WorkOS thread (Dhruv approved), after run 1: MFA turned off (SECURITY.md updated), AuthKit branded "htmlartifact" with the site icon, sign-out URI set. Not ours to change: Staging emails ("[STAGING]", welcome@workos.dev) and the `*.authkit.app` device link stay until the post-GA Production move.

## Open-source cleanup (2026-10-19, branch chore/oss-cleanup)
Done = every item below is proven by `gh` output or the repo page in a browser,
CI is green on the PR, and the PR is open and ready for Dhruv to merge.
- [x] Dead code removed (knip + `tsc --noUnusedLocals`; knip in CI as `bun run lint`, a probe export is caught); typecheck ×3 clean, suite 173/173 on D1 and on R2
- [x] README, SECURITY.md, docs and TASKS.md match what shipped (Pages + ops Worker, D1 only); Sol review: 3 doc findings fixed, approved in round 2
- [x] CONTRIBUTING.md, CODE_OF_CONDUCT.md (Contributor Covenant 2.0), SECURITY.md (supported versions, scope); private vulnerability reporting on (`gh api …/private-vulnerability-reporting` → enabled)
- [x] LICENSE/NOTICE attribution to postplan: first commit byte-identical to the postplan 0.0.5 npm tarball (`diff -r`), its copyright line matches; vendored skills' MIT license in `.claude/skills/LICENSE`
- [x] Issue forms (bug, feature, config → advisory/Discussions), PR template, 8 new labels
- [x] Branch protection on main: required check `test` (GitHub Actions, strict), PR required, admins included, no force push/deletion, conversations resolved
- [x] Dependabot config (bun + GitHub Actions, grouped; parse5/entities pinned), Dependabot alerts + security updates on
- [x] CodeQL default setup (actions, javascript-typescript) configured; secret scanning + push protection on (non-provider patterns and validity checks need paid Secret Protection: off, zero-spend)
- [x] Release automation: CHANGELOG.md, release.yml (version bump on main → npm trusted publish → tag + release), CI checks CHANGELOG; first npm publish is Dhruv's (Blocked on Dhruv / Phase 4)
- [x] Repo description, 13 topics, homepage https://htmlartifact.pages.dev; Discussions on; wiki off; delete branch on merge
- [x] CodeQL alerts on main triaged: #1 (polynomial ReDoS in `trimSlash`) and #2 (identity replace in a test) fixed in 597f4b0; #3, #4 dismissed as false positives and #5 as test-only, each with a reason (`gh api .../code-scanning/alerts`); Sol round 3 approved
- [x] Deploy workflow fixed: run 39253023896 (535b8be) was cancelled at the 15-minute limit after two ops-cron tests hung 300 s each in the test step. The step now runs the D1 suite only (production backend; CI runs D1 + R2 on every PR), pins Node 24 like CI, and has a 30-minute timeout. Locally from a clean build: 173/173 in 112 s
- [x] Green Deploy run on main after PR #4 merged (3da6fa5: tests, deploy:all, smoke); htmlartifact@0.1.0 published by Dhruv, Release tagged v0.1.0 (was PR #7, folded in here)

## Dashboard setup (2026-10-19)
Done = requested WorkOS credentials saved and checked without exposing values, MFA saved, support request sent, and Cloudflare GitHub secrets listed; any blocked step records its exact stopping point.
- [x] WorkOS environment and local credential file (directory 700, file 600): Staging (WorkOS Staging for GA; Production is a post-GA step, only on Dhruv's go-ahead). Existing key copied through clipboard, values not printed.
- [x] WorkOS AuthKit TOTP MFA: enabled AuthKit prerequisite in Staging; Authentication → Features → Multi-factor auth changed Off → Required, saved and verified Required. Later turned Off by Dhruv (biggest sign-up drop-off).
- [x] WorkOS Directory Provisioning support request: exact requested text sent through dashboard Contact support; confirmed “Message sent” / email follow-up; no ticket ID or environment-ID field shown. Declined by Dhruv after WorkOS replied (not needed; Directory Sync is billed per connection and stays off).
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
- [x] MFA: turned Off in AuthKit by Dhruv (Staging, 2026-10-19); it was Required and was the biggest sign-up drop-off
- Dropped by Dhruv: Vault/encryption, Audit Logs, Events API, Radar, extra roles, FGA, domain auto-join, export

## Blocked on Dhruv
(nothing blocks GA)
- [x] Write WorkOS keys to `~/.config/htmlartifact/workos.env` (Staging; verified 2026-10-19)
- [x] WorkOS Directory Provisioning: not wanted (Dhruv, 2026-10-19). Declined WorkOS support's follow-up; `HTMLARTIFACT_DIRECTORY_PROVISIONING` stays unset, so Directory Sync links stay refused

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
- [x] First npm publish + trusted publishing: Dhruv published 0.1.0 locally (2026-10-19 16:29 UTC, no attestation), Release tagged `v0.1.0`; then trusted publishing on `release.yml` published 0.1.1 (Release run 39296478726) and 0.1.2 (run 39304532354), both with SLSA provenance. Evidence: `npm view htmlartifact versions` → 0.1.0, 0.1.1, 0.1.2; `gh release list` → v0.1.0, v0.1.1, v0.1.2 (Latest)
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
