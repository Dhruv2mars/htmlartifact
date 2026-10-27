// The first stop for keyboard users: jumps past the header to the page.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="fixed left-3 top-3 z-50 -translate-y-20 rounded-control bg-foreground px-3.5 py-2 text-[14px] font-medium text-background opacity-0 transition-[translate,opacity] duration-150 focus:translate-y-0 focus:opacity-100"
    >
      Skip to content
    </a>
  );
}
