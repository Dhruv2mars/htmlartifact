import { useRef } from "react";
import { cx } from "../lib/cx";
import { CopyButton, useCopy } from "./Copy";

// A shell command in a field, with a Copy control. The command breaks only
// between words (never inside a flag or an invite code), so nothing that
// matters is hidden. `oneLine` keeps a short command on one line from 640px.
export function CopyCommand({
  command,
  className,
  size = "md",
  tone = "paper",
  oneLine = false
}: {
  command: string;
  className?: string;
  size?: "md" | "lg";
  tone?: "paper" | "ink";
  oneLine?: boolean;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const [state, copy] = useCopy(command, text);
  const ink = tone === "ink";
  return (
    <div
      className={cx(
        "flex max-w-full items-center gap-3 rounded-control border font-mono",
        ink ? "border-white/12 bg-white/[0.04] text-term-ink" : "border-border bg-card text-foreground",
        size === "lg" ? "min-h-12 py-1 pl-4 pr-1.5 text-[14px]" : "min-h-10 py-0.5 pl-3.5 pr-1 text-[13px]",
        oneLine && "sm:shrink-0",
        className
      )}
    >
      <span className={cx("flex min-w-0 flex-1 items-baseline gap-2.5 leading-snug", oneLine && "sm:whitespace-nowrap", "py-1.5")}>
        <span aria-hidden className={cx("select-none", ink ? "text-term-fog" : "text-faint")}>
          $
        </span>
        <span ref={text} className="min-w-0">
          <Words text={command} />
        </span>
      </span>
      <CopyButton
        state={state}
        onCopy={copy}
        what="Command"
        accessibleLabel={`Copy command: ${command}`}
        compact
        size={size}
        tone={ink ? "ink" : "paper"}
      />
    </div>
  );
}

// Words that wrap only at their spaces; one longer than the line still breaks.
export function Words({ text }: { text: string }) {
  return text.split(/(\s+)/).map((part, i) =>
    i % 2 ? part : part ? <span key={i} className="inline-block max-w-full [overflow-wrap:anywhere]">{part}</span> : null
  );
}
