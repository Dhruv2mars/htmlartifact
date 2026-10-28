import { useState } from "react";
import { cx } from "../lib/cx";
import type { Notice as NoticeData } from "../page";
import { AlertIcon, CheckIcon, CloseIcon } from "./icons";
import { Rule } from "./Sheet";

// What the last change did, or that a workspace is gone: one ruled row under
// the header, said once (the server sends it with this page only). Read out
// politely; it stays until dismissed or the next page.
export function Notice({ notice }: { notice: NoticeData }) {
  const [open, setOpen] = useState(true);
  const problem = notice.tone === "problem";
  return (
    <div role="status">
      {open && (
        <Rule width="app" className="notice" inner={cx("flex items-start gap-3 py-3 pl-4 pr-2 sm:pl-5", problem ? "bg-deny-wash" : "bg-surface/70")}>
          {problem ? <AlertIcon className="mt-0.5 size-4 shrink-0 text-deny" /> : <CheckIcon className="mt-0.5 size-4 shrink-0 text-foreground" />}
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{notice.text}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="press -my-1 grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-surface hover:text-foreground"
          >
            <CloseIcon className="size-3.5" />
            <span className="sr-only">Dismiss</span>
          </button>
        </Rule>
      )}
    </div>
  );
}
