import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Command } from "cmdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import type { ArtifactSummary, Session } from "../page";
import { ChevronDown, ChevronUpDown, CloseIcon, SearchIcon } from "./icons";
import { Logo } from "./Logo";
import { Seal } from "./Seal";
import { REPO_URL } from "./SiteHeader";
import { SkipLink } from "./SkipLink";
import { ThemeToggle } from "./ThemeToggle";

type Section = "feed" | "mine" | "workspaces" | null;

// Signed-in pages: the workspace you're in, its two views (everything, and
// yours), search, and the account menu. Pages render inside <main id="main">.
export function AppShell({
  session,
  section,
  artifacts,
  children
}: {
  session: Session;
  section: Section;
  // The list this page shows; search covers exactly these. Pages without a
  // list leave it undefined and search hands the query to the feed's filter.
  artifacts?: ArtifactSummary[];
  children: ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tab = (href: string, key: Section, label: string) => (
    <a
      href={href}
      aria-current={section === key ? "page" : undefined}
      className="relative flex h-full shrink-0 items-center whitespace-nowrap px-1 text-[14px] text-fog transition-colors duration-150 hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink after:absolute after:inset-x-1 after:-bottom-px after:h-[2px] after:rounded-full after:bg-transparent aria-[current=page]:after:bg-ink"
    >
      {label}
    </a>
  );
  const workspace = session.workspace;
  const tabs = workspace ? (
    <>
      {tab("/", "feed", "All artifacts")}
      {tab("/mine", "mine", "Mine")}
    </>
  ) : (
    tab("/workspaces", "workspaces", "Workspaces")
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="vt-header sticky top-0 z-20 border-b border-rule bg-paper/90 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:px-6">
          <Logo />
          {workspace && (
            <div className="hidden min-w-0 md:block">
              <WorkspacePill name={workspace.name} id={workspace.id} current={section === "workspaces"} />
            </div>
          )}
          <nav aria-label="Workspace" className="ml-3 hidden h-full items-stretch gap-5 md:flex">
            {tabs}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {workspace && (
              <>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  className="press hidden h-9 w-56 items-center gap-2 rounded-control border border-rule bg-paper-2 pl-3 pr-1.5 text-[13.5px] text-fog hover:border-rule-2 hover:text-ink lg:flex"
                >
                  <SearchIcon className="size-3.5" />
                  Search artifacts
                  <kbd className="ml-auto rounded-[5px] border border-rule bg-paper px-1.5 py-px font-sans text-[12px] text-fog">⌘K</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Search artifacts"
                  className="press grid size-9 place-items-center rounded-control text-fog hover:bg-wash hover:text-ink lg:hidden"
                >
                  <SearchIcon className="size-4" />
                </button>
              </>
            )}
            <ThemeToggle />
            <AccountMenu session={session} />
          </div>
        </div>
        <div className="mx-auto flex h-11 max-w-[1120px] items-stretch gap-4 px-4 sm:px-6 md:hidden">
          {workspace && (
            <div className="flex min-w-0 flex-1 items-center">
              <WorkspacePill name={workspace.name} id={workspace.id} current={section === "workspaces"} compact />
            </div>
          )}
          <nav aria-label="Workspace" className="flex shrink-0 items-stretch gap-4">
            {tabs}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} artifacts={artifacts} session={session} section={section} />
    </div>
  );
}

