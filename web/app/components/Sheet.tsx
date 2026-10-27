import type { ElementType, ReactNode } from "react";
import { cx } from "../lib/cx";

// The ruled sheet (web/DESIGN.md): every page is one centred column between
// two hairline rails, built from full-bleed rows. `wide` is the app's width.
const column = { site: "max-w-[880px]", app: "max-w-[1040px]" } as const;
export type SheetWidth = keyof typeof column;

// One ruled row: a hairline under it from edge to edge, the rails through it.
export function Rule({
  children,
  as: Tag = "div",
  width = "site",
  className,
  inner,
  id,
  labelledBy
}: {
  children?: ReactNode;
  as?: ElementType;
  width?: SheetWidth;
  className?: string;
  inner?: string;
  id?: string;
  labelledBy?: string;
}) {
  return (
    <Tag id={id} aria-labelledby={labelledBy} className={cx("border-b border-line", className)}>
      <div className={cx("relative mx-auto border-x border-line", column[width], inner)}>{children}</div>
    </Tag>
  );
}

// The hatched gutter between sections: sealed negative space.
export function Gutter({ width = "site", className }: { width?: SheetWidth; className?: string }) {
  return (
    <div aria-hidden className={cx("hatch h-6 border-b border-line sm:h-8", className)}>
      <div className={cx("mx-auto h-full border-x border-line", column[width])} />
    </div>
  );
}

// A handwritten note in the margin, for readers with a cursor and room to
// spare. Decorative only. `side` is the margin; `className` places it.
export function MarginNote({ children, side = "left", className }: { children: ReactNode; side?: "left" | "right"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "pointer-events-none absolute hidden select-none whitespace-nowrap font-hand text-[19px] leading-none text-faint pointer-fine:xl:block",
        side === "left" ? "right-full mr-6 text-right" : "left-full ml-6",
        className
      )}
    >
      {children}
    </span>
  );
}

// The small curved arrow that goes with a margin note.
export function NoteArrow({ className, flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 40 24" className={cx("mt-1 h-5 w-9 text-faint", flip && "-scale-x-100", className)} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
      <path d="M3 4c6 12 18 16 31 12" />
      <path d="m29 11 5 5-6 3" />
    </svg>
  );
}

// A section's label: small mono, set in its own ruled row.
export function SectionLabel({ children, id, width = "site", aside }: { children: ReactNode; id?: string; width?: SheetWidth; aside?: ReactNode }) {
  return (
    <Rule width={width} inner="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <h2 id={id} className="font-mono text-[12.5px] text-muted">
        {children}
      </h2>
      {aside}
    </Rule>
  );
}
