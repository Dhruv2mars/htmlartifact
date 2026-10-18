---
name: htmlartifact-design
description: How to write an HTML artifact that teammates can read: plans, specs, reviews, incident write-ups, comparisons, dashboards, and UI mocks. Use together with the htmlartifact skill whenever you are about to build a page for htmlartifact.
---

# htmlartifact-design

An artifact is a document a teammate opens in a browser, often on a phone,
often days later, without the conversation that produced it. Write for that
reader.

## Content

- **Lead with the answer.** The first screen says what was decided, found, or
  asked for, then the evidence. No hero banner, no marketing voice.
- **Make it self-contained.** Define acronyms once, link the PR/issue/commit
  you are describing, and name the repo and branch. Never "as discussed above".
- **Make it dense and scannable.** Short sections with real headings, tables
  for comparisons, numbered steps for procedures. Cut filler sentences.
- **Show evidence.** Quote the error, the metric, the diff hunk. Mark anything
  unverified as such.
- **End with what happens next.** Open questions, owners, decisions needed.

## Shape by type

| Type | Must have |
|---|---|
| Plan / spec | Goal, non-goals, approach, risks, rollout, open questions |
| Findings / review | Severity-ranked list, each with location, impact, fix |
| Incident | Timeline (UTC), impact, root cause, fixes with owners |
| Comparison | One table, a recommendation, and why |
| UI mocks | Real rendered variants labelled A, B, C… side by side, so a reviewer can answer with one letter |
| Status / tracker | Updated-at line at the top; regenerate the whole page each update |

## Visual defaults

These are defaults; an explicit request wins.

- System font stack, 16–17px body, line-height ≥ 1.5, max ~860px measure.
- `<meta name="viewport" content="width=device-width, initial-scale=1">` and
  no fixed-width layouts: it must read on a phone.
- Respect `prefers-color-scheme` with a light and a dark palette.
- Inline SVG for diagrams and charts. Label axes and units directly.
- External links get `target="_blank" rel="noopener noreferrer"`.

## What the service allows

`htmlartifact check <path>` is the source of truth. The rules behind it:

- **One file per page.** Inline all CSS and JS. Multi-page artifacts are a
  folder with an `index.html`, linked by relative paths (`href="details.html"`).
- **JavaScript:** inline `<script>` (classic or `type="module"`) and inline
  handlers run in a sandbox with no network, storage, cookies, workers, or
  `alert`/`confirm`/`prompt`. Keep state in memory or `location.hash`; embed
  data as `<script type="application/json">`. Pages must stay readable with
  scripts off.
- **Assets:** images, media, and fonts from `https:` or `data:` URLs;
  stylesheets from `https:`. Local files such as `chart.png` will not load:
  inline them as `data:` URLs or SVG.
- **Blocked:** `<script src>`, `<form>`, `<iframe>`, `<embed>`, `<object>`,
  `javascript:` URLs, meta refresh.
- **Size:** one upload has one byte limit (`check` reports it). Over it, split
  into linked pages; never drop requested content.

## Privacy

Artifacts are visible to everyone in the organization. Leave out secrets,
tokens, `.env` values, customer PII, and local filesystem paths, even though
outsiders cannot read the page.
