import type { Session } from "../page";
import { ButtonLink } from "./Button";
import { GitHubIcon } from "./icons";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export const REPO_URL = "https://github.com/Dhruv2mars/htmlartifact";

// Header for the public pages (landing, docs).
export function SiteHeader({ session, current }: { session: Session | null; current?: "docs" }) {
  return (
    <header className="vt-header relative z-10 mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-5 sm:px-8">
      <Logo />
      <nav className="ml-auto flex items-center gap-1 text-[14px] text-ink-2 sm:ml-4 sm:mr-auto">
        <a href="/docs" aria-current={current === "docs" ? "page" : undefined} className="rounded-full px-3 py-1.5 transition-colors duration-150 hover:bg-wash hover:text-ink aria-[current=page]:text-ink aria-[current=page]:font-medium">
          Docs
        </a>
        <a href={REPO_URL} className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors duration-150 hover:bg-wash hover:text-ink sm:inline-flex">
          <GitHubIcon className="size-3.5" />
          GitHub
        </a>
      </nav>
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        {session ? (
          <ButtonLink href="/" size="sm">
            Open {session.workspace?.name ?? "htmlartifact"}
          </ButtonLink>
        ) : (
          <ButtonLink href="/auth/sign-in" size="sm" tone="line">
            Sign in
          </ButtonLink>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-10 text-[13.5px] text-fog sm:flex-row sm:items-center sm:px-8">
        <Logo />
        <nav className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-6">
          <a className="hover:text-ink" href="/docs">Docs</a>
          <a className="hover:text-ink" href={REPO_URL}>GitHub</a>
          <a className="hover:text-ink" href="https://www.npmjs.com/package/htmlartifact">npm</a>
          <a className="hover:text-ink" href={`${REPO_URL}/blob/main/SECURITY.md`}>Security</a>
        </nav>
        <p className="sm:ml-auto">Open source, MIT licensed.</p>
      </div>
    </footer>
  );
}
