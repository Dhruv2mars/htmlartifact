import { useRef, useState, type KeyboardEvent } from "react";
import { FoilSeal } from "../components/FoilSeal";
import { HistoryIcon, LockIcon } from "../components/icons";
import { Mark } from "../components/Logo";
import { Seal } from "../components/Seal";
import { cx } from "../lib/cx";

// The landing's one working story: an agent publishes, the link is sealed
// to a workspace, and the artifact opens, right below the headline. Who is
// looking switches in place, so the same link shows what each person gets.
// It sits in the first screen at every width, so the sequence plays on load:
// pure CSS, every state in the first paint (and without JavaScript). Replay
// remounts only the animated parts, so it keeps keyboard focus itself.

const STORY_ID = "k3j9x0a1b2c4";
const HOST = "htmlartifact.pages.dev";
const COMMAND = "npx htmlartifact upload plan.html";

// Roles first (what decides access); the person is the example.
const PEOPLE = [
  { key: "member", label: "Member", who: "Priya in Northwind", code: 200, result: "can open the plan and every earlier version.", tone: "text-open" },
  { key: "signed-out", label: "Signed out", who: "Anyone signed out", code: 302, result: "is asked to sign in, then brought straight back.", tone: "text-ask" },
  { key: "outsider", label: "Non-member", who: "Sam in Globex", code: 404, result: "gets the same 404 as a link that never existed.", tone: "text-deny" }
] as const;
type Person = (typeof PEOPLE)[number]["key"];

const at = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export function Story() {
  const [active, setActive] = useState<Person>("member");
  const [run, setRun] = useState(0); // bumping it remounts, replaying the sequence
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + PEOPLE.length) % PEOPLE.length;
    setActive(PEOPLE[next]!.key);
    tabs.current[next]?.focus();
  }

  const person = PEOPLE.find((p) => p.key === active)!;

  return (
    <div className="story grid lg:grid-cols-[minmax(0,19.5rem)_minmax(0,1fr)]">
      {/* The agent publishes. Phones get the compact strip: the command and
          its result (the link itself is in the address bar right below). */}
      <div key={`l${run}`} className="min-w-0 border-b border-line px-4 py-3.5 font-mono text-[12px] leading-[1.75] sm:px-6 lg:border-b-0 lg:border-r lg:px-5 lg:py-5">
        <p className="s-in mb-3 hidden gap-2.5 font-sans text-[13.5px] leading-snug text-muted lg:flex" style={at(0)}>
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-faint" />
          The plan is ready. Publishing it for the team.
        </p>
        <p className="text-foreground">
          <span aria-hidden className="select-none text-faint">
            ${" "}
          </span>
          <span className="s-type" style={{ "--n": COMMAND.length, ...at(250) } as React.CSSProperties}>
            {COMMAND}
          </span>
        </p>
        <p className="s-in text-open" style={at(1250)}>
          Published <span className="lg:hidden">v3</span>
          <span className="hidden lg:inline">version 3</span>
          <span className="text-muted lg:hidden"> · Northwind members only</span>
        </p>
        <p className="s-in hidden items-start gap-2 text-foreground lg:flex" style={at(1330)}>
          <Seal id={STORY_ID} size={14} className="mt-[5px] shrink-0" />
          <span>
            {HOST}/d/<wbr />
            {STORY_ID}
          </span>
        </p>
        <p className="s-in hidden text-muted lg:block" style={at(1410)}>
          Northwind members only
        </p>
      </div>

      {/* The link, sealed, opened by whoever is looking. */}
      <div className="min-w-0 bg-surface/60 p-3 sm:p-5">
        <figure className="relative">
          <div className="overflow-hidden rounded-card border border-border bg-card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
              <div className="mr-11 flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-[6px] bg-surface px-2.5 py-1 font-mono text-[12px] text-muted sm:mr-0">
                <LockIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {HOST}/d/<span className="text-foreground">{STORY_ID}</span>
                </span>
              </div>
              <div className="s-in basis-full sm:mr-20 sm:basis-auto" style={at(1900)}>
                <div role="tablist" aria-label="Open the link as" className="inline-flex min-w-0 max-w-full flex-wrap rounded-[7px] border border-line bg-surface p-0.5">
                  {PEOPLE.map((p, i) => (
                    <button
                      key={p.key}
                      ref={(el) => {
                        tabs.current[i] = el;
                      }}
                      role="tab"
                      id={`story-tab-${p.key}`}
                      aria-selected={active === p.key}
                      aria-controls="story-panel"
                      tabIndex={active === p.key ? 0 : -1}
                      onClick={() => setActive(p.key)}
                      onKeyDown={(e) => onKey(e, i)}
                      className={cx(
                        "h-7 whitespace-nowrap rounded-[5px] px-2.5 text-[12.5px] transition-[background-color,color,box-shadow] duration-150",
                        active === p.key
                          ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)] forced-colors:outline-2 forced-colors:outline-solid forced-colors:-outline-offset-2 forced-colors:outline-[Highlight]"
                          : "text-muted hover:text-foreground"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {/* What this person gets, said before the page itself. */}
            <div className="flex items-start gap-3 border-b border-line px-3 py-2 text-[13px] leading-snug sm:px-4">
              <p aria-live="polite" className="flex min-w-0 flex-1 gap-3 text-muted">
                <span className={cx("font-mono font-medium tabular-nums", person.tone)}>{person.code}</span>{" "}
                <span className="min-w-0">
                  <span className="text-foreground">{person.who}</span> {person.result}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setRun((n) => n + 1)}
                className="hidden shrink-0 rounded-[5px] px-1 text-[12.5px] text-muted underline decoration-control underline-offset-4 hover:text-foreground motion-safe:inline-block"
              >
                Replay
              </button>
            </div>
            <div key={`p${run}`} id="story-panel" role="tabpanel" aria-labelledby={`story-tab-${active}`} className="s-print grid min-h-[284px]" style={at(1500)}>
              <Panel show={active === "member"}>
                <ReadingBar />
                <Plan />
              </Panel>
              <Panel show={active === "signed-out"}>
                <SignInWall />
              </Panel>
              <Panel show={active === "outsider"}>
                <NotFound />
              </Panel>
            </div>
          </div>
          {/* The seal stamped on the document: sealed to Northwind. */}
          <div key={`s${run}`} className="s-stamp pointer-events-none absolute -right-1 -top-3 origin-top-right scale-[0.6] sm:-right-2 sm:-top-7 sm:scale-[0.78] lg:-right-5 lg:-top-8 lg:scale-100" style={at(1350)} aria-hidden>
            <div className="rounded-full bg-background p-1 shadow-[0_0_0_1px_var(--line)]">
              <FoilSeal id={STORY_ID} size={84} />
            </div>
          </div>
        </figure>
      </div>
    </div>
  );
}

function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-hidden={!show}
      inert={!show}
      className={cx(
        "col-start-1 row-start-1 flex flex-col transition-[opacity,filter,translate] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none",
        show ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0 blur-[2px]"
      )}
    >
      {children}
    </div>
  );
}

