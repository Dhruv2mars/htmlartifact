import { useRef } from "react";
import { CopyText } from "../components/CopyText";
import { Gutter, MarginNote, NoteArrow, Rule, SectionLabel } from "../components/Sheet";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import { Words } from "../components/CopyCommand";
import { Seal } from "../components/Seal";
import type { Session } from "../page";
import { Demo, DEMO_ID } from "./Demo";
import { FoilSeal } from "../components/FoilSeal";
import { Install } from "./Install";

// The landing (web/DESIGN.md): one ruled sheet. Hero, the one-link demo, how
// it works, what stays private, agents, and the close.
export function Landing({ session }: { session: Session | null }) {
  return (
    <div className="overflow-x-clip">
      <SiteHeader session={session} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Gutter />
        <section aria-labelledby="demo">
          <SectionLabel id="demo" aside={<span className="hidden font-mono text-[12.5px] text-faint sm:inline">/d/{DEMO_ID}</span>}>
            One link, three people
          </SectionLabel>
          <Demo />
        </section>
        <Gutter />
        <Steps />
        <Gutter />
        <Private />
        <Gutter />
        <Agents />
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
    <Rule as="section" inner="grid md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
        <h1 className="rise text-display font-medium tracking-[-0.045em] text-foreground" style={rise(0)}>
          Members only.
        </h1>
        <p className="rise mt-5 max-w-[34ch] text-[17px] leading-[1.6] text-muted sm:text-[18px]" style={rise(80)}>
          Your coding agents write plans, specs, reviews and reports as HTML. htmlartifact turns each one into a link that only
          your workspace can open.
        </p>
        <div className="rise relative mt-8 max-w-[25rem]" style={rise(160)}>
          <Install />
          <MarginNote className="top-1">
            start here
            <NoteArrow className="ml-auto" />
          </MarginNote>
        </div>
        <p className="rise mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px]" style={rise(220)}>
          <a href="/docs" className="text-muted underline decoration-control underline-offset-4 transition-colors duration-150 hover:text-foreground hover:decoration-foreground">
            Read the docs
          </a>
          <a href={REPO_URL} className="text-muted underline decoration-control underline-offset-4 transition-colors duration-150 hover:text-foreground hover:decoration-foreground">
            Source on GitHub
          </a>
        </p>
        <div className="rise lock mt-10 flex items-center gap-4 md:hidden" style={rise(300)}>
          <Seal id={DEMO_ID} size={64} />
          <p className="text-[13px] leading-snug text-muted">
            Every artifact gets its own seal.
            <span className="mt-0.5 block font-mono text-[12px] text-faint">No. {DEMO_ID}</span>
          </p>
        </div>
      </div>
      <div className="relative hidden items-center justify-center border-l border-line md:flex">
        <div className="flex flex-col items-center">
          <FoilSeal id={DEMO_ID} size={208} />
          <p className="rise mt-5 font-mono text-[12px] text-faint" style={rise(700)}>
            No. {DEMO_ID}
          </p>
        </div>
        <MarginNote side="right" className="bottom-16">
          <NoteArrow flip className="mb-1" />
          every artifact
          <br />
          gets its own seal
        </MarginNote>
      </div>
    </Rule>
  );
}

const STEPS = [
  { title: "Sign in", body: "A browser opens once. Works over SSH.", cmds: ["npx htmlartifact login"] },
  {
    title: "Start a workspace",
    body: "You're its admin. Invite codes expire in 7 days.",
    cmds: ['npx htmlartifact workspace create "Northwind"', "npx htmlartifact workspace invite"]
  },
  { title: "Your team joins", body: "With the code, or the /join link it prints.", cmds: ["npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA"] },
  { title: "Anyone publishes", body: "Same file again: a new version, same link.", cmds: ["npx htmlartifact upload plan.html"] }
];

