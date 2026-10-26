// The artifact wrapper page: the one page the web app (web/) doesn't render,
// because it must carry no script at all. Every other page is React
// (src/frontend.ts).

import { makeSeal, sealSvg } from "../web/app/lib/seal.ts";

export interface ArtifactFrame {
  title: string;
  src: string; // the artifact on the sandbox origin
  id: string; // draft id: the bar wears its seal
  workspace: string | null; // the viewer's workspace, which owns the artifact
  version: number;
  latest: boolean; // this is the current version
  latestUrl: string; // the artifact URL without /v/<n>
  historyUrl: string;
  feedUrl: string;
}

// An artifact, framed from the sandbox origin (src/serve.ts), under a thin
// reading bar: where it lives, which version this is, its history, and a way
// home. No script: the wrapper's CSP allows none, so hiding the bar is a
// checkbox and CSS, and the theme follows the system. The frame is sandboxed
// without allow-same-origin as well, on top of the sandbox CSP the artifact
// itself is served with.
export function renderArtifactFrame(frame: ArtifactFrame): string {
  const title = escapeHtml(frame.title);
  const workspace = frame.workspace ? escapeHtml(frame.workspace) : null;
  const version = escapeHtml(frame.version);
  const ink = makeSeal(frame.id, 20).ink;
  const state = frame.latest
    ? `<span class="chip now">Latest</span>`
    : `<span class="chip old">Older version</span><a class="latest" href="${escapeHtml(frame.latestUrl)}">` +
      `<span class="wide">Go to latest</span><span class="narrow">Latest<span class="sr"> version</span></span>${icon(ARROW_RIGHT)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.png" type="image/png">
<title>${title} · htmlartifact</title>
<style>${FRAME_CSS}</style>
</head>
<body>
<header class="bar">
<div class="where">
<span class="seal ink-${ink}">${sealSvg(frame.id, 20, "currentColor")}</span>
<a class="ws" href="${escapeHtml(frame.feedUrl)}"><span class="sr">All artifacts in </span>${workspace ?? "your workspace"}</a>
<span class="sep" aria-hidden="true">/</span>
<h1 class="title" title="${title}">${title}</h1>
<span class="version"><span class="chip num${frame.latest ? "" : " old"}"><span aria-hidden="true">v${version}</span><span class="sr">Version ${version}</span></span>${state}</span>
</div>
<div class="tools">
<p class="access">${icon(LOCK)}<span>Only <span class="name">${workspace ?? "workspace"}</span> members can see this</span></p>
<a class="tool" href="${escapeHtml(frame.historyUrl)}" aria-label="History of ${title}">${icon(HISTORY)}<span class="label">History</span></a>
<label class="tool square hide" for="hide-bar" title="Hide bar">${icon(CHEVRON_UP)}</label>
</div>
</header>
<input class="toggle" type="checkbox" id="hide-bar" aria-label="Hide the artifact bar">
<label class="show" for="hide-bar">${icon(CHEVRON_DOWN)}Show bar</label>
<iframe class="artifact" title="${title}" src="${escapeHtml(frame.src)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>
</body>
</html>`;
}

// Stroke icons on the app's 16px grid (web/app/components/icons.tsx).
const LOCK = '<rect x="3.25" y="7" width="9.5" height="6.75" rx="1.5"/><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2"/>';
const HISTORY = '<path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77M2.5 2.75v2.5H5"/><path d="M8 5.25V8l1.9 1.4"/>';
const CHEVRON_UP = '<path d="m4.5 9.75 3.5-3.5 3.5 3.5"/>';
const CHEVRON_DOWN = '<path d="m4.5 6.25 3.5 3.5 3.5-3.5"/>';
const ARROW_RIGHT = '<path d="M3.5 8h9M8.75 4.25 12.5 8l-3.75 3.75"/>';

