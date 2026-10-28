import { useId } from "react";
import { makeSeal } from "../lib/seal";

// The house mark: the htmlartifact seal's rosette, knocked out of a solid
// disc in the text colour, so it stays crisp at 20px and flips with the theme.
const MARK = makeSeal("htmlartifact", 24).layers[1]!.paths[0]!;

export function Mark({ className }: { className?: string }) {
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <circle cx="50" cy="50" r="50" fill="var(--foreground)" />
      <defs>
        <path id={id} d={MARK.d} />
      </defs>
      <g fill="none" stroke="var(--background)" strokeWidth="3.4">
        {Array.from({ length: 3 }, (_, k) => (
          <use key={k} href={`#${id}`} transform={k ? `rotate(${(k * MARK.step * (MARK.copies / 3)).toFixed(3)} 50 50)` : undefined} />
        ))}
      </g>
      <circle cx="50" cy="50" r="6" fill="var(--background)" />
    </svg>
  );
}

// The wordmark with the house mark.
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <a href={href} className="group inline-flex shrink-0 items-center gap-2 rounded-md text-foreground" aria-label="htmlartifact home">
      <Mark className="size-5 transition-[rotate] duration-500 ease-[var(--ease-out)] group-hover:rotate-90 motion-reduce:transition-none" />
      <span className="text-[15px] font-medium tracking-[-0.02em]">htmlartifact</span>
    </a>
  );
}
