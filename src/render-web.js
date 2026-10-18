// Server-rendered dashboard pages. These are htmlartifact's own UI (apex domain
// only): unlike artifact serving they may use inline styles/JS freely; the
// artifact CSP never applies here.

export function renderSignIn({ next }) {
  const target = `/auth/sign-in?next=${encodeURIComponent(next || "/dashboard")}`;
  return webPage({
    title: "Sign in · htmlartifact",
    body: `
      <main class="narrow center">
        <h1>htmlartifact</h1>
        <p class="muted">Artifacts here are visible only to members of their organization.</p>
        <p><a class="button" href="${escapeHtml(target)}">Sign in</a></p>
      </main>
    `
  });
}

export function renderAuthError({ title = "Sign-in problem", message, retry = true }) {
  return webPage({
    title: `${title} · htmlartifact`,
    body: `
      <main class="narrow center">
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">${escapeHtml(message)}</p>
        ${retry ? `<p><a class="button" href="/auth/sign-in">Try again</a></p>` : ""}
      </main>
    `
  });
}

// Every artifact any member of the current organization has published.
export function renderWorkspace({ session, drafts }) {
  return webPage({
    title: `${session.organization_name || "Workspace"} · htmlartifact`,
    header: pageHeader({ session, active: "workspace" }),
    body: `
      <main>
        <h1>${escapeHtml(session.organization_name || "Workspace")}</h1>
        <p class="muted">Everything your team has published, newest first. Only members can open these.</p>
        ${
          drafts.length
            ? drafts.map((draft) => renderDraftRow(draft, { showAuthor: true })).join("\n")
            : `<p class="muted">Nothing published yet.</p>`
        }
      </main>
    `
  });
}

