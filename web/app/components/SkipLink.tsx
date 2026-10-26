// The first stop for keyboard users: jumps past the header to the page.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="fixed left-3 top-3 z-50 -translate-y-16 rounded-control bg-ink px-4 py-2.5 text-[14px] font-medium text-paper shadow-pop transition-transform duration-150 focus:translate-y-0"
    >
      Skip to content
    </a>
  );
}
