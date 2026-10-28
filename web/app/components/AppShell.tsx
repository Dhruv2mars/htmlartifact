import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Command, useCommandState } from "cmdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { matchesAll, words } from "../lib/search";
import type { ArtifactSummary, Session } from "../page";
import { ChevronUpDown, CloseIcon, SearchIcon } from "./icons";
import { Logo } from "./Logo";
import { menuItem, menuPopup } from "./menu";
import { Notice } from "./Notice";
import { Seal } from "./Seal";
import { Rule } from "./Sheet";
import { REPO_URL } from "./SiteHeader";
import { SkipLink } from "./SkipLink";
import { ThemeToggle } from "./ThemeToggle";

type Section = "feed" | "mine" | "workspaces" | "people" | "settings" | null;

// Signed-in pages: the workspace you're in (its menu: people, settings,
// switching), its two views (everything, and yours), search, and the account
// menu. Pages render inside <main id="main">, under a one-time notice when
// the server sent one.
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
      className="relative flex h-full shrink-0 items-center whitespace-nowrap px-2 text-[14px] text-muted transition-colors duration-150 hover:text-foreground aria-[current=page]:text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-px after:bg-transparent aria-[current=page]:after:bg-foreground"
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
      <header data-sticky="app" className="vt-header sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1040px] items-center gap-2 border-x border-line px-4 sm:px-5">
          <Logo />
          {workspace && (
            <div className="hidden min-w-0 items-center md:flex">
              <span aria-hidden className="mx-2 text-[18px] font-light text-border">
                /
              </span>
              <WorkspaceMenu session={session} section={section} />
            </div>
          )}
          <nav aria-label="Workspace" className="ml-4 hidden h-full items-stretch gap-1 md:flex">
            {tabs}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {workspace && (
              <>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  className="press hidden h-8 w-52 items-center gap-2 rounded-control border border-border bg-card pl-2.5 pr-1.5 text-[13.5px] text-muted hover:text-foreground lg:flex"
                >
                  <SearchIcon className="size-3.5" />
                  Search artifacts
                  <kbd className="ml-auto rounded-[5px] border border-border px-1.5 font-mono text-[11.5px] leading-[18px] text-muted">⌘K</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Search artifacts"
                  className="press grid size-8 place-items-center rounded-control text-muted hover:bg-surface hover:text-foreground lg:hidden"
                >
                  <SearchIcon className="size-4" />
                </button>
              </>
            )}
            <ThemeToggle />
            <AccountMenu session={session} />
          </div>
        </div>
        <div className="border-t border-line md:hidden">
          <div className="mx-auto flex h-11 max-w-[1040px] items-stretch gap-3 border-x border-line px-4">
            {workspace && (
              <div className="flex min-w-0 flex-1 items-center">
                <WorkspaceMenu session={session} section={section} compact />
              </div>
            )}
            <nav aria-label="Workspace" className="flex shrink-0 items-stretch gap-1">
              {tabs}
            </nav>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {session.notice && <Notice notice={session.notice} />}
        {children}
      </main>
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} artifacts={artifacts} session={session} section={section} />
    </div>
  );
}

