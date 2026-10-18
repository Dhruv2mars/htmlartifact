export function renderNotFound() {
  return htmlPage({
    title: "Not found",
    body: `
      <main class="home">
        <h1>Not found</h1>
        <p>This artifact does not exist, or your current team cannot see it.</p>
      </main>
    `
  });
}

function htmlPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="alternate icon" href="/favicon.png" type="image/png">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      background: #f8fafc;
      color: #111827;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .home {
      max-width: 760px;
      margin: 64px auto;
      padding: 0 20px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 40px;
      line-height: 1.1;
    }

    p {
      color: #374151;
      font-size: 17px;
      line-height: 1.6;
    }

    pre {
      overflow-x: auto;
      padding: 14px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      border-radius: 6px;
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
