import { cx } from "../lib/cx";

// A terminal transcript. Lines appear on a CSS timeline (no JS), so the page
// plays the same with or without hydration; `--d` is each line's delay.
export type TermLine =
  | { kind: "agent"; text: string }
  | { kind: "cmd"; text: string; type?: boolean }
  | { kind: "out"; text: string; tone?: "pass" | "dim" | "plain" }
  | { kind: "gap" };

export function Terminal({
  lines,
  title,
  start = 0,
  animate = true,
  className
}: {
  lines: TermLine[];
  title?: string;
  start?: number;
  animate?: boolean;
  className?: string;
}) {
  let t = start;
  const timed = lines.map((line) => {
    const d = t;
    if (line.kind === "cmd" && line.type) t += 120 + line.text.length * 22 + 160;
    else if (line.kind === "agent") t += 320;
    else if (line.kind === "out") t += 70;
    return { line, d };
  });
  return (
    <div
      className={cx(
        "term relative overflow-hidden rounded-2xl bg-[#0f1630] font-mono text-[12.5px] leading-[1.75] text-[#d6dbec] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_30px_60px_-30px_rgba(18,26,51,0.45)] ring-1 ring-black/5 dark:bg-[#0a0f20] dark:ring-white/8",
        animate && "term-animate",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5 text-[11px] text-white/40">
        <span className="flex gap-1.5" aria-hidden>
          <i className="size-2.5 rounded-full bg-white/12" />
          <i className="size-2.5 rounded-full bg-white/12" />
          <i className="size-2.5 rounded-full bg-white/12" />
        </span>
        {title && <span className="ml-2 truncate">{title}</span>}
      </div>
      <div className="overflow-x-auto px-4 py-4 sm:px-5">
        {timed.map(({ line, d }, i) => {
          const style = { "--d": `${d}ms` } as React.CSSProperties;
          if (line.kind === "gap") return <div key={i} className="h-3" />;
          if (line.kind === "agent")
            return (
              <p key={i} className="term-line mb-2 flex gap-3 whitespace-pre-wrap font-sans text-[13.5px] leading-snug text-[#e7eaf4]" style={style}>
                <span aria-hidden className="mt-px shrink-0 font-mono text-[11px] text-white/55">⏺</span>
                <span>{line.text}</span>
              </p>
            );
          if (line.kind === "cmd")
            return (
              <p key={i} className="term-line whitespace-nowrap text-white" style={style}>
                <span className="select-none text-[#8c9bff]">$ </span>
                {line.type ? (
                  <span className="term-type" style={{ "--n": line.text.length, ...style } as React.CSSProperties}>
                    {line.text}
                  </span>
                ) : (
                  line.text
                )}
              </p>
            );
          return (
            <p
              key={i}
              className={cx(
                "term-line whitespace-pre",
                line.tone === "pass" ? "text-[#4fd1a1]" : line.tone === "dim" ? "text-white/45" : "text-[#d6dbec]"
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
