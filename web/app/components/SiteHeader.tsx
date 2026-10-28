import type { Session } from "../page";
import { ButtonLink } from "./Button";
import { Logo } from "./Logo";
import { Rule, type SheetWidth } from "./Sheet";
import { SkipLink } from "./SkipLink";
import { ThemeToggle } from "./ThemeToggle";

// The source lives on Entire (public, browsable signed out).
export const REPO_URL = "https://entire.com/et/dhruv2mars/htmlartifact";
export const SECURITY_URL = `${REPO_URL}/files/SECURITY.md`;

// The public pages' header (landing, docs, privacy): the sheet's first ruled
// row, sticky, so sign-in and the theme stay in reach on long pages.
export function SiteHeader({
  session,
  current,
  sticky = true,
  width = "site"
}: {
  session: Session | null;
  current?: "docs" | "privacy";
  sticky?: boolean;
  width?: SheetWidth;
}) {
  const link =
    "rounded-control px-2.5 py-1.5 text-[14px] text-muted transition-colors duration-150 hover:text-foreground aria-[current=page]:text-foreground";
  return (
    <>
      <SkipLink />
      <Rule
        as="header"
        width={width}
        className={sticky ? "vt-header sticky top-0 z-30 bg-background/80 backdrop-blur-md backdrop-saturate-150" : "vt-header"}
        inner="flex h-14 items-center gap-2 px-4 sm:gap-4 sm:px-6"
      >
        <Logo />
        <nav aria-label="Site" className="ml-1 flex items-center sm:ml-3">
          <a href="/docs" aria-current={current === "docs" ? "page" : undefined} className={`${link} max-[359px]:hidden`}>
            Docs
          </a>
          <a href={REPO_URL} className={`${link} hidden sm:inline-flex`}>
            Source
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1">
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
      </Rule>
    </>
  );
}

export function SiteFooter({ width = "site" }: { width?: SheetWidth }) {
  const link = "text-muted transition-colors duration-150 hover:text-foreground";
  return (
    <Rule as="footer" width={width} className="border-b-0" inner="flex flex-col gap-5 px-4 py-8 text-[13.5px] sm:flex-row sm:items-center sm:px-6">
      <Logo />
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-4">
        <a className={link} href="/docs">Docs</a>
        <a className={link} href={REPO_URL}>Source</a>
        <a className={link} href="https://www.npmjs.com/package/htmlartifact">npm</a>
        <a className={link} href={SECURITY_URL}>Security</a>
        <a className={link} href="/privacy">Privacy</a>
      </nav>
      <p className="font-mono text-[12.5px] text-muted sm:ml-auto">MIT licensed</p>
    </Rule>
  );
}
