import { cx } from "../lib/cx";

// A terminal transcript. Lines wrap instead of scrolling sideways, and every
// line is in the HTML from the first paint; with motion allowed they settle
// in quickly, one after another (CSS only, `--d` is each line's delay).
export type TermLine =
  | { kind: "agent"; text: string }
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string; tone?: "pass" | "dim" | "plain" }
  | { kind: "gap" };

export function Terminal({
  lines,
  title,
  start = 0,
  animate = true,
  wrap = true,
  className
}: {
  lines: TermLine[];
  title?: string;
  start?: number;
  animate?: boolean;
  // Output that must keep its lines (JSON) scrolls inside the window instead.
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-card bg-term font-mono text-[12px] leading-[1.7] sm:text-[12.5px] text-term-ink shadow-sheet ring-1 ring-white/10",
        animate && "term-animate",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-[12px] text-term-fog">
        <span className="flex gap-1.5" aria-hidden>
          <i className="size-2.5 rounded-full bg-white/15" />
          <i className="size-2.5 rounded-full bg-white/15" />
          <i className="size-2.5 rounded-full bg-white/15" />
        </span>
        {title && <span className="ml-2 truncate">{title}</span>}
      </div>
      <div className={cx("px-4 py-3.5 sm:px-5", !wrap && "overflow-x-auto [&_p]:whitespace-pre! [&_p]:[overflow-wrap:normal]!")}>
        {lines.map((line, i) => {
          const style = { "--d": `${start + i * 45}ms` } as React.CSSProperties;
          if (line.kind === "gap") return <div key={i} className="h-2.5" />;
          if (line.kind === "agent")
            return (
              <p key={i} className="term-line my-1 flex gap-2.5 font-sans text-[13.5px] leading-snug text-term-ink" style={style}>
                <span aria-hidden className="mt-[5px] size-1.5 shrink-0 rounded-full bg-term-fog" />
                <span>{line.text}</span>
              </p>
            );
          if (line.kind === "cmd")
            return (
              <p key={i} className="term-line whitespace-pre-wrap break-words text-white" style={style}>
                <span aria-hidden className="select-none text-[#93a2ff]">
                  ${" "}
                </span>
                {line.text}
              </p>
            );
          return (
            <p
              key={i}
              className={cx(
                "term-line whitespace-pre-wrap [overflow-wrap:anywhere]",
                line.tone === "pass" ? "text-[#4fd1a1]" : line.tone === "dim" ? "text-term-fog" : "text-term-ink"
              )}
              style={style}
            >
              {line.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}
