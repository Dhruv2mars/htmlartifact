import type { ReactNode } from "react";
import { ButtonLink } from "../components/Button";
import { CopyCommand } from "../components/CopyCommand";
import { AlertIcon, LockIcon } from "../components/icons";
import { Logo } from "../components/Logo";
import { SkipLink } from "../components/SkipLink";
import { Rule } from "../components/Sheet";
import { ThemeToggle } from "../components/ThemeToggle";

// Pages with nothing around them: sign-in, problems, 404. Still one sheet:
// a ruled header, then the rails down to the bottom of the screen.
function Bare({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <Rule as="header" className="vt-header" inner="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <ThemeToggle />
      </Rule>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <div className="mx-auto flex w-full max-w-[880px] flex-1 items-center justify-center border-x border-line px-5 pb-20 pt-10 sm:pb-28">
          <div className="w-full max-w-[440px] text-center">{children}</div>
        </div>
      </main>
    </div>
  );
}

function Badge({ tone, children }: { tone: "lock" | "alert"; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={
        tone === "lock"
          ? "mx-auto grid size-11 place-items-center rounded-full border border-border bg-card text-foreground"
          : "mx-auto grid size-11 place-items-center rounded-full border border-deny/30 bg-deny-wash text-deny"
      }
    >
      {children}
    </span>
  );
}

const h1 = "mt-6 text-balance text-[28px] font-medium leading-[1.12] tracking-[-0.035em] text-foreground sm:text-[32px]";
const lede = "mx-auto mt-3 max-w-[40ch] text-[15px] leading-relaxed text-muted";

export function SignIn({ next }: { next: string }) {
  // Where they were going decides the copy: an invite, an artifact, or the app.
  const invite = /^\/join\/([A-Za-z0-9-]+)$/.exec(next || "")?.[1];
  const artifact = /^\/(d|w|history)\//.test(next || "");
  return (
    <Bare>
      <Badge tone="lock">
        <LockIcon className="size-5" />
      </Badge>
      <h1 className={h1}>{invite ? "You're invited to a workspace" : artifact ? "Sign in to open this" : "Sign in to htmlartifact"}</h1>
      <p className={lede}>
        {invite
          ? "Sign in, or create an account, and you'll come straight back here to join it."
          : artifact
            ? "It belongs to a workspace, and only its members can open it. Sign in and you'll land right back here."
            : "Artifacts open only for members of their workspace. Sign in, or create an account, and you'll come straight back here."}
      </p>
      <ButtonLink href={`/auth/sign-in?next=${encodeURIComponent(next || "/")}`} size="lg" className="mt-8 w-full sm:w-auto">
        Sign in or create an account
      </ButtonLink>
      <div className="mt-12 border-t border-line pt-6 text-left">
        <p className="text-center font-mono text-[12.5px] text-muted">or from a terminal, for you or your agent</p>
        <div className="mt-3 space-y-2">
          <CopyCommand command="npx htmlartifact login" />
          {invite && <CopyCommand command={`npx htmlartifact workspace join ${invite}`} />}
        </div>
      </div>
    </Bare>
  );
}

export function Message({ title, message, retry, retryLabel }: { title: string; message: string; retry: string | null; retryLabel?: string | null }) {
  return (
    <Bare>
      <Badge tone="alert">
        <AlertIcon className="size-5" />
      </Badge>
      <h1 className={h1}>{title}</h1>
      <p className={lede}>{message}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5">
        {retry && <ButtonLink href={retry}>{retryLabel ?? "Try again"}</ButtonLink>}
        <ButtonLink href="/" tone={retry ? "line" : "ink"}>
          Go to htmlartifact
        </ButtonLink>
      </div>
    </Bare>
  );
}

export function NotFound() {
  return (
    <Bare>
      <p aria-hidden className="select-none font-mono text-[88px] font-medium leading-none tracking-[-0.06em] text-faint sm:text-[112px]">
        404
      </p>
      <h1 className={h1}>Not found</h1>
      <p className={lede}>This page does not exist, was deleted, or belongs to a workspace you are not in right now.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5">
        <ButtonLink href="/">Go to htmlartifact</ButtonLink>
        <ButtonLink href="/workspaces" tone="line">
          Your workspaces
        </ButtonLink>
      </div>
    </Bare>
  );
}
