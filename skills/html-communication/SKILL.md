---
name: html-communication
description: Use when the user asks for an HTML write-up of work (NOT part of the codebase): plans, specs, findings, summaries, reports, comparisons, and UI mocks, published to Postplan for a shareable link.
---

# HTML Communication

Produce a readable HTML document about work and publish it to Postplan. This
is for documents about work, not HTML that ships in the product. To read a
`postplan.dev` URL, use the `postplan-read` skill.

## Run the CLI

Use `postplan` if it is on PATH. Otherwise use `npx -y postplan@latest`
(or `bunx postplan@latest`, `pnpm dlx postplan@latest`). A runner failure
(missing npx, npm registry DNS errors, engine conflicts) is not a Postplan
failure: try another runner, and report it as a runner problem.

## Steps

1. **Check readiness.** Before you build a page that is large, interactive,
   multi-page, or needs a custom URL, run `postplan check --json`. It reports
   the account, the upload limit, and what is allowed (`capabilities`). If the
   page needs JavaScript and `capabilities.inlineScripts` is false, ask the
   user to run `postplan auth login` now, before you build it.
2. **Write the page** by the rules below.
3. **Check the file**: `postplan check <path>`. Fix every error at the line it
   names. Treat each warning as a feature that will break for the reader.
   Done when the report says `Ready.`
4. **Upload**: `postplan upload <path> --json`. Read the exit code directly;
   do not pipe the command through `tail` or `head`.
5. **Report the receipt**: the local path, `url`, and `versionUrl`. The page is
   published only when you have a receipt with `"ok": true`. A written file or
   a started background job is not a receipt.

To update a page later, run the receipt's `updateCommand`, with `postplan`
replaced by your runner if the CLI is not on PATH.

## Service rules (Postplan enforces these)

`postplan check` is the source of truth for limits and capabilities. These are
the rules behind its errors.

- **Size**: one upload has one byte limit, and `check` reports it. When a page
  is over the limit, tell the user and split it into linked pages. Keep every
  requested section and all evidence.
- **JavaScript** (signed-in uploads only): inline classic or `type="module"`
  scripts, and inline handlers such as `onclick`. Scripts run in a sandbox with
  no storage, cookies, network requests, workers, or `alert`/`confirm`/`prompt`.
  Keep state in memory or in `location.hash`. Put data in a
  `<script type="application/json">` block. Links with `target="_blank"` work.
- **Assets**: images, video, audio, and fonts load from any https or data:
  URL; stylesheets load from any https URL. Postplan hosts only HTML, so a
  local file such as `chart.png` will not load: upload it first (for example
  with the `file-upload` skill) and use the returned https URL.
- **Blocked**: external scripts (`<script src>`), forms, iframes, embeds,
  objects, `javascript:` URLs, and meta refresh.
- **Privacy**: no secrets, tokens, private URLs, or local filesystem paths.

## Multi-page documents

Put the pages in one folder with an `index.html`, link them with relative
paths (`href="details.html"`, `href="docs/"`), and upload the folder:
`postplan upload ./report --json`. Each page is self-contained: inline its CSS
and JavaScript. Multi-page uploads need sign-in.

## Stable URLs

Re-uploading the same absolute path on the same machine updates the same page.
For a page that will be updated from other machines or other file paths, give
it a custom URL: `postplan upload <path> --slug q3-plan` publishes at
`https://q3-plan.postplan.dev`, and the same slug always updates that page.
To move an existing page to a custom URL, add `--draft <draft-id>`. Custom URLs
need the `custom-urls` flag (`check` shows `customUrls`);
`postplan check --slug <name>` shows whether a name is free. Use `--new`
(without `--draft` or `--slug`) only when the user wants a separate page.

## Document style (user preference)

These are defaults, not service limits. An explicit request wins.

- Write it like a spec: information-dense and scannable, with no hero section,
  decorative pill/badge/card chrome, marketing voice, or em dashes.
- Dark mode: true black (`#000`) page background, white (`#fff`) primary text,
  dark gray only for secondary surfaces or accents.
- Mobile-readable: a responsive viewport meta tag, generous line height, no
  fixed-width layouts.
- Use inline SVG diagrams when they make the document easier to digest.
- Give external links `target="_blank"` and `rel="noopener noreferrer"`.
- Use JavaScript when interactivity materially helps; a report should stay
  readable without it.

## UI mocks

When the ask is for variants to choose from ("make 5 mocks"):

- Render each variant as a real styled block, not a description of one.
- Label them `A`, `B`, `C`... so the user can reply with one letter.
- Lay them out for comparison, side by side or in clear sequence.
- Keep one file across rounds so the URL stays stable.

## Opening pages

Postplan only prints URLs. Report the URL to the user and leave opening it to
them; say the page is published, not that it was opened.