function Steps() {
  return (
    <section aria-labelledby="steps">
      <SectionLabel id="steps">How it works</SectionLabel>
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
            <p className="mt-4 ml-[2.1rem] rounded-[6px] border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] leading-relaxed text-foreground">
              {s.cmds.map((c) => (
                <span key={c} className="block">
                  <Words text={c} />
                </span>
              ))}
            </p>
          </div>
        ))}
      </Rule>
    </section>
  );
}

const SPEC = [
  ["Who can open a link", "Members of the workspace it was published in, and nobody else."],
  ["What outsiders see", "The same 404 a link that never existed gets, byte for byte. A URL can't be used to probe what exists."],
  ["Membership", "Checked with WorkOS, not read from a token alone. Remove someone and their access ends at once."],
  ["Scripts in an artifact", "Run on a separate origin under a strict CSP, so a page with scripts can't read your session."],
  ["Invites", "Only admins create them. Codes expire after 7 days and stop at their use limit."],
  ["Deleting", "Erases the HTML of every version, not just the link."]
] as const;

function Private() {
  return (
    <section aria-labelledby="private">
      <SectionLabel id="private">What stays private</SectionLabel>
      <Rule as="div" inner="">
        <dl className="divide-y divide-line">
          {SPEC.map(([term, body]) => (
            <div key={term} className="grid gap-1 px-4 py-4 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6 sm:px-6">
              <dt className="text-[14px] font-medium text-foreground">{term}</dt>
              <dd className="text-[14px] leading-relaxed text-muted">{body}</dd>
            </div>
          ))}
        </dl>
      </Rule>
    </section>
  );
}

const AGENT_SNIPPET = `## Sharing work with the team
When you write a plan, spec, review or report as HTML,
publish it so the team can open it:

  npx htmlartifact upload <file> --json

Share the "url" it returns. To read a link a teammate
shared with you:

  npx htmlartifact read <url>`;

const AGENT_POINTS = [
  ["--json", "On every command. One object an agent can parse, errors included."],
  ["read <url>", "Agents open a teammate's link with your sign-in, so links pasted into chat work for them too."],
  ["check <path>", "Validates the HTML against the publishing rules without publishing."],
  ["API keys", "For CI: an admin creates one, and the pipeline publishes with HTMLARTIFACT_TOKEN."]
] as const;

function Agents() {
  const snippet = useRef<HTMLPreElement>(null);
  return (
    <section aria-labelledby="agents">
      <SectionLabel id="agents">Made for agents</SectionLabel>
      <Rule inner="grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-w-0 border-b border-line px-4 py-6 sm:px-6 md:border-b-0 md:border-r">
          <p className="max-w-[34ch] text-[15px] leading-relaxed text-muted">
            Add a few lines to <span className="text-foreground">CLAUDE.md</span> or <span className="text-foreground">AGENTS.md</span>, and your agent
            publishes on its own.
          </p>
          <dl className="mt-6 space-y-4">
            {AGENT_POINTS.map(([term, body]) => (
              <div key={term}>
                <dt className="font-mono text-[13px] text-foreground">{term}</dt>
                <dd className="mt-0.5 text-[14px] leading-relaxed text-muted">{body}</dd>
              </div>
            ))}
          </dl>
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
              aria-label="CLAUDE.md snippet"
              className="overflow-x-auto px-4 py-4 text-[12.5px] leading-[1.75] text-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              {AGENT_SNIPPET}
            </pre>
          </div>
        </div>
      </Rule>
    </section>
  );
}

function Closing() {
  return (
    <Rule as="section" inner="px-4 py-14 sm:px-6 sm:py-20">
      <h2 className="max-w-[18ch] text-title font-medium tracking-[-0.035em] text-foreground">Give your agents somewhere private to publish.</h2>
      <p className="mt-3 max-w-[52ch] text-[15px] text-muted">
        Free on htmlartifact.pages.dev, or run your own: one Cloudflare Worker and a D1 database, with WorkOS for accounts. All on
        free tiers, MIT licensed.
      </p>
      <div className="mt-7 max-w-[25rem]">
        <Install />
      </div>
    </Rule>
  );
}
