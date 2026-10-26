import type { Session } from "../page";
import { ButtonLink } from "./Button";
import { GitHubIcon } from "./icons";
import { Logo } from "./Logo";
import { SkipLink } from "./SkipLink";
import { ThemeToggle } from "./ThemeToggle";

export const REPO_URL = "https://github.com/Dhruv2mars/htmlartifact";

// Header for the public pages (landing, docs, privacy). Sticky, so sign-in
// and the theme stay in reach on long pages.
export function SiteHeader({ session, current }: { session: Session | null; current?: "docs" | "privacy" }) {
  const link =
    "rounded-control px-3 py-1.5 transition-colors duration-150 hover:bg-wash hover:text-ink aria-[current=page]:font-medium aria-[current=page]:text-ink";
  return (
    <>
      <SkipLink />
      <header className="vt-header sticky top-0 z-20 border-b border-rule/70 bg-paper/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-5 sm:gap-6 sm:px-8">
          <Logo />
          <nav aria-label="Site" className="flex items-center gap-0.5 text-[14px] text-ink-2 sm:ml-2">
            <a href="/docs" aria-current={current === "docs" ? "page" : undefined} className={link}>
              Docs
            </a>
            <a href={REPO_URL} className={`${link} hidden items-center gap-1.5 sm:inline-flex`}>
              <GitHubIcon className="size-3.5" />
              GitHub
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {session ? (
              <ButtonLink href="/" size="sm" className="max-w-[12rem] sm:max-w-[16rem]">
                <span className="truncate">Open {session.workspace?.name ?? "htmlartifact"}</span>
              </ButtonLink>
            ) : (
              <ButtonLink href="/auth/sign-in" size="sm" tone="line">
                Sign in
              </ButtonLink>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-10 text-[14px] text-fog sm:flex-row sm:items-center sm:px-8">
        <Logo />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-6">
          <a className="hover:text-ink" href="/docs">Docs</a>
          <a className="hover:text-ink" href={REPO_URL}>GitHub</a>
          <a className="hover:text-ink" href="https://www.npmjs.com/package/htmlartifact">npm</a>
          <a className="hover:text-ink" href={`${REPO_URL}/blob/main/SECURITY.md`}>Security</a>
          <a className="hover:text-ink" href="/privacy">Privacy</a>
        </nav>
        <p className="sm:ml-auto">Open source, MIT licensed.</p>
      </div>
    </footer>
  );
}
