# htmlartifact — design notes

## Subject, audience, job
- Subject: HTML that coding agents write (plans, specs, reviews, reports,
  mocks), published to a link only a workspace can open.
- Audience: engineers who run Claude Code / Codex daily; the lead who decides
  where the team's agent output lives.
- Job of the landing page: in five seconds, "my agent's HTML → a private link
  for my team, one command"; then copy `npx htmlartifact login`.

## Direction: security printing
An artifact is treated like a security document. Banknotes, cheques and
passports prove who a document is for with line-work nobody else can fake:
guilloche rosettes, microprint, serial numbers. htmlartifact borrows that.

- **The seal** — every artifact gets a guilloche rosette generated from its id.
  Same id, same seal, everywhere (feed, detail, invite, OG image). It is the
  one loud element. It draws itself once on the hero; it catches light like a
  hologram under the pointer.
- **Microprint** — tiny repeated text as the hairline on a few surfaces
  (artifact window edge, invite ticket). Never as body decoration.
- **Serials** — draft ids and invite codes are set in mono like serial numbers;
  that is the only job mono has (plus real commands).

## Tokens
| name | light | dark | role |
|---|---|---|---|
| paper | #F5F6F8 | #0B1020 | page |
| ink | #121A33 | #E7EAF4 | text, primary buttons |
| fog | #5E6782 | #8E97B3 | secondary text |
| rule | #DFE2EA | #1F2741 | hairlines |
| intaglio | #2337C6 | #8C9BFF | seals, links, focus |
| pass / deny | #0F7A55 / #B42A37 | #4FD1A1 / #FF7B86 | access results only |

Seal inks (picked per id): intaglio blue, verdigris #0F7A6B, plum #7A2E8C,
oxblood #9E2B3A, ochre #8F6410.

Type: Archivo (variable width). Headlines expanded (125%), tight, heavy —
like a banknote denomination. Body at 100%. Martian Mono (87.5%) only for
commands, ids, codes.

## Layout
Left-aligned. Hero copy on the left third, the stage (terminal → artifact
window with "View as") under it, full width. Sections are full-bleed bands,
separated by space, not by cards.

## Principles
1. Show the real behaviour (real commands, real output, the real 404) instead
   of describing it.
2. Privacy is demonstrated, not claimed: the View-as switch.
3. One bold thing per screen: the seal. Everything else is quiet.
4. Motion answers people; the only unprompted motion is the hero sequence.

## Avoided defaults (checked)
No cream + serif + terracotta; no black + acid green; no card grid; no
all-caps eyebrows; no "A · B · C" meta strings; no "→" on links; mono never
used for decorative labels.