// The workspace you're in; opens the list to switch, create or join.
// `compact` (the phone row): no divider and no seal, so the name gets the room.
function WorkspacePill({ name, id, current, compact = false }: { name: string; id: string; current: boolean; compact?: boolean }) {
  return (
    <a
      href="/workspaces"
      aria-current={current ? "page" : undefined}
      title="Switch workspace"
      className="press group -ml-1.5 flex h-8 min-w-0 max-w-full items-center gap-2 rounded-control px-1.5 text-[14px] font-medium text-ink hover:bg-wash aria-[current=page]:bg-wash md:max-w-[16rem]"
    >
      {!compact && <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-rule-2" />}
      {!compact && <Seal id={id} size={18} />}
      <span className="truncate">{name}</span>
      <span className="sr-only">: switch workspace</span>
      <ChevronUpDown className="size-3.5 shrink-0 text-fog group-hover:text-ink" />
    </a>
  );
}

function AccountMenu({ session }: { session: Session }) {
  const signOut = useRef<HTMLFormElement>(null);
  const initial = (session.name || session.email || "?").trim().charAt(0).toUpperCase();
  const item =
    "flex h-9 cursor-default select-none items-center rounded-[8px] px-3 text-[14px] text-ink-2 outline-none data-highlighted:bg-wash data-highlighted:text-ink";
  return (
    <>
      <form ref={signOut} method="post" action="/auth/sign-out" hidden />
      <Menu.Root>
        <Menu.Trigger
          className="press flex h-9 items-center gap-1 rounded-control pl-1 pr-1.5 text-fog hover:bg-wash hover:text-ink data-popup-open:bg-wash"
          aria-label={`Account: ${session.name}`}
        >
          <span className="grid size-7 place-items-center rounded-full bg-ink text-[12px] font-semibold text-paper">{initial}</span>
          <ChevronDown className="size-3.5" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-40 outline-none">
            <Menu.Popup className="w-64 origin-[var(--transform-origin)] rounded-card border border-rule bg-paper-2 p-1.5 shadow-pop outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
              <div className="px-3 pb-2.5 pt-2">
                <p className="truncate text-[14px] font-medium text-ink">{session.name}</p>
                {session.email && <p className="truncate text-[13px] text-fog">{session.email}</p>}
              </div>
              <Menu.Separator className="mx-1.5 my-1 h-px bg-rule" />
              <Menu.LinkItem href="/workspaces" className={item}>
                Workspaces
              </Menu.LinkItem>
              <Menu.LinkItem href="/docs" className={item}>
                Docs
              </Menu.LinkItem>
              <Menu.LinkItem href={REPO_URL} className={item}>
                GitHub
              </Menu.LinkItem>
              <Menu.Separator className="mx-1.5 my-1 h-px bg-rule" />
              <Menu.Item className={item} onClick={() => signOut.current?.requestSubmit()}>
                Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}

// ⌘K: jump to an artifact or a page. Opened by keyboard, many times a day,
// so it appears instantly (no animation). It searches the list on screen;
// elsewhere it offers to search the workspace's artifacts on the feed.
function Palette({
  open,
  onOpenChange,
  artifacts,
  session,
  section
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: ArtifactSummary[] | undefined;
  session: Session;
  section: Section;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const go = (href: string) => {
    onOpenChange(false);
    window.location.assign(href);
  };
  const workspace = session.workspace;
  const scope = artifacts
    ? section === "mine"
      ? `your ${artifacts.length} artifacts on this page`
      : `the ${artifacts.length} artifacts on this page`
    : workspace
      ? `${workspace.name}'s artifacts`
      : null;
  const item =
    "flex h-11 cursor-default select-none items-center gap-3 rounded-[9px] px-3 text-[14px] text-ink-2 data-[selected=true]:bg-wash data-[selected=true]:text-ink";
  const heading =
    "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[12.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fog";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[#060a16]/40" />
        <Dialog.Popup className="fixed left-1/2 top-[max(12px,10vh)] z-50 w-[min(580px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-card border border-rule bg-paper-2 shadow-pop outline-none">
          <Dialog.Title className="sr-only">Search artifacts</Dialog.Title>
          <Command label="Search artifacts" loop>
            <div className="flex items-center gap-3 border-b border-rule px-4">
              <SearchIcon className="size-4 shrink-0 text-fog" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={artifacts ? "Search by title, author or repository" : "Search artifacts, or go to a page"}
                className="h-13 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-fog"
              />
              <Dialog.Close
                aria-label="Close search"
                className="press -mr-2 grid size-9 shrink-0 place-items-center rounded-control text-fog hover:bg-wash hover:text-ink"
              >
                <CloseIcon className="size-4" />
              </Dialog.Close>
            </div>
            <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[14px] text-fog">
                Nothing matches “{query}” in {scope ?? "these pages"}.
              </Command.Empty>
              {artifacts && artifacts.length > 0 && (
                <Command.Group heading={section === "mine" ? "Your artifacts on this page" : "Artifacts on this page"} className={heading}>
                  {artifacts.map((a) => (
                    <Command.Item key={a.id} value={`${a.title} ${a.author ?? ""} ${a.repo ?? ""} ${a.id}`} onSelect={() => go(a.url)} className={item}>
                      <Seal id={a.id} size={22} />
                      <span className="min-w-0 flex-1 truncate">{a.title || "Untitled"}</span>
                      {a.author && <span className="max-w-[40%] shrink-0 truncate text-[12.5px] text-fog">{a.author}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!artifacts && workspace && query.trim() && (
                <Command.Group heading="Artifacts" className={heading}>
                  <Command.Item value={`search ${query}`} onSelect={() => go(`/?q=${encodeURIComponent(query.trim())}`)} className={cx(item, "h-auto min-h-11 py-2")}>
                    <SearchIcon className="size-4 shrink-0 text-fog" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">Filter newest artifacts for “{query.trim()}”</span>
                      <span className="block truncate text-[12.5px] text-fog">In {workspace.name}</span>
                    </span>
                  </Command.Item>
                </Command.Group>
              )}
              <Command.Group heading="Go to" className={heading}>
                {workspace && (
                  <Command.Item value="all artifacts feed home" onSelect={() => go("/")} className={cx(item, "h-auto min-h-11 py-2")}>
                    <span className="min-w-0 flex-1">
                      <span className="block">All artifacts</span>
                      <span className="block truncate text-[12.5px] text-fog">In {workspace.name}</span>
                    </span>
                  </Command.Item>
                )}
                {workspace && (
                  <Command.Item value="mine my artifacts" onSelect={() => go("/mine")} className={item}>
                    My artifacts
                  </Command.Item>
                )}
                <Command.Item value="workspaces switch create join" onSelect={() => go("/workspaces")} className={item}>
                  Workspaces
                </Command.Item>
                <Command.Item value="docs help commands" onSelect={() => go("/docs")} className={item}>
                  Docs
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// A page's title, what it is, and its actions on the right.
export function PageHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  // Long names (workspaces can be 100 characters) step down a size.
  const long = title.length > 28;
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
      <div className="min-w-0 flex-1">
        <h1
          className={cx(
            "text-balance font-wide font-[720] tracking-[-0.03em] text-ink [overflow-wrap:anywhere]",
            long ? "text-[26px] leading-[1.1] sm:text-[30px]" : "text-page"
          )}
        >
          {title}
        </h1>
        {children && <div className="mt-2.5 max-w-[62ch] text-[15.5px] leading-relaxed text-fog">{children}</div>}
      </div>
      {aside}
    </div>
  );
}
