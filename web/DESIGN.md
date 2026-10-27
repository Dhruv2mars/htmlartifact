# htmlartifact: design contract

Read before touching anything in `web/`, `src/render-web.ts` or `src/render.ts`.

## Subject, audience, job

- **Subject.** The HTML coding agents write (plans, specs, reviews, reports,
  mocks), published to a link that only one workspace can open.
- **Audience.** Engineers who run Claude Code or Codex all day, and the lead who
  decides where the team's agent output lives. They read terminals, diffs and
  specs; they trust precision and distrust decoration.
- **Job.** Landing: in five seconds, "my agent's HTML becomes a private link for
  my team, in one command", then copy `npx htmlartifact login`. App: find the
  artifact, open it, see its versions, share the link. Nothing else competes.

## Philosophy: under seal

An artifact is somebody's work, sealed for a team. htmlartifact is the envelope
and the seal, never the content. So the frame is quiet and exact, and the work
inside it is the loud thing.

1. **Quiet frame, loud artifact.** Zinc on near-black (and a real light theme).
   No brand colour. Colour only ever means something: green opens, amber asks
   to sign in, red is the 404. If it is coloured and means nothing, remove it.
2. **One ruled sheet.** Every page is a single sheet: a centred column bounded
   by full-height hairline rails. Content sits in ruled rows; the gaps between
   sections are hatched, the sealed negative space of the sheet. Nothing floats
   outside the rules, nothing is a card on a card. Hairlines, not shadows.
3. **The seal is the only ornament.** A fine guilloche medallion drawn in
   hairline ink, generated from the artifact's id: same id, same seal,
   everywhere. Monochrome. At most one large seal per screen (the hero link, an
   artifact's history, an invite); in lists it shrinks to a 20px glyph.
   **The foil exception.** The stamped seal (the landing story, an invite
   ticket) carries a thin iridescent sheen, the way foil on a real seal does.
   It is the only colour that means nothing, and it is allowed because it is
   light on the seal, not paint: it lives only inside the seal's own strokes,
   it is faint at rest, it turns with a fine pointer, and it is the one
   decorative motion on the site. It never spreads to text, rules or
   backgrounds, and no second ornament may borrow it.
4. **Small, exact type.** Geist for everything, Geist Mono for what you could
   type or compare: commands, ids, codes, counts, dates in tables. Body 15px,
   UI 14px, metadata 13px mono. Headings medium weight with tight tracking,
   never heavy. Numbers tabular.
5. **Motion explains or answers.** One orchestrated moment per page at most:
   on the landing, the command types, the link prints and three access checks
   resolve, in under three seconds, interactive the whole time. Everything else
   answers a person: 120 to 220 ms, strong ease-out, presses scale to 0.97,
   nothing animates on a keyboard shortcut. Reduced motion keeps fades only.
6. **Margin notes.** On wide screens with a fine pointer, a handwritten note
   in the margin may point at the one thing worth trying in a section. One per
   section at most, decorative (aria-hidden), never carrying information.
7. **Show, don't claim.** Real commands, real output, the real 404 page. Every
   claim about privacy is demonstrated in the UI or it is cut.

## Tokens (web/app/app.css)

| token | light | dark | role |
|---|---|---|---|
| background | zinc-50 #fafafa | zinc-950 #09090b | the sheet |
| card | #ffffff | zinc-900 #18181b | raised cells: inputs, popovers, code |
| surface | zinc-100 #f4f4f5 | #111113 | recessed cells, hover rows |
| line | #e9e9ec | #1f1f23 | the hairline every rule is drawn with |
| border | zinc-200 #e4e4e7 | zinc-800 #27272a | controls |
| control | zinc-400 #a1a1aa | zinc-600 #52525b | editable field edges (3:1) |
| foreground | zinc-950 | zinc-50 | text |
| muted | zinc-600 #52525b | zinc-400 #a1a1aa | secondary text (AA everywhere) |
| faint | #6b6b74 | #8a8a94 | tertiary: labels, serials, counts (AA on every surface) |
| open / ask / deny | #15803d / #b45309 / #b91c1c | #4ade80 / #fbbf24 / #f87171 | access results only |

Radius: 6px chips, 8px controls, 12px cells that must be rounded (popovers,
code). Rows inside the ruled sheet are square.

## Layout

- Sheet width 880px for public pages (wide enough for the demo, narrow enough
  to read), 1040px for the app; 16px side padding inside the rails on phones.
- Header: a ruled row inside the rails. Footer: the last ruled row.
- Section = label row (mono, 13px) + content rows. Between sections: a 32px
  hatched gutter (repeating 45° hairlines at the line colour).
- Phones: the rails sit at the screen edge; margin notes disappear.

## Avoided (checked)

No brand gradient, no glow, no coloured seals (the foil sheen above is the one exception), no card grids, no drop shadows
on page content, no all-caps eyebrows, no heavy display weights, no "→" glued
to link text, no fade-up on every section.
