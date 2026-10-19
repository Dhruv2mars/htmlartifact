import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { CheckIcon, CopyIcon } from "./icons";

// A small "Copy" button for a block of text.
export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
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
      className="press inline-flex h-7 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-full px-2.5 text-[12px] text-fog hover:bg-wash hover:text-ink"
    >
      <span className="grid size-3.5 place-items-center" aria-hidden>
        <CopyIcon className={cx("col-start-1 row-start-1 size-3.5 transition-[opacity,filter,scale] duration-200 ease-out", copied && "scale-75 opacity-0 blur-[2px]")} />
        <CheckIcon className={cx("col-start-1 row-start-1 size-3.5 text-pass transition-[opacity,filter,scale] duration-200 ease-out", !copied && "scale-75 opacity-0 blur-[2px]")} />
      </span>
      <span role="status">{copied ? "Copied" : label}</span>
    </button>
  );
}
