import { cx } from "../lib/cx";
import { useCopy } from "./Copy";
import { CheckIcon, CopyIcon } from "./icons";

// A small "Copy" button for a block of text or a link. It says "Copied", or
// "Couldn't copy" when the clipboard refuses (select the text instead).
export function CopyText({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [state, copy] = useCopy(text);
  return (
    <button
      type="button"
      onClick={copy}
      className={cx(
        "press inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-wash hover:text-ink",
        className
      )}
    >
      {state === "copied" ? <CheckIcon className="size-3.5 text-pass" /> : <CopyIcon className="size-3.5" />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}</span>
    </button>
  );
}