function icon(paths: string): string {
  return `<svg class="i" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// The app's tokens (web/app/app.css), light and dark. The wrapper's CSP has
// no font-src, so type is a system stack tuned to the app's metrics.
const FRAME_CSS = `
:root {
  --paper: #f3f4f7; --paper-2: #ffffff; --ink: #0e1530; --ink-2: #283150; --fog: #576079;
  --rule: #dde1ea; --rule-2: #c7cddb; --intaglio: #2337c6; --wash: #e9ecfb; --hold: #8a5a00; --hold-wash: #f6efe2;
  --foil: linear-gradient(90deg, #6f7dff, #3fbfae 22%, #c78be0 46%, #e9b76a 70%, #6f7dff);
  --seal-0: #2337c6; --seal-1: #0f7a6b; --seal-2: #7a2e8c; --seal-3: #9e2b3a; --seal-4: #8f6410;
  --lift: 0 1px 2px rgb(14 21 48 / 0.06), 0 8px 20px -8px rgb(14 21 48 / 0.28);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #090e1c; --paper-2: #0f1529; --ink: #e8ebf5; --ink-2: #c3c9dc; --fog: #929bb5;
    --rule: #1d2540; --rule-2: #2b3453; --intaglio: #93a2ff; --wash: #161f44; --hold: #f0b84a; --hold-wash: #2a2312;
    --foil: linear-gradient(90deg, #8c9bff, #4fd1b8 22%, #d79cf0 46%, #f0c27a 70%, #8c9bff);
    --seal-0: #93a2ff; --seal-1: #4fc9b4; --seal-2: #d08ce0; --seal-3: #ff8f9c; --seal-4: #f0c060;
    --lift: 0 0 0 1px rgb(255 255 255 / 0.04), 0 6px 16px -8px rgb(0 0 0 / 0.55);
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; height: 100vh; height: 100dvh; overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--paper); color: var(--ink);
  font: 14px/1.4 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: transparent;
}
a { color: inherit; text-decoration: none; touch-action: manipulation; }
:focus-visible { outline: 2px solid var(--intaglio); outline-offset: 2px; border-radius: 6px; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.i { flex: none; display: block; }

.bar {
  position: relative; flex: none; height: 46px; padding: 2px 10px 0 16px;
  display: flex; align-items: center; gap: 16px;
  background: var(--paper); border-bottom: 1px solid var(--rule);
}
.bar::before { content: ""; position: absolute; inset: 0 0 auto; height: 2px; background: var(--foil); }
.where { flex: 1; min-width: 0; display: flex; align-items: center; }
.seal { flex: none; width: 20px; height: 20px; margin-right: 8px; }
.seal svg { display: block; }
.ink-0 { color: var(--seal-0); } .ink-1 { color: var(--seal-1); } .ink-2 { color: var(--seal-2); } .ink-3 { color: var(--seal-3); } .ink-4 { color: var(--seal-4); }
.ws {
  flex: 0 1 auto; min-width: 3.5em; max-width: 13rem; padding: 3px 6px; border-radius: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ink-2); font-weight: 500; letter-spacing: -0.006em;
}
.sep { flex: none; margin: 0 4px 0 2px; color: var(--rule-2); font-size: 17px; font-weight: 300; }
.title {
  flex: 0 1 auto; min-width: 3em; margin: 0 0 0 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 600; letter-spacing: -0.011em; color: var(--ink);
}
.version { flex: none; display: flex; align-items: center; gap: 6px; margin-left: 10px; }
.chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 6px;
  font-size: 12px; font-weight: 600; letter-spacing: 0; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.chip.num { padding: 0 5px; border: 1px solid var(--rule-2); color: var(--ink-2); }
.chip.num.old { border-color: color-mix(in srgb, var(--hold) 45%, transparent); color: var(--hold); }
.chip.now { background: var(--wash); color: var(--intaglio); }
.chip.old:not(.num) { background: var(--hold-wash); color: var(--hold); }
.latest {
  display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 6px; margin-left: -2px; border-radius: 6px;
  color: var(--intaglio); font-size: 13px; font-weight: 600; white-space: nowrap;
}
.latest .i { width: 14px; height: 14px; }
.latest .narrow { display: none; }

.tools { flex: none; display: flex; align-items: center; gap: 2px; }
.access {
  display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0 10px 0 0;
  color: var(--fog); font-size: 13px; white-space: nowrap;
}
.access .i { width: 14px; height: 14px; }
.access .name { display: inline-block; max-width: 9rem; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.tool {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 8px;
  color: var(--ink-2); font-size: 13.5px; font-weight: 500; white-space: nowrap; cursor: pointer; user-select: none; -webkit-user-select: none;
}
.tool.square { width: 32px; padding: 0; }
.toggle { position: fixed; top: 8px; right: 24px; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
.show {
  display: none; position: fixed; z-index: 1; top: 0; right: 20px; height: 32px; padding: 2px 10px 0 8px; gap: 4px;
  align-items: center; overflow: hidden;
  background: var(--paper); color: var(--ink-2); border: 1px solid var(--rule-2); border-top: 0; border-radius: 0 0 8px 8px;
  box-shadow: var(--lift); font-size: 12.5px; font-weight: 500; cursor: pointer; user-select: none; -webkit-user-select: none;
}
.show::before { content: ""; position: absolute; inset: 0 0 auto; height: 2px; background: var(--foil); }
.show .i { width: 14px; height: 14px; }
@media (hover: hover) {
  .ws:hover, .tool:hover, .show:hover { background: var(--wash); color: var(--ink); }
  .latest:hover { background: var(--wash); }
}
body:has(.toggle:focus-visible) .hide, .toggle:focus-visible + .show { outline: 2px solid var(--intaglio); outline-offset: 2px; }
body:has(.toggle:checked) .bar { display: none; }
.toggle:checked + .show { display: flex; }
iframe.artifact { flex: 1 1 auto; display: block; width: 100%; min-height: 0; border: 0; background: #fff; }

@media (max-width: 899px) {
  .access { display: none; }
}
@media (max-width: 639px) {
  .bar { gap: 8px; padding: 2px 6px 0 12px; }
  .ws, .sep { display: none; }
  .seal { margin-right: 10px; }
  .title {
    margin: 0; white-space: normal; overflow-wrap: anywhere; line-height: 17px;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
  }
  .version { margin-left: 8px; gap: 2px; }
  .chip:not(.num) { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .latest .wide { display: none; }
  .latest .narrow { display: inline; }
  .latest { margin-left: 0; }
  .tool { width: 36px; height: 36px; padding: 0; }
  .tool .label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
`;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
