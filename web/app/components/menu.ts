// The one look for every menu (account, workspace, a person's actions): a
// raised cell that grows from its trigger, rows that light up as you move.
export const menuPopup =
  "max-h-[var(--available-height)] origin-[var(--transform-origin)] overflow-y-auto rounded-card bg-card p-1 shadow-pop outline-none forced-colors:border forced-colors:border-[CanvasText] transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";

export const menuItem =
  "flex min-h-8 cursor-default select-none items-center rounded-[6px] px-2.5 py-1.5 text-[14px] leading-snug text-muted outline-none data-highlighted:bg-surface data-highlighted:text-foreground forced-colors:data-highlighted:outline-2 forced-colors:data-highlighted:outline-solid forced-colors:data-highlighted:-outline-offset-2 forced-colors:data-highlighted:outline-[Highlight]";
