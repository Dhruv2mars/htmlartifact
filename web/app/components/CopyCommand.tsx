import { useEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { useCopy } from "./Copy";
import { CheckIcon, CopyIcon } from "./icons";

// A shell command with a Copy button, set like a form field. The whole field
// copies; the button says what happened. If the clipboard refuses, the
// command is selected so ⌘C / Ctrl+C works.
export function CopyCommand({
  command,
  className,
  size = "md",
  tone = "paper"
}: {
  command: string;
  className?: string;
  size?: "md" | "lg";
  tone?: "paper" | "ink";
}) {
  const [state, copy] = useCopy(command);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (state !== "failed" || !text.current) return;
    const range = document.createRange();
    range.selectNodeContents(text.current);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [state]);
  const ink = tone === "ink";
  return (
    <div
      className={cx(
        "flex max-w-full items-center rounded-control border font-mono",
        ink ? "border-white/15 bg-white/[0.06] text-term-ink" : "border-rule-2 bg-paper-2 text-ink",
        size === "lg" ? "h-14 pl-5 pr-1.5 text-[14.5px] sm:text-[15.5px]" : "h-11 pl-4 pr-1 text-[13px]",
        className
      )}
    >
      <span aria-hidden className={cx("mr-2.5 select-none", ink ? "text-term-fog" : "text-fog")}>
        $
      </span>
      <span ref={text} className="min-w-0 flex-1 truncate">
        {command}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy command: ${command}`}
        className={cx(
          "press ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-[7px] font-sans font-medium",
          size === "lg" ? "h-10 px-3.5 text-[13.5px]" : "h-8 px-2.5 text-[12.5px]",
          ink ? "bg-white/10 text-term-ink hover:bg-white/16" : "bg-paper-3 text-ink-2 hover:bg-wash hover:text-ink"
        )}
      >
        {state === "copied" ? <CheckIcon className="size-3.5 text-pass" /> : <CopyIcon className="size-3.5" />}
        <span aria-live="polite" className={cx(state === "idle" && size === "lg" && "max-sm:sr-only")}>
          {state === "copied" ? "Copied" : state === "failed" ? "Press ⌘C" : "Copy"}
        </span>
      </button>
    </div>
  );
}