export function renderDashboard({ session, drafts }) {
  const groups = groupByRepo(drafts);
  const sections = groups
    .map(
      (group) => `
        <section>
          <h2>${escapeHtml(group.label)}${
            group.href
              ? ` <a class="small repo-link" href="${escapeHtml(group.href)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`
              : ""
          }</h2>
          ${group.drafts.map(renderDraftRow).join("\n")}
        </section>
      `
    )
    .join("\n");

  return webPage({
    title: "My artifacts · htmlartifact",
    header: pageHeader({ session, active: "dashboard" }),
    body: `
      <main>
        <h1>My artifacts</h1>
        ${
          drafts.length
            ? sections
            : `<p class="muted">Nothing yet. Set up the CLI from <a href="/cli/auth">CLI setup</a>, then run <code>htmlartifact upload plan.html</code>.</p>`
        }
      </main>
    `
  });
}

export function renderDraftDetail({ session, draft, versions }) {
  const rows = versions
    .map(
      (v) => `
        <tr>
          <td><a href="${escapeHtml(draft.versionBaseUrl)}/v/${Number(v.version_number)}" target="_blank" rel="noopener noreferrer">v${Number(v.version_number)}</a></td>
          <td>${escapeHtml(v.git_commit_subject || "")}${v.git_dirty ? ' <span class="pill warn">dirty</span>' : ""}</td>
          <td class="muted">${escapeHtml(v.git_branch || "")} ${escapeHtml((v.git_commit_sha || "").slice(0, 7))}</td>
          <td class="muted">${escapeHtml(formatDate(v.created_at))}</td>
        </tr>
      `
    )
    .join("\n");

  return webPage({
    title: `${draft.title} · htmlartifact`,
    header: pageHeader({ session, active: "dashboard" }),
    body: `
      <main>
        <p class="small"><a href="/dashboard">← My artifacts</a></p>
        <h1>${escapeHtml(draft.title)}</h1>
        ${draft.description ? `<p class="muted">${escapeHtml(draft.description)}</p>` : ""}
        <p><a href="${escapeHtml(draft.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.publicUrl)}</a></p>
        <table>
          <tr><th>Version</th><th>Commit</th><th>Ref</th><th>Published</th></tr>
          ${rows}
        </table>
      </main>
    `
  });
}

export function renderCliSetup({ session, homeUrl }) {
  const install = `curl -fsSL ${homeUrl}/install.sh | sh`;
  return webPage({
    title: "CLI setup · htmlartifact",
    header: pageHeader({ session, active: "cli" }),
    body: `
      <main class="narrow">
        <h1>Set up the CLI</h1>
        <p class="muted">Installs the <code>htmlartifact</code> CLI and the default agent skills (Claude Code, Codex, and any agent that reads <code>~/.agents/skills</code>).</p>
        ${codeBox(install)}
        <p class="muted">Then sign in. It opens this site in a browser, works over SSH too:</p>
        ${codeBox("htmlartifact login")}
        <p class="muted small">Needs Node.js 20+. Re-run the install line any time to update. CI should use an organization API key from <a href="/team">Team</a> as <code>HTMLARTIFACT_TOKEN</code>.</p>
      </main>
    `
  });
}

export function renderOnboarding({ session, memberships, allowTeamCreation }) {
  return webPage({
    title: "Choose a team · htmlartifact",
    header: pageHeader({ session, active: "" }),
    body: `
      <main class="narrow">
        <h1>Choose a team</h1>
        <p class="muted">Artifacts belong to a team, and only its members can read them.</p>
        ${memberships.length ? orgSwitcher(memberships, session.organization_id) : `<p class="muted">You are not in a team yet. Ask a teammate to invite ${escapeHtml(session.email || "you")} from their Team page${allowTeamCreation ? ", or create one" : ""}.</p>`}
        ${
          allowTeamCreation
            ? `<h2>Create a team</h2>
        <form method="post" action="/teams" class="inline">
          <input name="name" required maxlength="100" placeholder="Team name">
          <button class="button" type="submit">Create</button>
        </form>`
            : ""
        }
      </main>
    `
  });
}

export function renderTeam({ session, isAdmin, memberships, apiKeys = [], newKey = null, notice = null }) {
  const keyRows = apiKeys
    .map(
      (key) => `
        <tr>
          <td>${escapeHtml(key.name)}</td>
          <td class="muted"><code>${escapeHtml(key.obfuscatedValue || "")}</code></td>
          <td class="muted">${key.lastUsedAt ? escapeHtml(formatDate(key.lastUsedAt)) : "never used"}</td>
          <td>
            <form method="post" action="/team/api-keys/${escapeHtml(key.id)}/delete">
              <button class="linklike" type="submit">Delete</button>
            </form>
          </td>
        </tr>
      `
    )
    .join("\n");

  const admin = `
        <h2>Invite a teammate</h2>
        <form method="post" action="/team/invitations" class="inline">
          <input name="email" type="email" required placeholder="name@company.com">
          <select name="role"><option value="member">Member</option><option value="admin">Admin</option></select>
          <button class="button" type="submit">Send invite</button>
        </form>

        <h2>CI API keys</h2>
        <p class="muted small">For publishing from CI: set the value as <code>HTMLARTIFACT_TOKEN</code>. It publishes as this team.</p>
        ${newKey ? `<p>New key <strong>${escapeHtml(newKey.name)}</strong>. Shown once, copy it now:</p>${codeBox(newKey.value)}` : ""}
        <form method="post" action="/team/api-keys" class="inline">
          <input name="name" maxlength="80" placeholder="Key name, e.g. GitHub Actions">
          <button class="button" type="submit">Create key</button>
        </form>
        ${apiKeys.length ? `<table><tr><th>Name</th><th>Key</th><th>Last used</th><th></th></tr>${keyRows}</table>` : ""}

        <h2>Single sign-on and provisioning</h2>
        <p class="muted small">Opens the WorkOS Admin Portal for this team.</p>
        <div class="actions">
          ${[
            ["sso", "Set up SSO"],
            ["dsync", "Directory sync (SCIM)"],
            ["domain_verification", "Verify a domain"],
            ["audit_logs", "Audit log streaming"]
          ]
            .map(
              ([intent, label]) =>
                `<form method="post" action="/team/admin-portal/${intent}"><button class="button secondary" type="submit">${label}</button></form>`
            )
            .join("")}
        </div>`;

  return webPage({
    title: `Team · ${session.organization_name || "htmlartifact"}`,
    header: pageHeader({ session, active: "team" }),
    body: `
      <main class="narrow">
        <h1>${escapeHtml(session.organization_name || "Team")}</h1>
        ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
        <p class="muted">You are ${isAdmin ? "an admin" : "a member"} of this team.</p>
        ${isAdmin ? admin : `<p class="muted small">Admins can invite people, create CI keys, and set up SSO.</p>`}
        <h2>Your teams</h2>
        ${orgSwitcher(memberships, session.organization_id)}
        <p class="small"><a href="/onboarding">Create another team</a></p>
      </main>
    `
  });
}

function orgSwitcher(memberships, currentId) {
  return `<ul class="orgs">${memberships
    .map((m) =>
      m.organizationId === currentId
        ? `<li><strong>${escapeHtml(m.organizationName)}</strong> <span class="muted small">current</span></li>`
        : `<li><form method="post" action="/orgs/switch"><input type="hidden" name="organizationId" value="${escapeHtml(m.organizationId)}"><button class="linklike" type="submit">${escapeHtml(m.organizationName)}</button></form></li>`
    )
    .join("")}</ul>`;
}

function codeBox(text) {
  return `<div class="keybox"><code>${escapeHtml(text)}</code><button class="button copy" type="button">Copy</button></div>`;
}

function renderDraftRow(draft, { showAuthor = false } = {}) {
  // The title is the one-click "open the plan" action (new tab); the internal
  // detail/version-history screen hangs off the separate Details link.
  return `
    <div class="row">
      <div>
        <a class="row-title" href="${escapeHtml(draft.publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(draft.title)}</a>
        ${draft.disabled ? '<span class="pill warn">disabled</span>' : ""}
        ${draft.description ? `<div class="muted small">${escapeHtml(draft.description)}</div>` : ""}
      </div>
      <div class="row-meta muted small">
        ${showAuthor ? `${escapeHtml(draft.author || "")} ·` : `<a href="/dashboard/drafts/${escapeHtml(draft.draftId)}">Details</a> ·`}
        v${draft.latestVersionNumber ?? "—"} · ${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"} · ${escapeHtml(formatDate(draft.updatedAt))}
      </div>
    </div>
  `;
}

function groupByRepo(drafts) {
  const map = new Map();
  for (const draft of drafts) {
    const hasRepo = draft.repoOrg && draft.repoName;
    const key = hasRepo ? `${draft.repoOrg}/${draft.repoName}` : "";
    if (!map.has(key)) {
      // Drafts uploaded by pre-0.0.3 CLIs have no repo_host; default those to
      // github.com so the one-click repo link still works. Any member draft
      // with a recorded host upgrades the group's link below.
      map.set(key, {
        label: hasRepo ? key : "No repository",
        href: hasRepo
          ? `https://${draft.repoHost || "github.com"}/${draft.repoOrg}/${draft.repoName}`
          : null,
        drafts: []
      });
    }
    const group = map.get(key);
    if (hasRepo && draft.repoHost) {
      group.href = `https://${draft.repoHost}/${draft.repoOrg}/${draft.repoName}`;
    }
    group.drafts.push(draft);
  }
  // Repo groups first (already newest-first within), "No repository" last.
  return [...map.entries()].sort(([a], [b]) => (a === "") - (b === "")).map(([, g]) => g);
}

