// Server-rendered pages: htmlartifact's own UI, never artifact content. The
// artifact CSP never applies here.

export function renderSignIn({ next }) {
  const target = `/auth/sign-in?next=${encodeURIComponent(next || "/")}`;
  return webPage({
    title: "Sign in · htmlartifact",
    body: `
      <main class="narrow center">
        <h1>htmlartifact</h1>
        <p class="muted">HTML artifacts from coding agents, visible only to your workspace.</p>
        <p><a class="button" href="${escapeHtml(target)}">Sign in or create an account</a></p>
        <p class="muted small">From a terminal or an agent: <code>npx htmlartifact login</code></p>
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

// Everything the current workspace has published, newest first.
export function renderWorkspace({ session, drafts }) {
  const name = session.workspace.name;
  return webPage({
    title: `${name} · htmlartifact`,
    header: pageHeader({ session, active: "workspace" }),
    body: `
      <main>
        <h1>${escapeHtml(name)}</h1>
        <p class="muted">Everything this workspace has published. Only members can open these.</p>
        ${
          drafts.length
            ? drafts.map((draft) => renderDraftRow(draft, { showAuthor: true })).join("\n")
            : `<p class="muted">Nothing published yet. From a terminal or an agent: <code>npx htmlartifact upload plan.html</code></p>`
        }
      </main>
    `
  });
}

export function renderMine({ session, drafts }) {
  return webPage({
    title: "Mine · htmlartifact",
    header: pageHeader({ session, active: "mine" }),
    body: `
      <main>
        <h1>My artifacts</h1>
        ${
          drafts.length
            ? drafts.map((draft) => renderDraftRow(draft)).join("\n")
            : `<p class="muted">Nothing yet. Publish with <code>npx htmlartifact upload plan.html</code>.</p>`
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
        </tr>`
    )
    .join("\n");
  return webPage({
    title: `${draft.title} · htmlartifact`,
    header: pageHeader({ session, active: "mine" }),
    body: `
      <main>
        <p class="small"><a href="/mine">← My artifacts</a></p>
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

// Signed in, no workspace selected: pick one, create one, or join one.
export function renderWorkspaces({ session, workspaces, next = null }) {
  const list = workspaces.length
    ? `<ul class="orgs">${workspaces
        .map(
          (w) => `<li><form method="post" action="/workspaces/switch"><input type="hidden" name="id" value="${escapeHtml(w.id)}"><button class="linklike" type="submit">${escapeHtml(w.name)}</button>${w.current ? ' <span class="muted small">current</span>' : ""}</form></li>`
        )
        .join("")}</ul>`
    : `<p class="muted">You are not in a workspace yet.</p>`;
  return webPage({
    title: "Workspaces · htmlartifact",
    header: pageHeader({ session, active: "workspaces" }),
    body: `
      <main class="narrow">
        <h1>Workspaces</h1>
        ${next ? `<p class="notice">That link belongs to a workspace you are not in. Ask whoever shared it for an invite code and enter it below; you will go straight back to the link.</p>` : ""}
        ${list}
        <h2>Create a workspace</h2>
        <form method="post" action="/workspaces" class="inline">
          <input name="name" required maxlength="100" placeholder="Workspace name">
          <button class="button" type="submit">Create</button>
        </form>
        <h2>Join a workspace</h2>
        <form method="post" action="/join" class="inline">
          ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : ""}
          <input name="code" required maxlength="40" placeholder="Invite code, e.g. HA-7KQ2-MX9P-4TRA">
          <button class="button" type="submit">Join</button>
        </form>
        <p class="muted small">From a terminal or an agent: <code>htmlartifact workspace create "Acme"</code>, <code>htmlartifact workspace join &lt;code&gt;</code></p>
      </main>
    `
  });
}

export function renderJoin({ session, code, workspaceName }) {
  return webPage({
    title: `Join ${workspaceName} · htmlartifact`,
    header: pageHeader({ session, active: "" }),
    body: `
      <main class="narrow center">
        <h1>Join ${escapeHtml(workspaceName)}</h1>
        <p class="muted">You will see everything this workspace publishes, and they will see what you publish here.</p>
        <form method="post" action="/join">
          <input type="hidden" name="code" value="${escapeHtml(code)}">
          <button class="button" type="submit">Join workspace</button>
        </form>
      </main>
    `
  });
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
        ${showAuthor ? `${escapeHtml(draft.author || "")} ·` : `<a href="/mine/${escapeHtml(draft.draftId)}">Details</a> ·`}
        v${draft.latestVersionNumber ?? "—"} · ${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"} · ${escapeHtml(formatDate(draft.updatedAt))}
      </div>
    </div>
  `;
}

function pageHeader({ session = {}, active }) {
  const link = (href, key, label) =>
    `<a href="${href}" class="${active === key ? "active" : ""}">${escapeHtml(label)}</a>`;
  const email = session.email
    ? `<span class="muted small pii" tabindex="0" title="Hover to reveal">${escapeHtml(session.email)}</span>`
    : "";
  return `
    <header class="top">
      <nav>
        ${session.workspace ? link("/", "workspace", session.workspace.name) : ""}
        ${session.workspace ? link("/mine", "mine", "Mine") : ""}
        ${link("/workspaces", "workspaces", "Workspaces")}
      </nav>
      <form method="post" action="/auth/sign-out">
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
