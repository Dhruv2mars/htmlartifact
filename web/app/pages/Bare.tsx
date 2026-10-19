import type { ReactNode } from "react";
import { ButtonLink } from "../components/Button";
import { CopyCommand } from "../components/CopyCommand";
import { Logo } from "../components/Logo";
import { Seal } from "../components/Seal";
import { ThemeToggle } from "../components/ThemeToggle";

// Pages with nothing around them: sign-in, problems, 404.
function Bare({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="vt-header mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-5 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>
      <main className="grid flex-1 place-items-center px-5 pb-24 pt-6">
        <div className="w-full max-w-[460px] text-center">{children}</div>
      </main>
    </div>
  );
}

export function SignIn({ next }: { next: string }) {
  // An invite link: say so, and give the terminal route to the same workspace.
  const invite = /^\/join\/([A-Za-z0-9-]+)$/.exec(next || "")?.[1];
  return (
    <Bare>
      <Seal id="htmlartifact" size={96} className="mx-auto" />
      <h1 className="mt-8 font-wide text-[34px] font-[740] leading-[1.05] tracking-[-0.03em] text-ink">
        {invite ? "You're invited to a workspace" : "Sign in to htmlartifact"}
      </h1>
      <p className="mt-3 text-[15.5px] leading-relaxed text-fog">
        {invite
          ? "Sign in, or create an account, and you'll come straight back here to join it."
          : "Artifacts open only for members of their workspace. Sign in, or create an account, and you'll come straight back here."}
      </p>
      <ButtonLink href={`/auth/sign-in?next=${encodeURIComponent(next || "/")}`} size="lg" className="mt-8">
        Sign in or create an account
      </ButtonLink>
      <div className="mt-14 border-t border-rule pt-6">
        <p className="text-[13.5px] text-fog">From a terminal or an agent</p>
        <CopyCommand command="npx htmlartifact login" className="mt-3" />
        {invite && <CopyCommand command={`npx htmlartifact workspace join ${invite}`} className="mt-2" />}
      </div>
    </Bare>
  );
}

export function Message({ title, message, retry }: { title: string; message: string; retry: boolean }) {
  return (
    <Bare>
      <Seal id={title} size={72} className="mx-auto opacity-80" />
      <h1 className="mt-7 font-wide text-[30px] font-[740] leading-[1.05] tracking-[-0.03em] text-ink">{title}</h1>
      <p className="mt-3 text-[15.5px] leading-relaxed text-fog">{message}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {retry && <ButtonLink href="/auth/sign-in">Try again</ButtonLink>}
        <ButtonLink href="/" tone={retry ? "ghost" : "ink"}>
          Go home
        </ButtonLink>
      </div>
    </Bare>
  );
}

export function NotFound() {
  return (
    <Bare>
      <p aria-hidden className="font-expanded text-[96px] font-[820] leading-none tracking-[-0.05em] text-rule-2 sm:text-[128px]">
        404
      </p>
      <h1 className="mt-6 font-wide text-[30px] font-[740] leading-[1.05] tracking-[-0.03em] text-ink">Not found</h1>
      <p className="mt-3 text-[15.5px] leading-relaxed text-fog">This page does not exist, or your current workspace cannot see it.</p>
      <ButtonLink href="/" className="mt-8">
        Go home
      </ButtonLink>
    </Bare>
  );
}
