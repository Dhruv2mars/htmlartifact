import { useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

// Copies text and reports what happened, for 1.8 s. A failure (no clipboard
// permission, insecure context) is reported too, so the caller can tell the
// person to select the text and copy it themselves.
export function useCopy(text: string): [CopyState, () => Promise<void>] {
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
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1800 : 4000);
  }
  return [state, copy];
}
