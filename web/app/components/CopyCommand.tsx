import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { CheckIcon, CopyIcon } from "./icons";

// A shell command you can copy in one click. The icon morphs to a check
// (blurred crossfade) and the status is announced.
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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        "press group inline-flex max-w-full items-center gap-3 rounded-full border text-left font-mono",
        tone === "paper" ? "border-rule-2 bg-paper-2 text-ink hover:border-fog/60" : "border-white/15 bg-white/5 text-[#e7eaf4] hover:border-white/30",
        size === "lg" ? "h-14 pl-6 pr-5 text-[15px] sm:text-base" : "h-10 pl-4 pr-3 text-[13px]",
        className
      )}
    >
      <span className="sr-only">Copy command: </span>
      <span aria-hidden className={tone === "paper" ? "text-fog" : "text-white/40"}>$</span>
      <span className="min-w-0 truncate">{command}</span>
      <span className="relative ml-1 grid size-4 shrink-0 place-items-center" aria-hidden>
        <CopyIcon className={cx("col-start-1 row-start-1 transition-[opacity,filter,scale] duration-200 ease-out", copied ? "scale-75 opacity-0 blur-[2px]" : "opacity-60 group-hover:opacity-100")} />
        <CheckIcon className={cx("col-start-1 row-start-1 transition-[opacity,filter,scale] duration-200 ease-out", copied ? "text-pass opacity-100" : "scale-75 opacity-0 blur-[2px]")} />
      </span>
      <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
    </button>
  );
}