// The bar htmlartifact puts over every artifact (src/render-web.ts).
function ReadingBar() {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-4 py-2 text-[12.5px]">
      <Seal id={STORY_ID} size={16} />
      <span className="hidden text-muted sm:inline">Northwind</span>
      <span aria-hidden className="hidden text-faint sm:inline">
        /
      </span>
      <span className="min-w-0 truncate font-medium text-foreground">Billing migration plan</span>
      <span className="shrink-0 rounded-[5px] border border-border px-1.5 font-mono text-[12px] leading-[18px] text-muted">v3</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted">
        <HistoryIcon className="size-3.5" />
        <span className="hidden sm:inline">History</span>
      </span>
    </div>
  );
}

// What an agent actually publishes: its own typography, not ours.
function Plan() {
  const phases = [
    { name: "Dual-write invoices", weeks: "Wk 1–2", from: 0, to: 2 },
    { name: "Backfill 2.1M subscriptions", weeks: "Wk 2–4", from: 1.5, to: 4 },
    { name: "Cut over reads", weeks: "Wk 5", from: 4, to: 5 },
    { name: "Retire Stripe v1 webhooks", weeks: "Wk 6", from: 5, to: 6 }
  ];
  return (
    <article className="flex-1 bg-white px-5 py-5 font-[system-ui,-apple-system,'Segoe_UI',sans-serif] text-[13px] leading-relaxed text-[#1f2937] sm:px-7 sm:py-6">
      <p className="text-[12px] font-semibold text-[#0f766e]">Plan, written by Claude</p>
      <p className="mt-1 text-[20px] font-bold leading-tight tracking-tight text-[#111827]">Billing migration plan</p>
      <p className="mt-2 max-w-[56ch] text-[#4b5563]">
        Move subscriptions from the legacy invoice tables to the new ledger in six weeks, with dual writes until reads are cut over.
      </p>
      <div className="mt-4 space-y-2.5">
        {phases.map((p) => (
          <div key={p.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[12rem_1fr_auto]">
            <span className="truncate font-medium text-[#111827]">{p.name}</span>
            <span className="relative order-last col-span-2 h-2 rounded-full bg-[#eef0f3] sm:order-none sm:col-span-1">
              <span className="absolute inset-y-0 rounded-full bg-[#14b8a6]" style={{ left: `${(p.from / 6) * 100}%`, width: `${((p.to - p.from) / 6) * 100}%` }} />
            </span>
            <span className="text-[12px] tabular-nums text-[#4b5563]">{p.weeks}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function SignInWall() {
  return (
    <div className="grid flex-1 place-items-center px-6 py-8 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-full border border-border text-foreground">
          <LockIcon className="size-4" />
        </span>
        <p className="mt-4 text-[19px] font-medium tracking-[-0.02em] text-foreground">Sign in to open this</p>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[13.5px] leading-relaxed text-muted">
          It belongs to a workspace, and only its members can open it. Sign in and you'll land right back here.
        </p>
        <a href="/auth/sign-in" className="press mt-5 inline-flex h-9 items-center rounded-control bg-foreground px-3.5 text-[13.5px] font-medium text-background hover:bg-foreground/85">
          Sign in or create an account
        </a>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="grid flex-1 place-items-center px-6 py-8 text-center">
      <div>
        <Mark className="mx-auto size-7" />
        <p aria-hidden className="mt-4 select-none font-mono text-[52px] font-medium leading-none tracking-[-0.06em] text-faint">
          404
        </p>
        <p className="mt-3 text-[19px] font-medium tracking-[-0.02em] text-foreground">Not found</p>
        <p className="mx-auto mt-1.5 max-w-[36ch] text-[13.5px] leading-relaxed text-muted">
          This artifact does not exist, or it belongs to a workspace you are not in.
        </p>
      </div>
    </div>
  );
}
