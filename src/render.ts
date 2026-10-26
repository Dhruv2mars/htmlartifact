// The 404 for artifact links (and the sandbox origin): identical bytes for a
// missing artifact and one the caller can't see. Self-contained, no script,
// no assets, so it renders the same on either origin. Laid out like the web
// app's 404 (web/app/pages/Bare.tsx), with a system-font stack in place of
// Archivo, which the sandbox origin cannot serve.

import { makeSeal } from "../web/app/lib/seal.ts";

const pages = new Map<string, string>();

// `app`: the app's own origin when this is served anywhere else (the sandbox
// origin, inside an artifact's frame): the way out is a new tab on the app,
// since the frame may not navigate its parent. On the app origin, the page
// offers home and the workspace list (to join with an invite code). Either
// way the bytes depend only on where it is served, never on what was asked.
export function renderNotFound(app: string | null = null): string {
  const key = app ?? "";
  let page = pages.get(key);
  if (!page) {
    const actions = app
      ? `<a class="button" href="${escapeHtml(`${app}/`)}" target="_blank" rel="noopener">Open htmlartifact<span class="sr"> in a new tab</span></a>`
      : `<a class="button" href="/">Go to htmlartifact</a><a class="button line" href="/workspaces">Your workspaces</a>`;
    page = htmlPage({
      title: "Not found",
      body: `<main>
<p class="brand">${mark()}<span>htmlartifact</span></p>
<p class="code" aria-hidden="true">404</p>
<h1>Not found</h1>
<p class="lead">This artifact does not exist, or it belongs to a workspace you are not in.</p>
<p class="hint">If someone shared it with you, ask them for an invite to their workspace, then join it from your workspaces.</p>
<p class="actions">${actions}</p>
</main>`
    });
    pages.set(key, page);
  }
  return page;
}

// Shown in the artifact frame when its capability token has expired (a tab
// left open for a long time): same shell, no action but a reload.
let expired: string | undefined;

export function renderExpired(): string {
  expired ??= htmlPage({
    title: "Expired",
    body: `<main>
<p class="brand">${mark()}<span>htmlartifact</span></p>
<h1 class="spaced">This view expired</h1>
<p class="lead">Reload the page to keep reading.</p>
</main>`
  });
  return expired;
}

// The house mark (web/app/components/Logo.tsx Mark): the htmlartifact seal's
// rosette knocked out of a solid intaglio disc.
function mark(): string {
  const rosette = makeSeal("htmlartifact", 24).layers[1]!.paths[0]!;
  const step = rosette.step * (rosette.copies / 3);
  const turns = [0, 1, 2]
    .map((k) => `<use href="#mark"${k ? ` transform="rotate(${(k * step).toFixed(3)} 50 50)"` : ""}/>`)
    .join("");
  return `<svg class="mark" viewBox="0 0 100 100" width="28" height="28" aria-hidden="true"><circle class="disc" cx="50" cy="50" r="50"/><defs><path id="mark" d="${rosette.d}"/></defs><g class="knock" fill="none" stroke-width="3.2" stroke-opacity="0.95">${turns}</g><circle class="dot" cx="50" cy="50" r="5"/></svg>`;
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
:root {
  --paper: #f3f4f7; --ink: #0e1530; --ink-2: #283150; --fog: #576079; --rule-2: #c7cddb; --control: #7e869c; --wash: #e9ecfb;
  --intaglio: #2337c6; --intaglio-ink: #ffffff; --button: #0e1530; --button-ink: #f3f4f7; --button-hover: #283150;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #090e1c; --ink: #e8ebf5; --ink-2: #c3c9dc; --fog: #929bb5; --rule-2: #2b3453; --control: #5f6a8d; --wash: #161f44;
    --intaglio: #93a2ff; --intaglio-ink: #0a0f1e; --button: #e8ebf5; --button-ink: #090e1c; --button-hover: #c3c9dc;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px 20px 72px;
  background: var(--paper); color: var(--ink);
  font: 16px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; overflow-wrap: break-word;
}
main { width: 100%; max-width: 460px; text-align: center; }
.brand {
  display: inline-flex; align-items: center; gap: 9px; margin: 0;
  font-size: 16px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink);
}
.mark { display: block; flex: none; }
.mark .disc { fill: var(--intaglio); }
.mark .knock { stroke: var(--intaglio-ink); }
.mark .dot { fill: var(--intaglio-ink); }
.code {
  margin: 40px 0 0; font-size: 104px; font-weight: 800; line-height: 1; letter-spacing: -0.055em;
  color: var(--control); font-variant-numeric: tabular-nums; user-select: none; -webkit-user-select: none;
}
h1 { margin: 22px 0 0; font-size: 30px; font-weight: 700; line-height: 1.1; letter-spacing: -0.026em; text-wrap: balance; }
h1.spaced { margin-top: 36px; }
.lead { margin: 12px auto 0; max-width: 400px; font-size: 15.5px; color: var(--ink-2); text-wrap: balance; }
.hint { margin: 8px auto 0; max-width: 360px; font-size: 14px; line-height: 1.55; color: var(--fog); text-wrap: balance; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 32px 0 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.button {
  display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 20px;
  border-radius: 10px; background: var(--button); color: var(--button-ink);
  font-size: 15px; font-weight: 500; text-decoration: none; white-space: nowrap; touch-action: manipulation;
}
.button:focus-visible { outline: 2px solid var(--intaglio); outline-offset: 3px; }
.button.line { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1px var(--rule-2); }
@media (hover: hover) { .button:hover { background: var(--button-hover); } .button.line:hover { background: var(--wash); } }
@media (min-width: 640px) { .code { font-size: 128px; } }
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
