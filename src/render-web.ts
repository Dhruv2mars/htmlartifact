// The artifact wrapper page: the one page the web app (web/) doesn't render,
// because it must carry no script at all. Every other page is React
// (src/frontend.ts).

// An artifact, framed from the sandbox origin (src/serve.ts). No script: the
// wrapper's CSP allows none. The frame is sandboxed without allow-same-origin
// as well, on top of the sandbox CSP the artifact itself is served with.
export function renderArtifactFrame({ title, src }: { title: string; src: string }): string {
  return webPage({
    title: `${title} · htmlartifact`,
    script: false,
    body: `<iframe class="artifact" title="${escapeHtml(title)}" src="${escapeHtml(src)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`
  });
}

function webPage({
  title,
  body,
  header = "",
  script = true
}: {
  title: string;
  body: string;
  header?: string;
  script?: boolean;
}): string {
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
    iframe.artifact { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
  </style>
</head>
<body>${header}${body}
${script ? `<script>
  for (const button of document.querySelectorAll(".copy")) {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.previousElementSibling.textContent);
      button.textContent = "Copied";
    });
  }
</script>` : ""}
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
