import { Fragment, useRef } from "react";
import { cx } from "../lib/cx";
import { CopyButton, useCopy } from "./Copy";

// A link to share, shown whole with a Copy button (under it on phones). It
// wraps between path segments rather than scrolling, so the part that tells
// two links apart (the artifact's id or slug, in the text colour) is always
// visible. One tap selects all of it; on a clipboard failure it is selected
// for you, with a note on how to finish by hand.
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const field = useRef<HTMLElement>(null);
  const [state, copy] = useCopy(url, field);
  const { origin, path } = split(url);
  return (
    <div className={className}>
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 rounded-control border border-border bg-card py-1 pl-3.5 pr-1">
        <span className="sr-only">Link to share: </span>
        <code ref={field} className="min-w-0 basis-full select-all py-1 pr-2 font-mono text-[12px] leading-[1.5] text-muted [overflow-wrap:anywhere] sm:flex-1 sm:basis-0 sm:pr-0">
          {origin}
          <span className="text-foreground">
            {path.split("/").map((part, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <>
                    <wbr />/
                  </>
                )}
                {part}
              </Fragment>
            ))}
          </span>
        </code>
        <CopyButton state={state} onCopy={copy} what="Link" label="Copy link" className="ml-auto shrink-0" />
      </div>
      <p aria-hidden className={cx("mt-1.5 text-[13px] text-deny", state !== "failed" && "hidden")}>
        Couldn't copy automatically. The link is selected: copy it from there.
      </p>
    </div>
  );
}

// "https://host/d/abc" → origin "https://host", path "/d/abc".
function split(url: string): { origin: string; path: string } {
  const at = url.indexOf("/", url.indexOf("//") + 2);
  return at < 0 ? { origin: url, path: "" } : { origin: url.slice(0, at), path: url.slice(at) };
}
