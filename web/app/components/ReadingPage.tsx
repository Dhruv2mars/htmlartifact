import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import type { Session } from "../page";
import { ChevronDown } from "./icons";
import { Rule } from "./Sheet";
import { SiteFooter, SiteHeader } from "./SiteHeader";

// Sections, and optionally their sub-sections (listed under them in the index).
export type Toc = ReadonlyArray<{ id: string; title: string; children?: ReadonlyArray<{ id: string; title: string }> }>;

export const H3 = " text-[17px] font-medium leading-snug tracking-[-0.01em] text-foreground";

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
      <div data-sticky="reading" className="sticky top-0 z-30 bg-background/80 backdrop-blur-md backdrop-saturate-150 [&>header]:static [&>header]:bg-transparent [&>header]:backdrop-blur-none">
        <SiteHeader session={session} current={current} width="app" />
        <MobileToc sections={sections} active={active} parent={parent} />
      </div>
      <main id="main" tabIndex={-1} className="outline-none">
        <Rule width="app" inner="px-4 pb-10 pt-12 sm:px-6 sm:pt-16 lg:pl-[calc(14rem+2.5rem)]">
          <h1 className="text-page font-medium tracking-[-0.035em] text-foreground">{title}</h1>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted sm:text-[17px]">{intro}</p>
        </Rule>
        <div className="mx-auto max-w-[1040px] border-x border-line lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-line lg:block">
            <nav aria-label="On this page" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto px-5 py-8">
              <p className="font-mono text-[12.5px] text-muted">On this page</p>
              <ol className="mt-3 border-l border-line">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={parent === s.id ? "true" : undefined}
                      className="-ml-px flex gap-3 border-l border-transparent py-1.5 pl-3.5 text-[13.5px] leading-snug text-muted transition-colors duration-150 hover:text-foreground aria-[current=true]:border-foreground aria-[current=true]:text-foreground"
                    >
                      <Serial n={i} />
                      {s.title}
                    </a>
                    {s.children && (
                      <ol className="mb-1 ml-[2.9rem]">
                        {s.children.map((c) => (
                          <li key={c.id}>
                            <a
                              href={`#${c.id}`}
                              aria-current={active === c.id ? "true" : undefined}
                              className="block py-1 text-[13px] leading-snug text-muted transition-colors duration-150 hover:text-foreground aria-[current=true]:text-foreground"
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
          <article className="docs-prose min-w-0 max-w-[72ch] px-4 pb-20 pt-2 sm:px-6 lg:px-10">{children}</article>
        </div>
      </main>
      <div className="border-t border-line">
        <SiteFooter width="app" />
      </div>
    </div>
  );
}

function MobileToc({ sections, active, parent }: { sections: Toc; active: string | null; parent: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close after a jump, on Escape (wherever focus is), on a tap outside, and
  // when focus moves out of it, so it never covers what has focus.
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const outside = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !details.open) return;
      const inside = details.contains(document.activeElement);
      details.open = false;
      if (inside) details.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const current = sections.find((s) => s.id === parent);
  const child = current?.children?.find((c) => c.id === active);
  return (
    <details
      ref={ref}
      className="group relative border-b border-line lg:hidden"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false;
      }}
    >
      <summary className="mx-auto flex h-11 max-w-[1040px] cursor-pointer list-none items-center gap-2 border-x border-line px-4 text-[13.5px] focus-visible:outline-offset-[-3px] sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-mono text-[12.5px] text-muted">On this page</span>
        {current && (
          <>
            <span aria-hidden className="text-faint">
              /
            </span>
            <span className="min-w-0 truncate text-foreground">{child ? `${current.title}: ${child.title}` : current.title}</span>
          </>
        )}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <nav
        aria-label="On this page"
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-8rem)] overflow-y-auto border-b border-line bg-background"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
      >
        <ol className="mx-auto max-w-[1040px] border-x border-line px-2 py-2 sm:px-4">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={parent === s.id ? "true" : undefined}
                className="flex h-11 items-center gap-3 rounded-control px-3 text-[15px] text-muted hover:bg-surface hover:text-foreground aria-[current=true]:bg-surface aria-[current=true]:font-medium aria-[current=true]:text-foreground"
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
                        className="flex min-h-10 items-center rounded-control px-3 text-[14px] leading-snug text-muted hover:bg-surface hover:text-foreground aria-[current=true]:font-medium aria-[current=true]:text-foreground"
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
    <span aria-hidden className="font-mono text-[12px] font-normal tabular-nums text-faint">
      {String(n + 1).padStart(2, "0")}
    </span>
  );
}

// A numbered section with an ink heading; the heading links to itself and
// shows a "#" on hover or focus.
export function Section({ toc, id, children }: { toc: Toc; id: string; children: ReactNode }) {
  const index = toc.findIndex((s) => s.id === id);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-t border-line pt-8 first:border-t-0 [&:not(:first-child)]:mt-12">
      <h2 id={`${id}-h`} className="flex items-baseline gap-3 text-[22px] font-medium leading-tight tracking-[-0.025em] text-foreground">
        <Serial n={index} />
        <a href={`#${id}`} className="group/h min-w-0 rounded-[4px]">
          {toc[index]!.title}
          <span aria-hidden className="ml-2 text-faint opacity-0 transition-opacity duration-150 group-hover/h:opacity-100 group-focus-visible/h:opacity-100">
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
  return <ul className="mt-5 divide-y divide-line border-y border-line">{children}</ul>;
}

export function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="py-3.5">
      <strong className="font-medium text-foreground">{title}</strong> {children}
    </li>
  );
}