// The workspace you're in, and everything about it: its people (and, for
// admins, inviting), its settings, and the way to another workspace.
// `compact` (the phone row): no seal, so the name gets the room.
function WorkspaceMenu({ session, section, compact = false }: { session: Session; section: Section; compact?: boolean }) {
  const workspace = session.workspace!;
  const here = section === "people" || section === "settings" || section === "workspaces";
  return (
    <Menu.Root>
      <Menu.Trigger
        data-current={here || undefined}
        className="press group -ml-1.5 flex h-8 min-w-0 max-w-full items-center gap-2 rounded-control px-1.5 text-[14px] text-foreground hover:bg-surface data-current:bg-surface data-popup-open:bg-surface md:max-w-[15rem]"
      >
        {!compact && <Seal id={workspace.id} size={16} />}
        <span className="truncate">{workspace.name}</span>
        <span className="sr-only">: workspace menu</span>
        <ChevronUpDown className="size-3.5 shrink-0 text-faint group-hover:text-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="start" className="z-40 outline-none">
          <Menu.Popup className={cx(menuPopup, "w-64")}>
            <div className="flex items-start gap-2.5 px-2.5 pb-2 pt-1.5">
              <Seal id={workspace.id} size={20} />
              <div className="min-w-0">
                <p className="text-[14px] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">{workspace.name}</p>
                <p className="font-mono text-[12px] text-muted">{session.role === "admin" ? "You're an admin" : "You're a member"}</p>
              </div>
            </div>
            <Menu.Separator className="-mx-1 my-1 h-px bg-line" />
            {session.role === "admin" && (
              <Menu.LinkItem href="/people#links" className={menuItem}>
                Invite people
              </Menu.LinkItem>
            )}
            <Menu.LinkItem href="/people" aria-current={section === "people" ? "page" : undefined} className={menuItem}>
              People
            </Menu.LinkItem>
            <Menu.LinkItem href="/settings" aria-current={section === "settings" ? "page" : undefined} className={menuItem}>
              Settings
            </Menu.LinkItem>
            <Menu.Separator className="-mx-1 my-1 h-px bg-line" />
            <Menu.LinkItem href="/workspaces" aria-current={section === "workspaces" ? "page" : undefined} className={menuItem}>
              Switch, create or join a workspace
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function AccountMenu({ session }: { session: Session }) {
  const signOut = useRef<HTMLFormElement>(null);
  const initial = (session.name || session.email || "?").trim().charAt(0).toUpperCase();
  const item = menuItem;
  return (
    <>
      <form ref={signOut} method="post" action="/auth/sign-out" hidden />
      <Menu.Root>
        <Menu.Trigger
          className="press ml-1 grid size-8 place-items-center rounded-full hover:ring-2 hover:ring-border data-popup-open:ring-2 data-popup-open:ring-border"
          aria-label={`Account: ${session.name}`}
        >
          <span className="grid size-7 place-items-center rounded-full border border-border bg-surface text-[12px] font-medium text-foreground">{initial}</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-40 outline-none">
            <Menu.Popup className={cx(menuPopup, "w-60")}>
              <div className="px-2.5 pb-2 pt-1.5">
                <p className="text-[14px] font-medium text-foreground [overflow-wrap:anywhere]">{session.name}</p>
                {session.email && <p className="font-mono text-[12px] text-muted [overflow-wrap:anywhere]">{session.email}</p>}
              </div>
              <Menu.Separator className="-mx-1 my-1 h-px bg-line" />
              <Menu.LinkItem href="/workspaces" className={item}>
                Workspaces
              </Menu.LinkItem>
              <Menu.LinkItem href="/docs" className={item}>
                Docs
              </Menu.LinkItem>
              <Menu.LinkItem href={REPO_URL} className={item}>
                Source
              </Menu.LinkItem>
              <Menu.Separator className="-mx-1 my-1 h-px bg-line" />
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
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  useActiveDescendant(open, input);
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
    "flex h-10 cursor-default select-none items-center gap-3 rounded-[6px] px-2.5 text-[14px] text-muted data-[selected=true]:bg-surface data-[selected=true]:text-foreground forced-colors:data-[selected=true]:outline-2 forced-colors:data-[selected=true]:outline-solid forced-colors:data-[selected=true]:-outline-offset-2 forced-colors:data-[selected=true]:outline-[Highlight]";
  const heading =
    "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-faint";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60" />
        <Dialog.Popup initialFocus={input} className="fixed left-1/2 top-[max(12px,12vh)] z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-card bg-card shadow-pop outline-none forced-colors:border forced-colors:border-[CanvasText]">
          <Dialog.Title className="sr-only">Search artifacts</Dialog.Title>
          <Command label="Search artifacts" loop filter={(value, search, keywords) => (matchesAll(words(search), [value, ...(keywords ?? [])]) ? 1 : 0)}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <SearchIcon className="size-4 shrink-0 text-muted" />
              <Command.Input
                ref={input}
                value={query}
                onValueChange={setQuery}
                placeholder={artifacts ? "Search by title, author or repository" : "Search artifacts, or go to a page"}
                className="h-12 w-full bg-transparent text-[16px] text-foreground outline-none placeholder:text-faint sm:text-[15px]"
              />
              <Dialog.Close
                aria-label="Close search"
                className="press -mr-2 grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-surface hover:text-foreground"
              >
                <CloseIcon className="size-4" />
              </Dialog.Close>
            </div>
            <Results query={query} />
            <Command.List className="max-h-[min(440px,60vh)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-[14px] text-muted">
                Nothing matches “{query}” in {scope ?? "these pages"}.
              </Command.Empty>
              {artifacts && artifacts.length > 0 && (
                <Command.Group heading={section === "mine" ? "Your artifacts on this page" : "Artifacts on this page"} className={heading}>
                  {artifacts.map((a) => (
                    <Command.Item
                      key={a.id}
                      value={a.id}
                      keywords={[a.title, a.description ?? "", a.author ?? "", a.repo ?? ""]}
                      onSelect={() => go(a.url)}
                      className={item}
                    >
                      <Seal id={a.id} size={22} />
                      <span className="min-w-0 flex-1 truncate">{a.title || "Untitled"}</span>
                      {a.author && <span className="max-w-[40%] shrink-0 truncate text-[12.5px] text-muted">{a.author}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(!artifacts || section === "mine") && workspace && query.trim() && (
                <Command.Group heading={artifacts ? "Everyone's artifacts" : "Artifacts"} className={heading} forceMount>
                  <Command.Item value="search-workspace" forceMount onSelect={() => go(`/?q=${encodeURIComponent(query.trim())}`)} className={cx(item, "h-auto min-h-11 py-2")}>
                    <SearchIcon className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">Filter newest artifacts for “{query.trim()}”</span>
                      <span className="block truncate text-[12.5px] text-muted">In {workspace.name}</span>
                    </span>
                  </Command.Item>
                </Command.Group>
              )}
              <Command.Group heading="Go to" className={heading}>
                {workspace && (
                  <Command.Item value="all artifacts feed home" onSelect={() => go("/")} className={cx(item, "h-auto min-h-11 py-2")}>
                    <span className="min-w-0 flex-1">
                      <span className="block">All artifacts</span>
                      <span className="block truncate text-[12.5px] text-muted">In {workspace.name}</span>
                    </span>
                  </Command.Item>
                )}
                {workspace && (
                  <Command.Item value="mine my artifacts" onSelect={() => go("/mine")} className={item}>
                    My artifacts
                  </Command.Item>
                )}
                {workspace && (
                  <Command.Item value="people members team invite admins roles" onSelect={() => go("/people")} className={item}>
                    People
                  </Command.Item>
                )}
                {workspace && (
                  <Command.Item value="settings storage leave delete workspace" onSelect={() => go("/settings")} className={item}>
                    Settings
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

// A page's title row on the sheet: the title (with a count, when it lists
// something), what the page is, and its actions on the right.
export function PageHead({ title, count, children, aside }: { title: string; count?: number; children?: ReactNode; aside?: ReactNode }) {
  // Long names (workspaces can be 100 characters) step down a size.
  const long = title.length > 28;
  return (
    <Rule width="app" inner="flex flex-wrap items-end gap-x-8 gap-y-4 px-4 pb-6 pt-8 sm:px-5 sm:pt-12">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <h1
            className={cx(
              "min-w-0 text-balance font-medium tracking-[-0.035em] text-foreground [overflow-wrap:anywhere]",
              long ? "text-[24px] leading-[1.15] sm:text-[28px]" : "text-page"
            )}
          >
            {title}
          </h1>
          {/* The count is shown, not read: the list below says it in words. */}
          {count != null && (
            <span aria-hidden className="mt-1 font-mono text-[13px] text-faint">
              {count}
            </span>
          )}
        </div>
        {children && <div className="mt-2 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">{children}</div>}
      </div>
      {aside}
    </Rule>
  );
}

// Says how many results there are, or that nothing matches, as the query
// changes: the list itself is silent while you type.
function Results({ query }: { query: string }) {
  const count = useCommandState((state) => state.filtered.count);
  const q = query.trim();
  return (
    <p role="status" className="sr-only">
      {q ? (count ? `${count} ${count === 1 ? "result" : "results"}` : `Nothing matches “${q}”`) : ""}
    </p>
  );
}

// cmdk sets the input's aria-activedescendant from a value it computes a
// render late, so a screen reader can hear nothing or the wrong item. Keep
// it on the item that is actually selected.
function useActiveDescendant(open: boolean, input: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    if (!open) return;
    let observer: MutationObserver | null = null;
    const frame = requestAnimationFrame(() => {
      const field = input.current;
      const root = field?.closest("[cmdk-root]");
      if (!field || !root) return;
      const sync = () => {
        const id = root.querySelector('[cmdk-item][aria-selected="true"]')?.id;
        if (id && field.getAttribute("aria-activedescendant") !== id) field.setAttribute("aria-activedescendant", id);
        if (!id && field.hasAttribute("aria-activedescendant")) field.removeAttribute("aria-activedescendant");
      };
      observer = new MutationObserver(sync);
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "aria-activedescendant"] });
      sync();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [open, input]);
}
