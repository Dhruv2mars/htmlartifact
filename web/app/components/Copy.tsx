import { useEffect, useRef, useState, type RefObject } from "react";
import { cx } from "../lib/cx";
import { AlertIcon, CheckIcon, CopyIcon } from "./icons";

export type CopyState = "idle" | "copied" | "failed";

// One copy contract for every Copy button: the button keeps its size in
// every state, says Copied or Not copied, and a polite status announces the
// result. When the clipboard refuses (no permission, insecure context), the
// text is selected so it can be copied by hand.
export function useCopy(text: string, fallback?: RefObject<HTMLElement | null>): [CopyState, () => Promise<void>] {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "failed");
    if (!ok && fallback?.current) select(fallback.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1800 : 6000);
  }
  return [state, copy];
}

function select(el: HTMLElement) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(el);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

// `what` names the thing in announcements ("Command copied"). `compact` is
// an icon button whose result floats above it as a small label, so the
// field around it never reflows.
export function CopyButton({
  state,
  onCopy,
  what,
  label = "Copy",
  accessibleLabel,
  compact = false,
  feedback = "above",
  tone = "paper",
  size = "md",
  className
}: {
  state: CopyState;
  onCopy: () => void;
  what: string;
  label?: string;
  accessibleLabel?: string;
  compact?: boolean;
  // Where a compact button's result label floats: above it, or to its left
  // (inside a clipped card, where there is no room above).
  feedback?: "above" | "left";
  tone?: "paper" | "ink" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  const Icon = state === "copied" ? CheckIcon : state === "failed" ? AlertIcon : CopyIcon;
  const text = state === "copied" ? "Copied" : state === "failed" ? "Not copied" : label;
  return (
    <span className={cx("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        onClick={onCopy}
        aria-label={accessibleLabel}
        className={cx(
          "press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[6px] font-sans font-medium whitespace-nowrap",
          size === "lg" ? "h-10 text-[13.5px]" : "h-8 text-[12.5px]",
          // Wide enough for the longest state, so nothing around it moves.
          compact ? (size === "lg" ? "w-10" : "w-8") : size === "lg" ? "min-w-[7.25rem] px-3" : "min-w-[6.5rem] px-2.5",
          tone === "ink"
            ? "text-term-fog hover:bg-white/10 hover:text-term-ink"
            : tone === "ghost"
              ? "text-muted hover:bg-surface hover:text-foreground"
              : "text-muted hover:bg-surface hover:text-foreground"
        )}
      >
        <Icon className={cx(compact ? "size-[15px]" : "size-3.5", state === "copied" && "text-open", state === "failed" && "text-deny")} />
        <span className={cx(compact && "sr-only")}>{text}</span>
      </button>
      {compact && (
        <span
          aria-hidden
          className={cx(
            "pointer-events-none absolute z-10 whitespace-nowrap rounded-[6px] bg-foreground px-2 py-1 font-sans text-[12px] font-medium text-background transition-[opacity,translate] duration-150 ease-out",
            feedback === "left" ? "right-full top-1/2 mr-2 -translate-y-1/2" : "bottom-full right-0 mb-2",
            state === "idle"
              ? feedback === "left"
                ? "translate-x-1 opacity-0"
                : "translate-y-1 opacity-0"
              : feedback === "left"
                ? "translate-x-0 opacity-100"
                : "translate-y-0 opacity-100"
          )}
        >
          {state === "failed" ? "Not copied" : "Copied"}
        </span>
      )}
      <span className="sr-only" role="status">
        {state === "copied" ? `${what} copied` : state === "failed" ? `Couldn't copy the ${what.toLowerCase()} automatically. It is selected: copy it from there.` : ""}
      </span>
    </span>
  );
}
