import { useRef } from "react";
import { cx } from "../lib/cx";
import { CopyButton, useCopy } from "./Copy";

// A shell command with a Copy button, set like a form field. The command
// wraps at spaces rather than hiding the part that matters. `oneLine` (a
// short command with room around it, like the hero's) keeps it on one line
// from 640px up, and the field never shrinks below it.
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
        "flex max-w-full items-center rounded-control border font-mono",
        oneLine && "sm:shrink-0",
        ink ? "border-white/15 bg-white/[0.06] text-term-ink" : "border-rule-2 bg-paper-2 text-ink",
        size === "lg" ? "min-h-14 py-1.5 pl-5 pr-1.5 text-[14.5px] sm:text-[15.5px]" : "min-h-11 py-1 pl-4 pr-1 text-[13px]",
        className
      )}
    >
      <span className={cx("flex min-w-0 flex-1 items-baseline gap-2.5 leading-snug", oneLine && "sm:whitespace-nowrap", size === "lg" ? "py-2" : "py-1.5")}>
        <span aria-hidden className={cx("select-none", ink ? "text-term-fog" : "text-fog")}>
          $
        </span>
        <span ref={text} className="min-w-0">
          {command}
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
        className="ml-3"
      />
    </div>
  );
}
