import { useRef, useState, type KeyboardEvent } from "react";
import { HistoryIcon, LockIcon } from "../components/icons";
import { Mark } from "../components/Logo";
import { Seal } from "../components/Seal";
import { Rule } from "../components/Sheet";
import { cx } from "../lib/cx";

// One link, three people. The agent publishes (left); three people open the
// same link (right), each getting exactly what htmlartifact serves them; the
// frame below shows the selected one. Every line is in the first paint; with
// motion allowed it plays once as a sequence, and it is usable throughout.

export const DEMO_ID = "k3j9x0a1b2c4";
const HOST = "htmlartifact.pages.dev";

const PEOPLE = [
  { key: "member", who: "Priya", note: "member of Northwind", code: 200, result: "Opens the plan", tone: "open" },
  { key: "signed-out", who: "Signed out", note: "no session", code: 302, result: "Signs in, then comes back", tone: "ask" },
  { key: "outsider", who: "Sam", note: "member of Globex", code: 404, result: "Not found", tone: "deny" }
] as const;
type Person = (typeof PEOPLE)[number]["key"];

const TONE = { open: "text-open", ask: "text-ask", deny: "text-deny" } as const;
const at = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
const typed = (text: string, ms: number) => ({ "--n": text.length, "--d": `${ms}ms` }) as React.CSSProperties;

export function Demo() {
  const [active, setActive] = useState<Person>("member");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const command = "npx htmlartifact upload plan.html";

  function onKey(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + PEOPLE.length) % PEOPLE.length;
    setActive(PEOPLE[next]!.key);
    tabs.current[next]?.focus();
  }

  return (
    <>
      <Rule inner="seq grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0 border-b border-line px-4 py-5 font-mono text-[12.5px] leading-[1.8] sm:px-6 md:border-b-0 md:border-r">
          <p className="appear flex gap-2.5 font-sans text-[14px] leading-snug text-muted" style={at(150)}>
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-faint" />
            The migration plan is ready. Publishing it for the team.
          </p>
          <p className="mt-3 text-foreground">
            <span aria-hidden className="select-none text-faint">
              ${" "}
            </span>
            <span className="type" style={typed(command, 500)}>
              {command}
            </span>
          </p>
          <p className="appear text-open" style={at(1500)}>
            Published version 3
          </p>
          <p className="appear break-all text-foreground" style={at(1580)}>
            https://{HOST}/d/{DEMO_ID}
          </p>
          <p className="appear text-muted" style={at(1660)}>
            Workspace: Northwind (members only)
          </p>
        </div>
        <div role="tablist" aria-label="Who opens the link" aria-orientation="vertical" className="min-w-0 divide-y divide-line">
          {PEOPLE.map((p, i) => (
            <button
              key={p.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={`demo-tab-${p.key}`}
              aria-selected={active === p.key}
              aria-controls="demo-panel"
              tabIndex={active === p.key ? 0 : -1}
              onClick={() => setActive(p.key)}
              onKeyDown={(e) => onKey(e, i)}
              className="appear group relative flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface aria-selected:bg-surface sm:px-6"
              style={at(1900 + i * 140)}
            >
              <span
                aria-hidden
                className={cx("absolute inset-y-0 left-0 w-[2px] transition-colors duration-150", active === p.key ? "bg-foreground" : "bg-transparent")}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-foreground">{p.who}</span>
                <span className="block truncate text-[13px] text-muted">{p.note}</span>
              </span>
              <span className="text-right">
                <span className={cx("block font-mono text-[13px] font-medium tabular-nums", TONE[p.tone])}>{p.code}</span>
                <span className="block text-[12.5px] text-muted">{p.result}</span>
              </span>
            </button>
          ))}
        </div>
      </Rule>
      <Rule inner="bg-surface/60 p-3 sm:p-5">
        <figure
          id="demo-panel"
          role="tabpanel"
          aria-labelledby={`demo-tab-${active}`}
          className="overflow-hidden rounded-card border border-border bg-card"
        >
          <div className="flex items-center gap-3 border-b border-line px-3 py-2">
            <span className="hidden gap-1.5 sm:flex" aria-hidden>
              <i className="size-2.5 rounded-full bg-border" />
              <i className="size-2.5 rounded-full bg-border" />
              <i className="size-2.5 rounded-full bg-border" />
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] bg-surface px-2.5 py-1 font-mono text-[12px] text-muted">
              <LockIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {HOST}/d/<span className="text-foreground">{DEMO_ID}</span>
              </span>
            </div>
          </div>
          <div className="grid min-h-[300px] sm:min-h-[318px]">
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
        </figure>
      </Rule>
    </>
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
      <Seal id={DEMO_ID} size={16} />
      <span className="hidden text-muted sm:inline">Northwind</span>
      <span aria-hidden className="hidden text-faint sm:inline">
        /
      </span>
      <span className="min-w-0 truncate font-medium text-foreground">Billing migration plan</span>
      <span className="shrink-0 rounded-[5px] border border-border px-1.5 font-mono text-[11.5px] leading-[18px] text-muted">v3</span>
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
    <article className="flex-1 bg-white px-5 py-6 font-[system-ui,-apple-system,'Segoe_UI',sans-serif] text-[13px] leading-relaxed text-[#1f2937] sm:px-8 sm:py-7">
      <p className="text-[12px] font-semibold text-[#0f766e]">Plan, written by Claude</p>
      <p className="mt-1 text-[21px] font-bold leading-tight tracking-tight text-[#111827]">Billing migration plan</p>
      <p className="mt-2 max-w-[56ch] text-[#4b5563]">
        Move subscriptions from the legacy invoice tables to the new ledger in six weeks, with dual writes until reads are cut over.
      </p>
      <div className="mt-5 space-y-2.5">
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
    <div className="grid flex-1 place-items-center px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-full border border-border text-foreground">
          <LockIcon className="size-4" />
        </span>
        <p className="mt-5 text-[20px] font-medium tracking-[-0.02em] text-foreground">Sign in to open this</p>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[13.5px] leading-relaxed text-muted">
          It belongs to a workspace, and only its members can open it. Sign in and you'll land right back here.
        </p>
        <span className="mt-5 inline-flex h-9 items-center rounded-control bg-foreground px-3.5 text-[13.5px] font-medium text-background">
          Sign in or create an account
        </span>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="grid flex-1 place-items-center px-6 py-10 text-center">
      <div>
        <Mark className="mx-auto size-7" />
        <p aria-hidden className="mt-5 select-none font-mono text-[56px] font-medium leading-none tracking-[-0.04em] text-faint">
          404
        </p>
        <p className="mt-3 text-[20px] font-medium tracking-[-0.02em] text-foreground">Not found</p>
        <p className="mx-auto mt-1.5 max-w-[36ch] text-[13.5px] leading-relaxed text-muted">
          This artifact does not exist, or it belongs to a workspace you are not in.
        </p>
      </div>
    </div>
  );
}
