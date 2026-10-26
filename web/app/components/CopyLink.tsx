import { useRef } from "react";
import { cx } from "../lib/cx";
import { CopyButton, useCopy } from "./Copy";

// A link to share, in a read-only field with a Copy button. On a clipboard
// failure the field is focused with the whole link selected, and says how to
// finish by hand.
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const field = useRef<HTMLInputElement>(null);
  const [state, copy] = useCopy(url, field);
  return (
    <div className={className}>
      <div className="flex h-10 min-w-0 items-center gap-1 rounded-control border border-rule-2 bg-paper-2 pl-3.5 pr-1 transition-[border-color,box-shadow] duration-150 focus-within:border-intaglio focus-within:shadow-[0_0_0_3px_var(--wash)]">
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
        <CopyButton state={state} onCopy={copy} what="Link" label="Copy link" tone="ghost" />
      </div>
      <p aria-hidden className={cx("mt-1.5 text-[13px] text-deny", state !== "failed" && "hidden")}>
        Couldn't copy automatically. The link is selected in the field: copy it from there.
      </p>
    </div>
  );
}