function pageHeader({ session = {}, active }) {
  // Profile data comes from WorkOS; only render an avatar for https URLs.
  const avatar =
    typeof session.picture_url === "string" && session.picture_url.startsWith("https://")
      ? `<img class="avatar" src="${escapeHtml(session.picture_url)}" alt="" referrerpolicy="no-referrer">`
      : "";
  // The email is PII: blurred until hover/focus so it never leaks on
  // screenshares.
  const email = session.email
    ? `<span class="muted small pii" tabindex="0" title="Hover to reveal">${escapeHtml(session.email)}</span>`
    : "";
  const link = (href, key, label) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${escapeHtml(label)}</a>`;

  return `
    <header class="top">
      <nav>
        ${session.organization_id ? link("/workspace", "workspace", session.organization_name || "Workspace") : ""}
        ${session.organization_id ? link("/dashboard", "dashboard", "Mine") : ""}
        ${session.organization_id ? link("/team", "team", "Team") : ""}
        ${link("/cli/auth", "cli", "CLI setup")}
      </nav>
      <form method="post" action="/auth/sign-out">
        ${avatar}
        ${email}
        <button class="linklike" type="submit">Sign out</button>
      </form>
    </header>
  `;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16).replace("T", " ");
}

function webPage({ title, body, header = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="alternate icon" href="/favicon.png" type="image/png">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 860px; margin: 32px auto 80px; padding: 0 20px; }
    main.narrow { max-width: 560px; }
    main.center { text-align: center; margin-top: 96px; }
    h1 { font-size: 30px; margin: 0 0 14px; }
    h2 { font-size: 17px; margin: 30px 0 6px; }
    p { line-height: 1.6; }
    a { color: #1d4ed8; }
    code { background: #eef2f7; border: 1px solid #d1d5db; border-radius: 5px; padding: 1px 5px; font-size: 14px; }
    .muted { color: #6b7280; }
    .small { font-size: 13px; }
    .button { display: inline-block; background: #111827; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px; font-size: 15px; text-decoration: none; cursor: pointer; }
    .linklike { background: none; border: 0; color: #1d4ed8; cursor: pointer; font-size: 13px; padding: 0; margin-left: 10px; text-decoration: underline; }
    .top { display: flex; justify-content: space-between; align-items: center; max-width: 860px; margin: 0 auto; padding: 14px 20px; border-bottom: 1px solid #e5e7eb; }
    .top nav a { margin-right: 16px; text-decoration: none; color: #374151; }
    .top nav a.active { color: #111827; font-weight: 600; }
    .top form { display: inline-flex; align-items: center; gap: 8px; }
    .avatar { width: 26px; height: 26px; border-radius: 50%; vertical-align: middle; }
    .repo-link { font-weight: 400; text-decoration: none; margin-left: 6px; }
    .row-meta a { color: #6b7280; }
    .pii { filter: blur(4px); border-radius: 3px; transition: filter .15s ease; cursor: pointer; }
    .pii:hover, .pii:focus { filter: none; outline: none; }
    .row { display: flex; justify-content: space-between; gap: 14px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .row-title { font-weight: 600; text-decoration: none; }
    .row-meta { white-space: nowrap; }
    .pill { font-size: 11px; border-radius: 999px; padding: 2px 8px; margin-left: 6px; }
    .pill.warn { background: #fef3c7; color: #92400e; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; }
    .keybox { display: flex; gap: 10px; align-items: center; background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 14px; margin: 14px 0; }
    .keybox code { flex: 1; word-break: break-all; background: none; border: 0; font-size: 15px; }
    .button.secondary { background: #fff; color: #111827; border: 1px solid #d1d5db; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    form.inline { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
    input, select { font: inherit; padding: 9px 10px; border: 1px solid #d1d5db; border-radius: 8px; }
    input { flex: 1; min-width: 200px; }
    .orgs { padding-left: 18px; line-height: 2; }
    .orgs .linklike { margin-left: 0; font-size: 15px; }
    .notice { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 10px 14px; }
  </style>
</head>
<body>${header}${body}
<script>
  for (const button of document.querySelectorAll(".copy")) {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.previousElementSibling.textContent);
      button.textContent = "Copied";
    });
  }
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
