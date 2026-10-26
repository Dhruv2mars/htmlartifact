import { useRef, useState, type KeyboardEvent } from "react";
import { HistoryIcon, LockIcon } from "../components/icons";
import { Mark } from "../components/Logo";
import { Seal } from "../components/Seal";
import { cx } from "../lib/cx";
import { HeroSeal } from "./HeroSeal";

// The hero's proof: one link, three people. The tabs switch who is looking;
// the window shows exactly what htmlartifact serves each of them, and the
// seal stamped on its corner is the artifact's own.

export const HERO_ID = "k3j9x0a1b2c4";
const HOST = "htmlartifact.pages.dev";

const VIEWERS = [
  { key: "member", label: "Member" },
  { key: "signed-out", label: "Signed out" },
  { key: "outsider", label: "Non-member" }
] as const;
type ViewerKey = (typeof VIEWERS)[number]["key"];

const CAPTION: Record<ViewerKey, string> = {
  member: "Priya is in Northwind, so the plan opens, with every earlier version one click away.",
  "signed-out": "No session: htmlartifact asks them to sign in, then brings them straight back to this link.",
  outsider: "Sam is signed in, but to Globex, and gets the same 404 as a link that never existed."
};

export function ArtifactStage() {
  const [active, setActive] = useState<ViewerKey>("member");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + VIEWERS.length) % VIEWERS.length;
    setActive(VIEWERS[next]!.key);
    tabs.current[next]?.focus();
  }

  return (
    <figure className="stage relative">
      <div className="relative overflow-hidden rounded-sheet border border-rule bg-paper-2 shadow-sheet">
        <div className="flex items-center gap-3 border-b border-rule px-3 py-2.5 sm:px-4">
          <span className="hidden gap-1.5 sm:flex" aria-hidden>
            <i className="size-2.5 rounded-full bg-rule-2" />
            <i className="size-2.5 rounded-full bg-rule-2" />
            <i className="size-2.5 rounded-full bg-rule-2" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-control bg-paper-3 px-3 py-1.5 font-mono text-[12px] text-fog mr-14 sm:mr-24 lg:mr-28">
            <LockIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {HOST}/d/<span className="text-ink">{HERO_ID}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-b border-rule bg-paper-3/50 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
          <span id="viewas" className="text-[12.5px] font-medium text-fog">
            Open the link as
          </span>
          <div role="tablist" aria-labelledby="viewas" className="grid grid-cols-3 gap-0.5 rounded-control bg-paper-3 p-0.5 ring-1 ring-rule sm:flex">
            {VIEWERS.map((v, i) => (
              <button
                key={v.key}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                role="tab"
                id={`tab-${v.key}`}
                aria-selected={active === v.key}
                aria-controls="stage-panel"
                tabIndex={active === v.key ? 0 : -1}
                onClick={() => setActive(v.key)}
                onKeyDown={(e) => onKey(e, i)}
                className={cx(
                  "h-8 whitespace-nowrap rounded-[8px] px-2 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150 sm:px-3.5",
                  active === v.key ? "bg-paper-2 text-ink shadow-[0_1px_2px_rgb(14_21_48/0.12)] ring-1 ring-rule" : "text-ink-2 hover:text-ink"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div id="stage-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="relative grid min-h-[340px] sm:min-h-[452px]">
          <Panel show={active === "member"}>
            <ViewerBar />
            <PlanDocument />
          </Panel>
          <Panel show={active === "signed-out"}>
            <SignInWall />
          </Panel>
          <Panel show={active === "outsider"}>
            <NotFoundPage />
          </Panel>
        </div>
      </div>

      <div className="stage-seal pointer-events-none absolute -right-3 -top-9 sm:-right-6 sm:-top-12 lg:-right-10 lg:-top-14" aria-hidden>
        <div className="rounded-full bg-paper p-1.5 shadow-sheet ring-1 ring-rule">
          <HeroSeal id={HERO_ID} />
        </div>
      </div>

      <figcaption className="mt-4 min-h-[3em] max-w-[56ch] text-[14px] leading-relaxed text-fog" aria-live="polite">
        {CAPTION[active]}
      </figcaption>
    </figure>
  );
}

function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-hidden={!show}
      inert={!show}
      className={cx(
        "col-start-1 row-start-1 flex flex-col transition-[opacity,filter] duration-200 ease-out motion-reduce:transition-none",
        show ? "opacity-100" : "pointer-events-none opacity-0 blur-[2px]"
      )}
    >
      {children}
    </div>
  );
}

// The reading bar htmlartifact puts over every artifact.
function ViewerBar() {
  return (
    <div className="flex items-center gap-2.5 border-b border-rule px-4 py-2 text-[12.5px] sm:px-5">
      <Seal id={HERO_ID} size={16} />
      <span className="hidden text-fog sm:inline">Northwind</span>
      <span aria-hidden className="hidden text-rule-2 sm:inline">
        /
      </span>
      <span className="min-w-0 truncate font-medium text-ink">Billing migration plan</span>
      <span className="shrink-0 rounded-chip bg-wash px-1.5 py-px text-[12px] font-medium text-intaglio">v3 Latest</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-ink-2">
        <HistoryIcon className="size-3.5" />
        <span className="hidden sm:inline">History</span>
      </span>
    </div>
  );
}

// What an agent actually publishes: its own typography, not ours.
function PlanDocument() {
  const phases = [
    { name: "Dual-write invoices", weeks: "Wk 1–2", from: 0, to: 2 },
    { name: "Backfill 2.1M subscriptions", weeks: "Wk 2–4", from: 1.5, to: 4 },
    { name: "Cut over reads", weeks: "Wk 5", from: 4, to: 5 },
    { name: "Retire Stripe v1 webhooks", weeks: "Wk 6", from: 5, to: 6 }
  ];
  return (
    <article className="relative flex-1 bg-white px-5 py-6 font-[system-ui,-apple-system,'Segoe_UI',sans-serif] text-[13px] leading-relaxed text-[#1f2937] sm:px-8 sm:py-7 dark:bg-[#111827] dark:text-[#d1d5db]">
      <p className="text-[12px] font-semibold text-[#0f766e] dark:text-[#5eead4]">Plan, written by Claude</p>
      <h3 className="mt-1 text-[21px] font-bold leading-tight tracking-tight text-[#111827] sm:text-[24px] dark:text-white">Billing migration plan</h3>
      <p className="mt-2 max-w-[56ch] text-[#4b5563] dark:text-[#b4bcc8]">
        Move subscriptions from the legacy invoice tables to the new ledger in six weeks, with dual writes until reads are cut over.
      </p>
      <div className="mt-5 space-y-2.5">
        {phases.map((p) => (
          <div key={p.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[12rem_1fr_auto]">
            <span className="truncate font-medium text-[#111827] dark:text-white">{p.name}</span>
            <span className="relative order-last col-span-2 h-2 rounded-full bg-[#eef0f3] sm:order-none sm:col-span-1 dark:bg-white/10">
              <span
                className="absolute inset-y-0 rounded-full bg-[#14b8a6]"
                style={{ left: `${(p.from / 6) * 100}%`, width: `${((p.to - p.from) / 6) * 100}%` }}
              />
            </span>
            <span className="text-[12px] tabular-nums text-[#4b5563] dark:text-[#b4bcc8]">{p.weeks}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 hidden gap-3 sm:grid sm:grid-cols-2">
        <div className="rounded-lg border border-[#e5e7eb] p-3 dark:border-white/12">
          <p className="text-[12px] font-semibold text-[#b45309] dark:text-[#fbbf24]">Risk</p>
          <p className="mt-1">Proration drift during backfill. Mitigation: nightly diff job, alert above 0.01%.</p>
        </div>
        <div className="rounded-lg border border-[#e5e7eb] p-3 dark:border-white/12">
          <p className="text-[12px] font-semibold text-[#4338ca] dark:text-[#a5b4fc]">Open question</p>
          <p className="mt-1">Do annual plans renew on the old ledger if they started before the cut-over?</p>
        </div>
      </div>
    </article>
  );
}

function SignInWall() {
  return (
    <div className="grid flex-1 place-items-center px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid size-11 place-items-center rounded-full border border-rule-2 bg-paper-2 text-intaglio shadow-sheet">
          <LockIcon className="size-[18px]" />
        </span>
        <p className="mt-5 font-wide text-[22px] font-[700] tracking-[-0.02em] text-ink">Sign in to open this</p>
        <p className="mx-auto mt-2 max-w-[34ch] text-[14px] leading-relaxed text-fog">
          It belongs to a workspace, and only its members can open it. Sign in and you'll land right back here.
        </p>
        <span className="mt-6 inline-flex h-10 items-center rounded-control bg-ink px-4 text-[14px] font-medium text-paper">Sign in or create an account</span>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="grid flex-1 place-items-center px-6 py-10 text-center">
      <div>
        <Mark className="mx-auto size-9" />
        <p className="mt-5 select-none font-expanded text-[64px] font-[800] leading-none tracking-[-0.05em] text-rule-2">404</p>
        <p className="mt-3 font-wide text-[22px] font-[700] tracking-[-0.02em] text-ink">Not found</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-[14px] leading-relaxed text-fog">
          This artifact does not exist, or it belongs to a workspace you are not in.
        </p>
      </div>
    </div>
  );
}
