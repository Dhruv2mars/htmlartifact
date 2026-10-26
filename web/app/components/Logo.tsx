import { useId } from "react";
import { makeSeal } from "../lib/seal";

// The house mark: the htmlartifact seal's rosette, knocked out of a solid
// intaglio disc so it stays crisp at 24px (a full guilloche turns to mush).
const MARK = makeSeal("htmlartifact", 24).layers[1]!.paths[0]!;

export function Mark({ className }: { className?: string }) {
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <circle cx="50" cy="50" r="50" fill="var(--intaglio)" />
      <defs>
        <path id={id} d={MARK.d} />
      </defs>
      <g fill="none" stroke="var(--intaglio-ink)" strokeWidth="3.2" strokeOpacity="0.95">
        {Array.from({ length: 3 }, (_, k) => (
          <use key={k} href={`#${id}`} transform={k ? `rotate(${(k * MARK.step * (MARK.copies / 3)).toFixed(3)} 50 50)` : undefined} />
        ))}
      </g>
      <circle cx="50" cy="50" r="5" fill="var(--intaglio-ink)" />
    </svg>
  );
}

// The wordmark with the house mark.
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="group inline-flex shrink-0 items-center gap-2.5 rounded-md text-ink" aria-label="htmlartifact home">
      <Mark className="size-[26px] transition-[rotate] duration-500 ease-out group-hover:rotate-[60deg] motion-reduce:transition-none" />
      <span className="font-wide text-[17px] font-[680] tracking-[-0.025em]">htmlartifact</span>
    </a>
  );
}
