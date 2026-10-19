// The 404 for artifact links (and the sandbox origin): identical bytes for a
// missing artifact and one the caller can't see. Self-contained, no script,
// no assets, so it renders the same on either origin.
export function renderNotFound(): string {
  return htmlPage({
    title: "Not found",
    body: `
      <main>
        <p class="code" aria-hidden="true">404</p>
        <h1>Not found</h1>
        <p>This artifact does not exist, or your current team cannot see it.</p>
        <p><a href="/">htmlartifact</a></p>
      </main>
    `
  });
}

function htmlPage({ title, body }: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --paper: #f5f6f8; --ink: #121a33; --fog: #5e6782; --rule: #c9cedb; --link: #2337c6; }
    @media (prefers-color-scheme: dark) {
      :root { --paper: #0b1020; --ink: #e7eaf4; --fog: #8e97b3; --rule: #2c3554; --link: #8c9bff; }
    }
    html, body { height: 100%; }
    body {
      margin: 0;
      display: grid;
      place-items: center;
      background: var(--paper);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    main { max-width: 440px; padding: 24px; text-align: center; }
    .code { margin: 0; font-size: 112px; font-weight: 800; line-height: 1; letter-spacing: -0.05em; font-stretch: 125%; color: var(--rule); }
    h1 { margin: 24px 0 0; font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; }
    p { margin: 12px 0 0; color: var(--fog); font-size: 16px; line-height: 1.6; }
    a { color: var(--link); text-underline-offset: 3px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
