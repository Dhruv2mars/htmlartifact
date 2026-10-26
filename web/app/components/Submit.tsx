import { useEffect, useState, type ReactNode } from "react";
import { Button, type ButtonStyle } from "./Button";

// A form's submit button that shows the form is working: it switches to its
// `pending` label and ignores further clicks until the page changes. Plain
// form posts still work before hydration. Coming back with the browser's Back
// button (bfcache) resets it.
export function Submit({ children, pending, className, ...style }: ButtonStyle & { children: ReactNode; pending: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const reset = () => setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return (
    <Button
      type="submit"
      className={className}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) return e.preventDefault();
        const form = e.currentTarget.form;
        if (form && !form.checkValidity()) return;
        // Let this click submit, then block repeats.
        setTimeout(() => setBusy(true), 0);
      }}
      {...style}
    >
      {busy ? (
        <>
          <span aria-hidden className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent motion-reduce:animate-none" />
          <span role="status">{pending}</span>
        </>
      ) : (
        children
      )}
    </Button>
  );
}
