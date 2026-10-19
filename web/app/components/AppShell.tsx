import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Command } from "cmdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import type { ArtifactSummary, Session } from "../page";
import { ChevronDown, SearchIcon } from "./icons";
import { Logo } from "./Logo";
import { Seal } from "./Seal";
import { REPO_URL } from "./SiteHeader";
import { ThemeToggle } from "./ThemeToggle";

type Section = "feed" | "mine" | "workspaces" | null;

// Signed-in pages: workspace nav, ⌘K, and the account menu.
export function AppShell({
  session,
  section,
  artifacts = [],
  children
}: {
  session: Session;
  section: Section;
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

  const link = (href: string, key: Section, label: ReactNode) => (
    <a
      href={href}
      aria-current={section === key ? "page" : undefined}
      className="max-w-[11rem] shrink-0 truncate whitespace-nowrap rounded-full px-3 py-1.5 text-ink-2 transition-colors sm:max-w-[16rem] duration-150 hover:bg-wash hover:text-ink aria-[current=page]:bg-wash aria-[current=page]:font-medium aria-[current=page]:text-ink"
    >
      {label}
    </a>
  );

  return (
    <div className="min-h-dvh">
      <header className="vt-header sticky top-0 z-20 border-b border-rule bg-paper/92 backdrop-blur-[6px]">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:gap-5 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-0.5 text-[14px] md:flex">
            {session.workspace && link("/", "feed", session.workspace.name)}
            {session.workspace && link("/mine", "mine", "Mine")}
            {link("/workspaces", "workspaces", "Workspaces")}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {session.workspace && (
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="press hidden h-9 items-center gap-2 rounded-full border border-rule bg-paper-2 pl-3 pr-2 text-[13px] text-fog hover:border-rule-2 hover:text-ink sm:flex"
              >
                <SearchIcon className="size-3.5" />
                Find an artifact
                <kbd className="ml-2 rounded-md border border-rule px-1.5 py-px font-sans text-[11px]">⌘K</kbd>
              </button>
            )}
            <ThemeToggle />
            <AccountMenu session={session} />
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1120px] gap-0.5 overflow-x-auto px-3 pb-2 text-[14px] md:hidden">
          {session.workspace && link("/", "feed", session.workspace.name)}
          {session.workspace && link("/mine", "mine", "Mine")}
          {link("/workspaces", "workspaces", "Workspaces")}
        </nav>
      </header>
      {children}
      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} artifacts={artifacts} session={session} />
    </div>
  );
}

function AccountMenu({ session }: { session: Session }) {
  const signOut = useRef<HTMLFormElement>(null);
  const initial = (session.name || session.email || "?").trim().charAt(0).toUpperCase();
  const item =
    "flex h-9 cursor-default select-none items-center rounded-lg px-3 text-[14px] text-ink-2 outline-none data-highlighted:bg-wash data-highlighted:text-ink";
  return (
    <>
      <form ref={signOut} method="post" action="/auth/sign-out" hidden />
      <Menu.Root>
        <Menu.Trigger
          className="press flex h-9 items-center gap-1 rounded-full pl-1 pr-1.5 text-fog hover:bg-wash hover:text-ink data-popup-open:bg-wash"
          aria-label="Account"
        >
          <span className="grid size-7 place-items-center rounded-full bg-ink text-[12px] font-semibold text-paper">{initial}</span>
          <ChevronDown className="size-3.5" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-40 outline-none">
            <Menu.Popup className="w-64 origin-[var(--transform-origin)] rounded-2xl border border-rule bg-paper-2 p-1.5 shadow-[0_24px_48px_-24px_rgba(18,26,51,0.35)] outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
              <div className="px-3 pb-2.5 pt-2">
                <p className="truncate text-[14px] font-medium text-ink">{session.name}</p>
                {session.email && <p className="truncate text-[13px] text-fog">{session.email}</p>}
              </div>
              <Menu.Separator className="mx-1.5 my-1 h-px bg-rule" />
              <Menu.LinkItem href="/workspaces" className={item}>
                Switch workspace
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
// so it appears instantly (no animation).
function Palette({
  open,
  onOpenChange,
  artifacts,
  session
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: ArtifactSummary[];
  session: Session;
}) {
  const go = (href: string, newTab = false) => {
    onOpenChange(false);
    if (newTab) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.assign(href);
  };
  const item =
    "flex h-11 cursor-default select-none items-center gap-3 rounded-xl px-3 text-[14px] text-ink-2 data-[selected=true]:bg-wash data-[selected=true]:text-ink";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-[#0b1020]/30" />
        <Dialog.Popup className="fixed left-1/2 top-[12vh] z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-rule bg-paper-2 shadow-[0_40px_80px_-30px_rgba(11,16,32,0.5)] outline-none">
          <Dialog.Title className="sr-only">Find an artifact</Dialog.Title>
          <Command label="Find an artifact" loop>
            <div className="flex items-center gap-3 border-b border-rule px-4">
              <SearchIcon className="size-4 text-fog" />
              <Command.Input
                autoFocus
                placeholder="Find an artifact or a page"
                className="h-13 w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-fog"
              />
            </div>
            <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[14px] text-fog">No artifact by that name.</Command.Empty>
              {artifacts.length > 0 && (
                <Command.Group heading="Artifacts" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fog">
                  {artifacts.map((a) => (
                    <Command.Item key={a.id} value={`${a.title} ${a.author ?? ""} ${a.id}`} onSelect={() => go(a.url, true)} className={item}>
                      <Seal id={a.id} size={24} />
                      <span className="min-w-0 flex-1 truncate">{a.title}</span>
                      {a.author && <span className="shrink-0 text-[12px] text-fog">{a.author}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fog">
                {session.workspace && (
                  <Command.Item value={`feed ${session.workspace.name}`} onSelect={() => go("/")} className={item}>
                    {session.workspace.name}
                  </Command.Item>
                )}
                <Command.Item value="mine my artifacts" onSelect={() => go("/mine")} className={item}>
                  My artifacts
                </Command.Item>
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

export function PageHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  // Long names (workspaces can be 100 characters) step down a size.
  const long = title.length > 28;
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
      <div className="min-w-0 flex-1">
        <h1
          className={cx(
            "text-balance font-wide font-[720] leading-[1.05] tracking-[-0.03em] text-ink [overflow-wrap:anywhere]",
            long ? "text-[26px] sm:text-[32px]" : "text-[34px] sm:text-[44px]"
          )}
        >
          {title}
        </h1>
        {children && <div className="mt-3 max-w-[60ch] text-[15.5px] leading-relaxed text-fog">{children}</div>}
      </div>
      {aside}
    </div>
  );
}
