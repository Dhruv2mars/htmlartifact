import { useEffect, useRef } from "react";
import { useCopy } from "./Copy";
import { CheckIcon, CopyIcon } from "./icons";

// A link to share, shown in a read-only field with a Copy button. If the
// clipboard refuses, the field is focused with the whole link selected, and
// says how to finish by hand.
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const [state, copy] = useCopy(url);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state !== "failed" || !field.current) return;
    field.current.focus();
    field.current.select();
  }, [state]);
  return (
    <div className={className}>
      <div className="flex h-10 min-w-0 items-center gap-1 rounded-control border border-rule-2 bg-paper-2 pl-3.5 pr-1">
        <label className="sr-only" htmlFor="share-link">
          Link to share
        </label>
        <input
          ref={field}
          id="share-link"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-fog outline-none focus:text-ink"
        />
        <button
          type="button"
          onClick={copy}
          className="press inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-wash hover:text-ink"
        >
          {state === "copied" ? <CheckIcon className="size-3.5 text-pass" /> : <CopyIcon className="size-3.5" />}
          {state === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
      <p role="status" className="mt-1.5 text-[13px] text-deny empty:hidden">
        {state === "failed" ? "Couldn't copy automatically. The link is selected in the field: copy it from there." : ""}
      </p>
    </div>
  );
}
