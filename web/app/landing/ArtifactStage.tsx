import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "../lib/cx";
import { LockIcon } from "../components/icons";
import { Seal } from "../components/Seal";

// The hero's proof: one link, three people. Tabs switch who is looking; the
// window shows exactly what htmlartifact serves each of them.

export const HERO_ID = "k3j9x0a1b2c4";
const HOST = "htmlartifact.pages.dev";

const VIEWERS = [
  { key: "member", label: "Priya", note: "in Northwind" },
  { key: "signed-out", label: "Signed out", note: "" },
  { key: "outsider", label: "Sam", note: "in Globex" }
] as const;
type ViewerKey = (typeof VIEWERS)[number]["key"];

const CAPTION: Record<ViewerKey, string> = {
  member: "Priya is in Northwind, so the plan opens. So does every earlier version.",
  "signed-out": "No session. htmlartifact asks for sign-in, then brings them straight back to this link.",
  outsider: "Sam is signed in, but to Globex. The answer is the same 404 a link that never existed gets."
};

export function ArtifactStage({ start = 0 }: { start?: number }) {
  const [active, setActive] = useState<ViewerKey>("member");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState<string | null>(null);

  // The active pill is a clipped copy of the whole tab row (Emil's clip-path
  // tabs): its colours change exactly at the edge, with no per-label fades.
  useLayoutEffect(() => {
    const measure = () => {
      const row = list.current;
      const tab = tabs.current[VIEWERS.findIndex((v) => v.key === active)];
      if (!row || !tab) return;
      const left = tab.offsetLeft;
      const right = row.offsetWidth - left - tab.offsetWidth;
      setClip(`inset(0 ${right}px 0 ${left}px round 999px)`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  function onKey(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + VIEWERS.length) % VIEWERS.length;
    setActive(VIEWERS[next]!.key);
    tabs.current[next]?.focus();
  }

  const label = (v: (typeof VIEWERS)[number]) => (
    <>
      <span className="font-medium">{v.label}</span>
      {v.note && <span className="opacity-60">{v.note}</span>}
    </>
  );

  return (
    <div className="stage relative" style={{ "--d": `${start}ms` } as React.CSSProperties}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id="viewas" className="text-[13px] text-fog">
          Open the link as
        </span>
        <div ref={list} className="relative rounded-full border border-rule bg-paper-2 p-1">
          <div role="tablist" aria-labelledby="viewas" className="relative flex">
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
                  "relative flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink",
                  !clip && active === v.key && "bg-ink text-paper"
                )}
              >
                {label(v)}
              </button>
            ))}
          </div>
          {clip && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-1 flex rounded-full bg-ink text-paper transition-[clip-path] duration-[260ms] ease-[var(--ease-out)] motion-reduce:transition-none"
              style={{ clipPath: clip }}
            >
              {VIEWERS.map((v) => (
                <span key={v.key} className="flex h-8 items-center gap-1.5 px-3.5 text-[13px]">
                  {label(v)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="stage-window relative overflow-hidden rounded-2xl border border-rule bg-paper-2 shadow-[0_40px_80px_-40px_rgba(18,26,51,0.35)]">
        <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-paper px-3 py-1.5 font-mono text-[11.5px] text-fog">
            <LockIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {HOST}/d/<span className="text-ink">{HERO_ID}</span>
            </span>
          </div>
        </div>

        <div id="stage-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="stage-print relative grid min-h-[430px] sm:min-h-[470px]">
          <Panel show={active === "member"}>
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

      <p className="mt-4 min-h-[3em] max-w-[52ch] text-[14px] leading-relaxed text-fog" aria-live="polite">
        {CAPTION[active]}
      </p>
    </div>
  );
}

function Panel({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-hidden={!show}
      inert={!show}
      className={cx(
        "col-start-1 row-start-1 transition-[opacity,filter,scale] duration-200 ease-out motion-reduce:transition-none",
        show ? "opacity-100" : "pointer-events-none scale-[0.995] opacity-0 blur-[3px]"
      )}
    >
      {children}
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
    <article className="relative px-6 py-6 font-[system-ui,-apple-system,'Segoe_UI',sans-serif] text-[13px] leading-relaxed text-[#1f2937] sm:px-9 sm:py-8 dark:text-[#d1d5db]">
      <p className="text-[11px] font-semibold text-[#0f766e] dark:text-[#5eead4]">Plan v3, written by Claude</p>
      <h3 className="mt-1 text-[22px] font-bold leading-tight tracking-tight text-[#111827] sm:text-[26px] dark:text-white">Billing migration plan</h3>
      <p className="mt-2 max-w-[56ch] text-[#4b5563] dark:text-[#9ca3af]">
        Move subscriptions from the legacy invoice tables to the new ledger in six weeks, with dual writes until reads are
        cut over. No customer-visible downtime.
      </p>
      <div className="mt-5 space-y-2">
        {phases.map((p) => (
          <div key={p.name} className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[13rem_1fr_auto]">
            <span className="truncate font-medium text-[#111827] dark:text-white">{p.name}</span>
            <span className="relative order-last col-span-2 h-2 rounded-full bg-[#f3f4f6] sm:order-none sm:col-span-1 dark:bg-white/8">
              <span
                className="absolute inset-y-0 rounded-full bg-[#14b8a6]"
                style={{ left: `${(p.from / 6) * 100}%`, width: `${((p.to - p.from) / 6) * 100}%` }}
              />
            </span>
            <span className="text-[11px] tabular-nums text-[#6b7280]">{p.weeks}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[#e5e7eb] p-3.5 dark:border-white/10">
          <p className="text-[11px] font-semibold text-[#b45309] dark:text-[#fbbf24]">Risk</p>
          <p className="mt-1">Proration drift during backfill. Mitigation: nightly diff job, alert above 0.01%.</p>
        </div>
        <div className="rounded-lg border border-[#e5e7eb] p-3.5 dark:border-white/10">
          <p className="text-[11px] font-semibold text-[#4338ca] dark:text-[#a5b4fc]">Open question</p>
          <p className="mt-1">Do annual plans renew on the old ledger if they started before cut-over?</p>
        </div>
      </div>
    </article>
  );
}

function SignInWall() {
  return (
    <div className="grid h-full place-items-center px-6 py-10 text-center">
      <div>
        <Seal id="htmlartifact" size={56} className="mx-auto" />
        <p className="mt-5 font-wide text-[22px] font-[650] tracking-[-0.02em] text-ink">Sign in to open this</p>
        <p className="mx-auto mt-2 max-w-[34ch] text-[13.5px] text-fog">It belongs to a workspace. Sign in and you'll land right back here.</p>
        <span className="mt-5 inline-flex h-9 items-center rounded-full bg-ink px-4 text-[13px] font-medium text-paper">
          Sign in or create an account
        </span>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="grid h-full place-items-center px-6 py-10 text-center">
      <div>
        <p className="font-expanded text-[56px] font-[800] leading-none tracking-[-0.04em] text-rule-2">404</p>
        <p className="mt-4 font-wide text-[22px] font-[650] tracking-[-0.02em] text-ink">Not found</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-[13.5px] text-fog">
          This artifact does not exist, or it belongs to a workspace you are not in.
        </p>
      </div>
    </div>
  );
}
