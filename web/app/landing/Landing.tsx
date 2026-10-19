import { ButtonLink } from "../components/Button";
import { CopyCommand } from "../components/CopyCommand";
import { CopyText } from "../components/CopyText";
import { Seal } from "../components/Seal";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import type { Session } from "../page";
import { ArtifactStage, HERO_ID } from "./ArtifactStage";
import { HeroSeal } from "./HeroSeal";
import { Terminal } from "./Terminal";

export function Landing({ session }: { session: Session | null }) {
  return (
    <div className="overflow-x-clip">
      <SiteHeader session={session} />
      <main>
        <Hero />
        <Flow />
        <Access />
        <ForAgents />
        <Feed />
        <Company />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

const shell = "mx-auto max-w-[1240px] px-5 sm:px-8";

function Hero() {
  return (
    <section className={`${shell} hero-seq pb-24 pt-10 sm:pt-16`}>
      <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="relative z-[1]">
          <h1 className="hero-rise font-expanded text-display font-[820] tracking-[-0.045em] text-ink" style={{ "--d": "0ms" } as React.CSSProperties}>
            Members only.
          </h1>
          <p
            className="hero-rise mt-7 max-w-[34ch] text-[19px] leading-[1.5] text-ink-2 sm:text-[22px]"
            style={{ "--d": "80ms" } as React.CSSProperties}
          >
            Your coding agents write plans, specs, reviews and reports as HTML. htmlartifact publishes each one to a link
            that opens only for people in your workspace.
          </p>
          <div className="hero-rise mt-9 flex flex-wrap items-center gap-3" style={{ "--d": "160ms" } as React.CSSProperties}>
            <CopyCommand command="npx htmlartifact login" size="lg" />
            <ButtonLink href="/docs" tone="ghost" size="lg">
              Read the docs
            </ButtonLink>
          </div>
        </div>
        <div className="hero-seal pointer-events-none absolute -right-16 -top-10 opacity-[0.16] sm:-right-10 lg:pointer-events-auto lg:relative lg:right-auto lg:top-auto lg:opacity-100">
          <HeroSeal id={HERO_ID} label={`The seal of artifact ${HERO_ID}`} />
        </div>
      </div>

      <div className="mt-16 grid items-start gap-6 *:min-w-0 lg:mt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
        <Terminal
          className="lg:mt-11"
          title="~/northwind/billing  claude"
          start={500}
          lines={[
            { kind: "agent", text: "The migration plan is ready. Publishing it so the team can review." },
            { kind: "cmd", text: "npx htmlartifact upload plan.html", type: true },
            { kind: "out", text: "Published", tone: "pass" },
            { kind: "out", text: `URL: https://htmlartifact.pages.dev/d/${HERO_ID}` },
            { kind: "out", text: `Artifact ID: ${HERO_ID}`, tone: "dim" },
            { kind: "out", text: "Version: 3", tone: "dim" },
            { kind: "out", text: "Workspace: Northwind (members only)" },
            { kind: "gap" },
            { kind: "agent", text: "Shared the link in #billing. Only Northwind can open it." }
          ]}
        />
        <ArtifactStage start={1900} />
      </div>
    </section>
  );
}

const STEPS = [
  {
    title: "Sign in",
    body: "Opens a browser once to sign in or create an account. Works over SSH.",
    lines: [{ cmd: "npx htmlartifact login" }]
  },
  {
    title: "Start a workspace",
    body: "You're its admin. Invite codes expire after 7 days and stop after their use limit.",
    lines: [{ cmd: 'npx htmlartifact workspace create "Northwind"' }, { cmd: "npx htmlartifact workspace invite" }, { out: 'Invite to "Northwind": HA-7KQ2-MX9P-4TRA' }]
  },
  {
    title: "Your team joins",
    body: "Or they open htmlartifact.pages.dev/join/HA-7KQ2-MX9P-4TRA in a browser.",
    lines: [{ cmd: "npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA" }]
  },
  {
    title: "Anyone publishes",
    body: "Upload the same file again and the link gets a new version, not a new URL.",
    lines: [{ cmd: "npx htmlartifact upload plan.html" }, { out: "Workspace: Northwind (members only)" }]
  }
];

function Flow() {
  return (
    <section className="border-t border-rule bg-paper-2">
      <div className={`${shell} py-24 sm:py-32`}>
        <SectionHead
          title="Four commands. Your agent can run every one."
          body="There is no dashboard to set up first. The whole flow lives in the terminal, where your agent already works."
        />
        <ol className="mt-14 divide-y divide-rule border-y border-rule">
          {STEPS.map((step, i) => (
            <li key={step.title} className="grid gap-4 py-7 *:min-w-0 md:grid-cols-[3rem_minmax(0,17rem)_minmax(0,1fr)] md:gap-8">
              <span className="font-mono text-[13px] text-fog">{i + 1}</span>
              <div>
                <h3 className="font-wide text-[19px] font-[650] tracking-[-0.015em]">{step.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-fog">{step.body}</p>
              </div>
              <pre className="self-start overflow-x-auto rounded-xl bg-paper px-4 py-3.5 text-[12.5px] leading-[1.9] ring-1 ring-rule">
                {step.lines.map((l, j) =>
                  "cmd" in l ? (
                    <div key={j}>
                      <span className="select-none text-intaglio">$ </span>
                      {l.cmd}
                    </div>
                  ) : (
                    <div key={j} className="text-fog">
                      {l.out}
                    </div>
                  )
                )}
              </pre>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const LOG = [
  { who: "Priya", detail: "member of Northwind", status: 200, result: "The plan", tone: "pass" },
  { who: "Signed out", detail: "no session", status: 302, result: "Sign in, then back to the link", tone: "hold" },
  { who: "Sam", detail: "member of Globex", status: 404, result: "Not found", tone: "deny" },
  { who: "Dan", detail: "removed from Northwind a minute ago", status: 404, result: "Not found", tone: "deny" }
] as const;

const FACTS = [
  {
    title: "Checked with WorkOS",
    body: "Membership is confirmed with WorkOS, not taken from a token alone. Remove someone and their access ends at once."
  },
  {
    title: "Scripts stay in a sandbox",
    body: "Artifact HTML is served from a separate origin under a strict CSP, so a page with scripts can't read your session."
  },
  {
    title: "Invites are for admins",
    body: "Only admins create invite codes. Codes expire after 7 days by default and have a use limit."
  },
  {
    title: "Deleted means erased",
    body: "Delete an artifact and the HTML of every version is erased, not hidden."
  }
];

function Access() {
  return (
    <section className={`${shell} py-24 sm:py-32`}>
      <SectionHead
        title="Everyone else gets nothing."
        body="No blurred preview, no request-access page. Outside the workspace, the link tells the person holding it nothing at all, not even that it exists."
      />
      <div className="mt-14 overflow-hidden rounded-2xl border border-rule bg-paper-2">
        <div className="flex items-center gap-3 border-b border-rule px-5 py-3 font-mono text-[12px] text-fog">
          <span className="text-ink">GET</span>
          <span className="truncate">/d/{HERO_ID}</span>
        </div>
        <table className="w-full text-left text-[14px]">
          <caption className="sr-only">What htmlartifact returns for one artifact link, by who asks</caption>
          <thead className="sr-only">
            <tr>
              <th>Who</th>
              <th>Status</th>
              <th>What they see</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {LOG.map((row) => (
              <tr key={row.who + row.detail}>
                <td className="py-3.5 pl-5 pr-3 align-top">
                  <span className="font-medium text-ink">{row.who}</span>
                  <span className="block text-[13px] text-fog sm:inline sm:pl-2">{row.detail}</span>
                </td>
                <td className="w-16 px-3 py-3.5 align-top font-mono text-[13px] tabular-nums" style={{ color: `var(--${row.tone})` }}>
                  {row.status}
                </td>
                <td className="py-3.5 pl-3 pr-5 text-right align-top text-ink-2 sm:w-[40%] sm:text-left">{row.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[13.5px] text-fog">
        Sam and Dan get byte-for-byte the page a link that never existed gets, so a URL can't be used to probe what exists.
      </p>
      <dl className="mt-16 grid gap-x-12 gap-y-10 sm:grid-cols-2">
        {FACTS.map((f) => (
          <div key={f.title}>
            <dt className="font-wide text-[17px] font-[650] tracking-[-0.01em]">{f.title}</dt>
            <dd className="mt-2 max-w-[46ch] text-[15px] leading-relaxed text-fog">{f.body}</dd>
          </div>
        ))}
      </dl>
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

function ForAgents() {
  return (
    <section className="border-y border-rule bg-paper-2">
      <div className={`${shell} grid gap-14 py-24 *:min-w-0 sm:py-32 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <div>
          <SectionHead title="Made for agents to drive." body="Add a few lines to CLAUDE.md or AGENTS.md and your agent publishes on its own." />
          <dl className="mt-12 space-y-7">
            {[
              ["--json on every command", "Structured output an agent can parse, errors included."],
              ["read <url>", "Agents fetch a teammate's artifact with your sign-in, so links pasted into a chat work for them too."],
              ["check <path>", "Validate the HTML against the publishing rules before uploading."],
              ["HTMLARTIFACT_TOKEN", "A WorkOS organization API key for CI, instead of a browser sign-in."]
            ].map(([term, body]) => (
              <div key={term}>
                <dt className="font-mono text-[13px] text-ink">{term}</dt>
                <dd className="mt-1.5 text-[15px] leading-relaxed text-fog">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="space-y-5">
          <Snippet title="CLAUDE.md" body={AGENT_SNIPPET} />
          <Terminal
            animate={false}
            title="upload --json"
            lines={[
              { kind: "cmd", text: "npx htmlartifact upload review.html --json" },
              { kind: "out", text: "{" },
              { kind: "out", text: '  "ok": true,' },
              { kind: "out", text: '  "action": "created",' },
              { kind: "out", text: '  "draftId": "r7v2kq9d0m3a",' },
              { kind: "out", text: '  "url": "https://htmlartifact.pages.dev/d/r7v2kq9d0m3a",' },
              { kind: "out", text: '  "versionNumber": 1,' },
              { kind: "out", text: '  "workspace": "Northwind"' },
              { kind: "out", text: "}" }
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function Snippet({ title, body }: { title: string; body: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-rule bg-paper">
      <div className="flex items-center justify-between border-b border-rule py-2 pl-5 pr-2">
        <span className="font-mono text-[12px] text-fog">{title}</span>
        <CopyText text={body} />
      </div>
      <pre className="overflow-x-auto px-5 py-4 text-[12.5px] leading-[1.8] text-ink-2">{body}</pre>
    </div>
  );
}


const FEED = [
  { id: "k3j9x0a1b2c4", title: "Billing migration plan", who: "Priya", repo: "northwind/billing", v: 3, when: "12 min ago" },
  { id: "r7v2kq9d0m3a", title: "Code review: session refresh race", who: "Marcus", repo: "northwind/auth", v: 1, when: "1 hour ago" },
  { id: "w2e8pl5n1x6c", title: "Pricing page, three directions", who: "Wen", repo: "northwind/web", v: 5, when: "3 hours ago" },
  { id: "h6t1zc8b4q2r", title: "Postmortem: queue backlog on Oct 14", who: "Diego", repo: "northwind/infra", v: 2, when: "Yesterday" },
  { id: "y9m3fa0s7u1k", title: "Public API v2 spec", who: "Priya", repo: "northwind/api", v: 7, when: "Oct 12" }
];

function Feed() {
  return (
    <section className={`${shell} grid gap-14 py-24 *:min-w-0 sm:py-32 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-16`}>
      <SectionHead
        title="Every artifact gets a seal."
        body="Each seal is generated from the artifact's id, so a plan wears the same one in the feed and in its version history. Your workspace reads at a glance."
      />
      <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-paper-2">
        {FEED.map((a) => (
          <li key={a.id} className="flex items-center gap-4 px-5 py-4">
            <Seal id={a.id} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{a.title}</p>
              <p className="mt-0.5 truncate text-[13px] text-fog">
                {a.who} in {a.repo}
              </p>
            </div>
            <div className="hidden shrink-0 text-right text-[12.5px] text-fog sm:block">
              <p className="tabular-nums">v{a.v}</p>
              <p>{a.when}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Company() {
  return (
    <section className="border-t border-rule">
      <div className={`${shell} grid gap-10 py-20 sm:grid-cols-3 sm:gap-12`}>
        {[
          ["Free to run", "It fits on free tiers: Cloudflare Pages, Workers and D1, with accounts by WorkOS. No card needed."],
          ["Nothing to run", "One Cloudflare Worker and a D1 database. No servers, no containers, nothing to babysit."],
          ["Open source", "MIT licensed. Read the code, host your own, or send a pull request."]
        ].map(([title, body]) => (
          <div key={title}>
            <h3 className="font-wide text-[17px] font-[650] tracking-[-0.01em]">{title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-fog">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="relative overflow-hidden bg-[#0f1630] text-[#e7eaf4]">
      <Seal id="members-only" size={720} stroke={0.7} className="pointer-events-none absolute -right-48 -top-40 size-[520px]! opacity-25 sm:size-[720px]!" style={{ color: "#8c9bff" }} />
      <div className={`${shell} relative py-24 sm:py-32`}>
        <h2 className="max-w-[16ch] font-expanded text-title font-[800] tracking-[-0.035em]">Give your agents somewhere private to publish.</h2>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <CopyCommand command="npx htmlartifact login" size="lg" tone="ink" />
          <ButtonLink href={REPO_URL} size="lg" className="bg-transparent text-white/75 hover:bg-white/8 hover:text-white">
            View on GitHub
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-[40rem]">
      <h2 className="font-wide text-title font-[740] tracking-[-0.03em] text-ink">{title}</h2>
      <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-fog">{body}</p>
    </div>
  );
}
