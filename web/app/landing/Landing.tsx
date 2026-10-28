import { useRef } from "react";
import { CommandBlock } from "../components/CommandBlock";
import { CopyCommand } from "../components/CopyCommand";
import { CopyText } from "../components/CopyText";
import { Gutter, MarginNote, NoteArrow, Rule, SectionLabel } from "../components/Sheet";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import type { Session } from "../page";
import { Story } from "./Story";

// The landing (web/DESIGN.md): the promise and the command, the working story
// right under them, then three short sections that each do one job.
export function Landing({ session }: { session: Session | null }) {
  return (
    <div className="overflow-x-clip">
      <SiteHeader session={session} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Rule as="section" labelledBy="story" inner="">
          <h2 id="story" className="sr-only">
            How a link works: one agent publishes it, three people open it
          </h2>
          <Story />
        </Rule>
        <Gutter />
        <Agents />
        <Gutter />
        <Steps />
        <Gutter />
        <Private />
        <Gutter />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

const rise = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

function Hero() {
  return (
    <Rule as="section" inner="grid gap-x-10 gap-y-5 px-4 pb-6 pt-8 sm:gap-y-7 sm:px-6 sm:pb-10 sm:pt-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0">
        <h1 className="rise text-display font-medium tracking-[-0.045em] text-foreground" style={rise(0)}>
          Members only.
        </h1>
        <p className="rise mt-3 max-w-[30ch] text-[16px] leading-snug text-muted sm:mt-4 sm:text-[18px]" style={rise(80)}>
          The HTML your coding agents write, as a link only your workspace can open.
        </p>
      </div>
      <div className="rise relative min-w-0 md:w-[20.5rem]" style={rise(160)}>
        <CopyCommand command="npx htmlartifact login" large />
        <p className="mt-3 hidden gap-x-5 text-[14px] sm:flex">
          <a href="/docs" className="text-muted underline decoration-control underline-offset-4 transition-colors duration-150 hover:text-foreground hover:decoration-foreground">
            Read the docs
          </a>
          <a href={REPO_URL} className="text-muted underline decoration-control underline-offset-4 transition-colors duration-150 hover:text-foreground hover:decoration-foreground">
            Source on Entire
          </a>
        </p>
        <MarginNote side="right" className="top-2">
          <NoteArrow flip className="mb-0.5" />
          start here
        </MarginNote>
      </div>
    </Rule>
  );
}

const AGENT_SNIPPET = `## Sharing work with the team
When you write a plan, spec, review or report as HTML,
publish it so the team can open it:

  npx htmlartifact upload <file> --json

Share the "url" it returns. To read a link a teammate
shared with you:

  npx htmlartifact read <url>`;

function Agents() {
  const snippet = useRef<HTMLPreElement>(null);
  return (
    <section aria-labelledby="agents">
      <Rule inner="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 border-b border-line px-4 py-7 sm:px-6 md:border-b-0 md:border-r">
          <h2 id="agents" className="text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">
            Your agent publishes on its own.
          </h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
            Paste this into <span className="text-foreground">CLAUDE.md</span> or <span className="text-foreground">AGENTS.md</span>. Every
            command takes <code className="font-mono text-[13px] text-foreground">--json</code>, and{" "}
            <code className="font-mono text-[13px] text-foreground">read &lt;url&gt;</code> lets agents open links your team shares.
          </p>
          <p className="mt-4 text-[13.5px] text-muted">
            For CI, an admin creates a workspace API key.{" "}
            <a href="/docs#ci" className="text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground">
              Set it up
            </a>
          </p>
        </div>
        <div className="min-w-0 bg-surface/60 p-3 sm:p-5">
          <div className="overflow-hidden rounded-card border border-border bg-card">
            <div className="flex items-center justify-between border-b border-line py-1 pl-4 pr-1">
              <span className="font-mono text-[12px] text-muted">CLAUDE.md</span>
              <CopyText text={AGENT_SNIPPET} what="CLAUDE.md snippet" target={snippet} />
            </div>
            <pre
              ref={snippet}
              tabIndex={0}
              role="region"
              aria-label="CLAUDE.md snippet"
              className="overflow-x-auto rounded-b-card px-4 py-4 text-[12.5px] leading-[1.75] text-foreground focus-visible:-outline-offset-2"
            >
              {AGENT_SNIPPET}
            </pre>
          </div>
        </div>
      </Rule>
    </section>
  );
}

const STEPS = [
  { title: "Sign in", body: "A browser opens once. Works over SSH.", cmds: ["npx htmlartifact login"] },
  { title: "Start a workspace and invite", body: "You're its admin. Codes expire in 7 days.", cmds: ['npx htmlartifact workspace create "Northwind"', "npx htmlartifact workspace invite"] },
  { title: "Your team joins", body: "With the code, or the /join link it prints.", cmds: ["npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA"] },
  { title: "Anyone publishes", body: "Same file again: a new version, same link.", cmds: ["npx htmlartifact upload plan.html"] }
];

function Steps() {
  return (
    <section aria-labelledby="steps">
      <SectionLabel id="steps">Set up a team in four steps</SectionLabel>
      <Rule inner="grid sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="flex min-w-0 flex-col border-line px-4 py-6 max-sm:[&:not(:last-child)]:border-b sm:px-6 sm:odd:border-r sm:[&:nth-child(-n+2)]:border-b"
          >
            <p className="flex items-baseline gap-3">
              <span className="font-mono text-[12.5px] text-faint">0{i + 1}</span>
              <span className="text-[15px] font-medium text-foreground">{s.title}</span>
            </p>
            <p className="mt-1 pl-[2.1rem] text-[14px] text-muted">{s.body}</p>
            <div className="mt-4 pl-[2.1rem]">
              <CommandBlock commands={s.cmds} />
            </div>
          </div>
        ))}
      </Rule>
    </section>
  );
}

