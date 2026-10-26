import { ButtonLink } from "../components/Button";
import { CopyCommand } from "../components/CopyCommand";
import { CopyText } from "../components/CopyText";
import { Seal } from "../components/Seal";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import type { Session } from "../page";
import { ArtifactStage, HERO_ID } from "./ArtifactStage";
import { Terminal } from "./Terminal";

export function Landing({ session }: { session: Session | null }) {
  return (
    <div className="overflow-x-clip">
      <SiteHeader session={session} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Steps />
        <Access />
        <ForAgents />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

const shell = "mx-auto max-w-[1240px] px-5 sm:px-8";
const rise = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

function Hero() {
  return (
    <section className={`${shell} pb-20 pt-12 sm:pb-28 sm:pt-16 lg:pt-20`}>
      <h1 className="hero-rise font-expanded text-display font-[800] tracking-[-0.045em] text-ink" style={rise(0)}>
        Members only.
      </h1>
      <div className="mt-8 grid gap-x-14 gap-y-14 *:min-w-0 sm:mt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <p className="hero-rise max-w-[36ch] text-[18px] leading-[1.55] text-ink-2 sm:text-[20px]" style={rise(60)}>
            Your coding agents write plans, specs, reviews and reports as HTML. htmlartifact publishes each one to a link that opens
            only for people in your workspace.
          </p>
          <div className="hero-rise mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center" style={rise(120)}>
            <CopyCommand command="npx htmlartifact login" size="lg" className="w-full sm:w-auto" />
            <a href="/docs" className="text-[15px] font-medium text-ink-2 underline decoration-rule-2 underline-offset-4 hover:text-ink hover:decoration-ink sm:hidden">
              Read the docs
            </a>
            <ButtonLink href="/docs" tone="ghost" size="lg" className="max-sm:hidden">
              Read the docs
            </ButtonLink>
          </div>
          <div className="hero-rise mt-12 hidden lg:block" style={rise(180)}>
            <Terminal
              title="~/northwind/billing"
              start={420}
              lines={[
                { kind: "agent", text: "The migration plan is ready. Publishing it for the team." },
                { kind: "cmd", text: "npx htmlartifact upload plan.html" },
                { kind: "out", text: "Published version 3", tone: "pass" },
                { kind: "out", text: `https://htmlartifact.pages.dev/d/${HERO_ID}` },
                { kind: "out", text: "Workspace: Northwind (members only)", tone: "dim" }
              ]}
            />
          </div>
        </div>
        <div className="hero-rise" style={rise(160)}>
          <ArtifactStage />
          <Terminal
            className="mt-8 lg:hidden"
            title="~/northwind/billing"
            animate={false}
            lines={[
              { kind: "cmd", text: "npx htmlartifact upload plan.html" },
              { kind: "out", text: "Published version 3", tone: "pass" },
              { kind: "out", text: `htmlartifact.pages.dev/d/${HERO_ID}` }
            ]}
          />
        </div>
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
    body: "You're its admin. Invite codes expire after 7 days and stop at their use limit.",
    lines: [{ cmd: 'npx htmlartifact workspace create "Northwind"' }, { cmd: "npx htmlartifact workspace invite" }, { out: "Invite code: HA-7KQ2-MX9P-4TRA" }]
  },
  {
    title: "Your team joins",
    body: "With the code, or by opening the /join link the invite prints.",
    lines: [{ cmd: "npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA" }]
  },
  {
    title: "Anyone publishes",
    body: "Upload the same file again and the link gets a new version, not a new URL.",
    lines: [{ cmd: "npx htmlartifact upload plan.html" }]
  }
];

function Steps() {
  return (
    <section className="border-y border-rule bg-paper-2">
      <div className={`${shell} py-20 sm:py-28`}>
        <SectionHead title="Four steps, all in the terminal." body="No dashboard to set up first. The whole flow runs where your agent already works, so it can run every step itself." />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col bg-paper-2 p-5 sm:p-7">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[12.5px] text-fog">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-wide text-[19px] font-[680] tracking-[-0.015em] text-ink">{step.title}</h3>
              </div>
              <p className="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-fog">{step.body}</p>
              <pre className="mt-5 whitespace-pre-wrap break-words rounded-control bg-paper-3 px-4 py-3 text-[11.5px] leading-[1.8] text-ink ring-1 ring-rule sm:text-[12.5px]">
                {step.lines.map((l, j) =>
                  "cmd" in l ? (
                    <span key={j} className="block">
                      <span aria-hidden className="select-none text-intaglio">
                        ${" "}
                      </span>
                      {l.cmd}
                    </span>
                  ) : (
                    <span key={j} className="block text-fog">
                      {l.out}
                    </span>
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
  ["Checked on every request", "Membership is confirmed with WorkOS, not read from a token alone. Remove someone and their access ends at once."],
  ["Scripts stay in a sandbox", "Artifact HTML runs on a separate origin under a strict CSP, so a page with scripts can't read your session."],
  ["Invites are for admins", "Only admins create invite codes. Codes expire after 7 days by default and stop at their use limit."],
  ["Deleted means erased", "Delete an artifact and the HTML of every version is erased, not hidden."]
] as const;

function Access() {
  return (
    <section className={`${shell} py-20 sm:py-28`}>
      <div className="grid gap-12 *:min-w-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <SectionHead
          title="Everyone else gets nothing."
          body="No blurred preview, no request-access page. Outside the workspace, the link tells the person holding it nothing, not even that it exists."
        />
        <div>
          <div className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <div className="flex items-center gap-3 border-b border-rule bg-paper-3/50 px-5 py-3 font-mono text-[12px] text-fog">
              <span className="font-medium text-ink">GET</span>
              <span className="truncate">/d/{HERO_ID}</span>
            </div>
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">What htmlartifact returns for one artifact link, by who asks</caption>
              <thead className="sr-only">
                <tr>
                  <th>Who</th>
                  <th>Status</th>
                  <th>What they get</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {LOG.map((row) => (
                  <tr key={row.who + row.detail}>
                    <td className="py-3.5 pl-5 pr-3 align-top">
                      <span className="font-medium text-ink">{row.who}</span>
                      <span className="block text-[13px] text-fog">{row.detail}</span>
                    </td>
                    <td className="w-14 px-2 py-3.5 align-top font-mono text-[13px] font-medium tabular-nums" style={{ color: `var(--${row.tone})` }}>
                      {row.status}
                    </td>
                    <td className="py-3.5 pl-2 pr-5 align-top text-ink-2">{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13.5px] leading-relaxed text-fog">
            Sam and Dan get, byte for byte, the page a link that never existed gets. A URL can't be used to probe what exists.
          </p>
        </div>
      </div>
      <dl className="mt-16 grid gap-x-10 gap-y-8 border-t border-rule pt-10 sm:grid-cols-2 lg:grid-cols-4">
        {FACTS.map(([title, body]) => (
          <div key={title}>
            <dt className="font-wide text-[16px] font-[680] tracking-[-0.01em] text-ink">{title}</dt>
            <dd className="mt-2 text-[14.5px] leading-relaxed text-fog">{body}</dd>
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

const AGENT_FEATURES = [
  ["--json on every command", "Structured output an agent can parse, errors included."],
  ["read <url>", "Agents fetch a teammate's artifact with your sign-in, so a link pasted into a chat works for them too."],
  ["check <path>", "Validates the HTML against the publishing rules without publishing."],
  ["Workspace API keys", "For CI: an admin creates one, and the pipeline publishes with HTMLARTIFACT_TOKEN instead of a browser sign-in."]
] as const;

function ForAgents() {
  return (
    <section className="border-y border-rule bg-paper-2">
      <div className={`${shell} grid gap-12 py-20 *:min-w-0 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <div>
          <SectionHead title="Made for agents to drive." body="Add a few lines to CLAUDE.md or AGENTS.md and your agent publishes on its own." />
          <dl className="mt-10 space-y-6">
            {AGENT_FEATURES.map(([term, body]) => (
              <div key={term}>
                <dt className="font-mono text-[13px] font-medium text-ink">{term}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-fog">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="space-y-5">
          <div className="overflow-hidden rounded-card border border-rule bg-paper">
            <div className="flex items-center justify-between border-b border-rule py-1.5 pl-5 pr-1.5">
              <span className="font-mono text-[12px] text-fog">CLAUDE.md</span>
              <CopyText text={AGENT_SNIPPET} />
            </div>
            <pre className="overflow-x-auto px-5 py-4 text-[11.5px] leading-[1.8] text-ink-2 sm:text-[12.5px]">{AGENT_SNIPPET}</pre>
          </div>
          <Terminal
            animate={false}
            wrap={false}
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

const OWN = [
  ["Free", "The hosted service at htmlartifact.pages.dev runs on free tiers. No card, no trial."],
  ["Open source", "MIT licensed. Read the code, or send a pull request."],
  ["Yours to run", "One Cloudflare Worker and a D1 database, with WorkOS for accounts. All on free tiers."]
] as const;

function Closing() {
  return (
    <section className="dark relative isolate overflow-hidden bg-paper text-ink">
      <div aria-hidden className="pointer-events-none absolute -right-40 top-1/2 -z-10 hidden -translate-y-1/2 opacity-30 md:block">
        <Seal id="members-only" size={560} />
      </div>
      <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[image:var(--foil)]" />
      <div className={`${shell} py-20 sm:py-24`}>
        <h2 className="max-w-[18ch] font-expanded text-title font-[800] tracking-[-0.035em] text-ink">Give your agents somewhere private to publish.</h2>
        <div className="mt-9 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <CopyCommand command="npx htmlartifact login" size="lg" tone="ink" className="w-full sm:w-auto" />
          <a href={REPO_URL} className="text-[15px] font-medium text-ink-2 underline decoration-rule-2 underline-offset-4 hover:text-ink hover:decoration-ink sm:hidden">
            View on GitHub
          </a>
          <ButtonLink href={REPO_URL} tone="ghost" size="lg" className="max-sm:hidden">
            View on GitHub
          </ButtonLink>
        </div>
        <dl className="mt-14 grid max-w-[880px] gap-x-10 gap-y-6 border-t border-rule pt-8 sm:grid-cols-3">
          {OWN.map(([title, body]) => (
            <div key={title}>
              <dt className="font-wide text-[15.5px] font-[680] text-ink">{title}</dt>
              <dd className="mt-1.5 text-[14px] leading-relaxed text-fog">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function SectionHead({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-[40rem]">
      <h2 className="text-balance font-wide text-title font-[740] tracking-[-0.03em] text-ink">{title}</h2>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-fog">{body}</p>
    </div>
  );
}
