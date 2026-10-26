import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import type { Session } from "../page";
import { ChevronDown } from "./icons";
import { SiteFooter, SiteHeader } from "./SiteHeader";

// Sections, and optionally their sub-sections (listed under them in the index).
export type Toc = ReadonlyArray<{ id: string; title: string; children?: ReadonlyArray<{ id: string; title: string }> }>;

export const H3 = "font-wide text-[17px] font-[680] leading-snug tracking-[-0.01em] text-ink";

// The reading system for /docs and /privacy: one ~68ch column, an "On this
// page" index that is a sticky sidebar on desktop and a sticky disclosure on
// smaller screens, marking the section in view once the page has hydrated.
export function ReadingPage({
  session,
  current,
  title,
  intro,
  sections,
  children
}: {
  session: Session | null;
  current?: "docs" | "privacy";
  title: string;
  intro: ReactNode;
  sections: Toc;
  children: ReactNode;
}) {
  const active = useActiveSection(sections);
  const parent = sections.find((s) => s.id === active || s.children?.some((c) => c.id === active))?.id ?? null;
  return (
    <div>
      {/* The header and the mobile index stick as one block, so the index
          sits flush under the header without guessing its height. (The
          header's own sticky is switched off inside it: nested sticky
          layers with backdrop blur break full-page screenshots.) */}
      <div className="sticky top-0 z-20 [&>header]:static">
        <SiteHeader session={session} current={current} />
        <MobileToc sections={sections} active={active} parent={parent} />
      </div>
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 sm:px-8 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-16 lg:pt-16 xl:gap-24">
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-24">
              <p className="text-[13px] font-medium text-ink">On this page</p>
              <ol className="mt-3 border-l border-rule">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={parent === s.id ? "true" : undefined}
                      className="-ml-px flex gap-3 border-l-2 border-transparent py-1.5 pl-4 text-[14px] leading-snug text-ink-2 transition-colors duration-150 hover:text-ink aria-[current=true]:border-intaglio aria-[current=true]:font-medium aria-[current=true]:text-ink"
                    >
                      <Serial n={i} />
                      {s.title}
                    </a>
                    {s.children && (
                      <ol className="mb-1 ml-[3.25rem]">
                        {s.children.map((c) => (
                          <li key={c.id}>
                            <a
                              href={`#${c.id}`}
                              aria-current={active === c.id ? "true" : undefined}
                              className="block py-1 text-[13px] leading-snug text-fog transition-colors duration-150 hover:text-ink aria-[current=true]:text-ink"
                            >
                              {c.title}
                            </a>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
          <article className="docs-prose min-w-0 max-w-[68ch]">
            <h1 className="font-wide text-page font-[740] tracking-[-0.03em] text-ink">{title}</h1>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">{intro}</p>
            {children}
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function MobileToc({ sections, active, parent }: { sections: Toc; active: string | null; parent: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close after a jump, on Escape, and on a tap outside.
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const outside = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const current = sections.find((s) => s.id === parent);
  const child = current?.children?.find((c) => c.id === active);
  return (
    <details
      ref={ref}
      className="group relative border-b border-rule bg-paper/90 backdrop-blur-md backdrop-saturate-150 lg:hidden"
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="mx-auto flex h-12 max-w-[1240px] cursor-pointer list-none items-center gap-2 px-5 text-[14px] focus-visible:outline-offset-[-3px] sm:px-8 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-medium text-ink">On this page</span>
        {current && (
          <>
            <span aria-hidden className="text-fog">
              /
            </span>
            <span className="min-w-0 truncate text-ink-2">{child ? `${current.title}: ${child.title}` : current.title}</span>
          </>
        )}
        <ChevronDown className="ml-auto size-4 shrink-0 text-fog transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <nav
        aria-label="On this page"
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-8rem)] overflow-y-auto border-b border-rule bg-paper-2 shadow-pop"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
      >
        <ol className="mx-auto max-w-[1240px] px-2 py-2 sm:px-5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={parent === s.id ? "true" : undefined}
                className="flex h-11 items-center gap-3 rounded-control px-3 text-[15px] text-ink-2 hover:bg-wash hover:text-ink aria-[current=true]:bg-wash aria-[current=true]:font-medium aria-[current=true]:text-ink"
              >
                <Serial n={i} />
                {s.title}
              </a>
              {s.children && (
                <ol className="mb-1 grid grid-cols-2 gap-x-2 pl-[2.4rem]">
                  {s.children.map((c) => (
                    <li key={c.id}>
                      <a
                        href={`#${c.id}`}
                        aria-current={active === c.id ? "true" : undefined}
                        className="flex min-h-10 items-center rounded-control px-3 text-[14px] leading-snug text-ink-2 hover:bg-wash hover:text-ink aria-[current=true]:font-medium aria-[current=true]:text-ink"
                      >
                        {c.title}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}

// The section whose top has passed just under the sticky chrome; at the very
// bottom, the last one (it may be too short to reach the top).
function useActiveSection(sections: Toc): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = sections
      .flatMap((s) => [s, ...(s.children ?? [])])
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      let id: string | null = null;
      for (const el of els) if (el.getBoundingClientRect().top <= 150) id = el.id;
      const root = document.documentElement;
      if (id && window.scrollY + window.innerHeight >= root.scrollHeight - 2) id = els[els.length - 1]!.id;
      setActive(id);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);
  return active;
}

function Serial({ n }: { n: number }) {
  return (
    <span aria-hidden className="font-mono text-[12px] font-normal tabular-nums text-fog font-condensed">
      {String(n + 1).padStart(2, "0")}
    </span>
  );
}

// A numbered section with an ink heading; the heading links to itself and
// shows a "#" on hover or focus.
export function Section({ toc, id, children }: { toc: Toc; id: string; children: ReactNode }) {
  const index = toc.findIndex((s) => s.id === id);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-12 scroll-mt-[8.5rem] border-t border-rule pt-8 lg:mt-16 lg:scroll-mt-24">
      <h2 id={`${id}-h`} className="flex items-baseline gap-3 font-wide text-[24px] font-[700] leading-tight tracking-[-0.02em] text-ink">
        <Serial n={index} />
        <a href={`#${id}`} className="group/h min-w-0 rounded-[4px]">
          {toc[index]!.title}
          <span aria-hidden className="ml-2 text-fog opacity-0 transition-opacity duration-150 group-hover/h:opacity-100 group-focus-visible/h:opacity-100">
            #
          </span>
        </a>
      </h2>
      {children}
    </section>
  );
}

// Plain facts with a lead sentence, between hairlines.
export function Facts({ children }: { children: ReactNode }) {
  return <ul className="mt-5 divide-y divide-rule border-y border-rule">{children}</ul>;
}

export function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="py-3.5">
      <strong className="font-medium text-ink">{title}</strong> {children}
    </li>
  );
}
