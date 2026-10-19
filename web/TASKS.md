# htmlartifact web — checklist

**Done =** every web-facing page (landing, docs, sign-in, workspace feed, mine,
artifact detail, workspaces/create/join, invite, errors, 404) is rendered by the
React Router app in `web/`, inside the same Worker as the API; `bun run typecheck`,
`bun run typecheck:web` and the full test suite pass; the Pages build ships the
client assets; and each page is checked by screenshot at 390px and 1440px, light
and dark, with reduced motion respected and visible keyboard focus.

## Architecture
- Hono keeps every route, auth check, CSRF check and status code. Page handlers
  call `renderPage(c, page, status)` (src/frontend.ts), which runs the React
  Router SSR build with `page` as load context. The root loader returns it.
- Navigation is full-document (plain links, HTML form posts to Hono), smoothed
  with cross-document View Transitions. No `.data` or `/__manifest` requests
  reach Hono (`routeDiscovery: initial`).
- `web/build/server` is imported by `src/frontend.ts` and bundled by wrangler /
  Bun like the rest of the Worker; `web/build/client` ships as static assets
  (`[assets]` in wrangler.toml for dev/tests; copied next to `_worker.js` by
  scripts/build-pages.ts, with `/assets/*` served by Pages directly).
- `bun run dev:web` renders pages from fixtures (`web/app/fixtures.ts`):
  `/feed`, `/mine`, `/artifact`, `/workspaces?next=1`, `/join`, `/sign-in`,
  `/message`, `/not-found`, `/docs`; add `?fixture=worst` or `?fixture=empty`.

## Stack
React Router v8 (framework, SSR) · React 19 · Tailwind v4 · Base UI · motion ·
cmdk · clsx + cva · next-themes · Satori (OG image, build time)

## Checklist
- [x] Rebase onto ga/production (server already TypeScript there)
- [x] Scaffold `web/` (RR8, Vite 8, Tailwind v4, TS), fonts, tokens
- [x] Integrate: src/frontend.ts, page handlers, notFound, assets (wrangler + Pages)
- [x] Tests green with updated page assertions (+ /docs in the isolation route table, landing + 404 tests)
- [x] Design system: color, type, guilloche seal generator, components
- [x] Landing page
- [x] Docs page
- [x] App: sign-in, feed, mine, detail, workspaces, join/invite, errors, 404 (+ static artifact 404 restyled)
- [x] ⌘K palette, account menu (Base UI), filter on long feeds
- [x] Motion pass: review-animations findings fixed (press scale, `scale` vs `transform`, composited seal rings, VT timing, clip-path typing, reduced motion)
- [x] break-ui pass (worst-case fixtures): long names, unbreakable strings, null versions, 60 versions, badges
- [x] mobile-native pass: 16px inputs, theme-color, safe areas, touch-action
- [x] Screenshot review: 390 / 1440, light / dark
- [x] OG image (Satori → web/public/og.png), seal favicon
- [x] Code split by audience (landing ≈53 KB gz, app shell ≈65 KB gz)
- [x] Real walkthrough on the integrated Worker (emulator sign-in → create workspace → CLI upload → feed, ⌘K, menu, sign-out)
- [x] Security review of the integration (Opus; Codex hit its usage limit): 4 findings fixed — public files on Pages, dev assets on the sandbox host, `.data` paths, og:image origin
- [ ] Codex (gpt-6.1-sol, high) review, once its usage limit resets
- [ ] Real-device check (iOS Safari / Android Chrome) once deployed

## Not done / notes
- shiki is not used: docs code blocks are shell only, and shiki's WASM would
  bloat the Worker; plain highlighting (dimmed comments) instead.
- Sonner is not used: copy confirmations are inline (icon morph), and there are
  no async actions in the browser that need a toast.
