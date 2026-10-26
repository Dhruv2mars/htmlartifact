import type { RefObject } from "react";
import { CopyButton, useCopy } from "./Copy";

// A small Copy button for a block of text or code. `target` is the element
// showing the text: on a clipboard failure it is selected for copying by hand.
export function CopyText({ text, what = "Text", target, className }: { text: string; what?: string; target?: RefObject<HTMLElement | null>; className?: string }) {
  const [state, copy] = useCopy(text, target);
  return <CopyButton state={state} onCopy={copy} what={what} tone="ghost" className={className} />;
}