const FACTS = [
  { title: "Checked on every request", body: "Membership comes from WorkOS, not a token alone. Remove someone and their access ends at once." },
  { title: "Scripts stay sandboxed", body: "Artifact HTML runs on a separate origin under a strict CSP. It can't touch your session." },
  { title: "Deleting erases", body: "Delete an artifact and the HTML of every version is gone, not hidden." }
];

function Private() {
  return (
    <section aria-labelledby="private">
      <Rule inner="px-4 pb-2 pt-8 sm:px-6">
        <h2 id="private" className="max-w-[24ch] text-[22px] font-medium leading-tight tracking-[-0.03em] text-foreground">
          Everyone else gets nothing, not even a hint the link exists.
        </h2>
      </Rule>
      <Rule inner="grid sm:grid-cols-3">
        {FACTS.map((f) => (
          <div key={f.title} className="min-w-0 border-line px-4 py-6 max-sm:[&:not(:last-child)]:border-b sm:px-6 sm:[&:not(:last-child)]:border-r">
            <h3 className="text-[14.5px] font-medium text-foreground">{f.title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </Rule>
      <Rule inner="px-4 py-3 text-[13.5px] sm:px-6">
        <a href="/docs#access" className="text-muted underline decoration-control underline-offset-4 hover:text-foreground hover:decoration-foreground">
          Every rule, in the docs
        </a>
      </Rule>
    </section>
  );
}

function Closing() {
  return (
    <Rule as="section" inner="grid gap-6 px-4 py-12 sm:px-6 sm:py-14 md:grid-cols-[minmax(0,1fr)_20.5rem] md:items-end">
      <div>
        <h2 className="max-w-[18ch] text-title font-medium tracking-[-0.035em] text-foreground">Give your agents somewhere private to publish.</h2>
        <p className="mt-3 max-w-[46ch] text-[14.5px] text-muted">Free on htmlartifact.pages.dev, or run your own on free tiers. MIT licensed.</p>
      </div>
      <CopyCommand command="npx htmlartifact login" large />
    </Rule>
  );
}

