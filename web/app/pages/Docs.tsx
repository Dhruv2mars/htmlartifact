import type { ReactNode } from "react";
import { CopyText } from "../components/CopyText";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import type { Session } from "../page";

const SECTIONS = [
  { id: "start", title: "Get started" },
  { id: "agents", title: "With an agent" },
  { id: "commands", title: "Commands" },
  { id: "access", title: "Who can see what" },
  { id: "ci", title: "CI" },
  { id: "publishing", title: "What you can publish" },
  { id: "self-host", title: "Run your own" }
];

const COMMANDS: Array<[string, ReactNode]> = [
  ["login · logout · whoami", "Sign in or create an account. Show who you are and your current workspace."],
  ["workspace create <name>", "Start a workspace. You're its admin."],
  ["workspace invite", <>Make an invite code and join link (admins). <Flag>--max-uses</Flag>, <Flag>--days</Flag>.</>],
  ["workspace join <code>", "Join a workspace with an invite code."],
  ["workspace list · switch <name>", "Your workspaces, and change the current one."],
  ["workspace members · remove <email>", "See members, or remove one (admins). Their access ends immediately."],
  ["upload <file-or-folder>", <>Publish. Uploading the same path again publishes a new version at the same URL. <Flag>--slug &lt;name&gt;</Flag> gives a stable URL within the workspace.</>],
  ["read <url>", "Download an artifact with your sign-in. This is how agents read links."],
  ["list [--all]", "Your artifacts, or the whole workspace's."],
  ["delete <id-or-url>", "Delete an artifact. The HTML of every version is erased."],
  ["workspace delete --confirm <name>", "Delete the current workspace and everything in it (admins)."],
  ["workspace sso · directory · domains", "A WorkOS Admin Portal link for your IT admin: SSO (SAML or OIDC), SCIM directory sync, or domain verification (admins). SSO and directory links are off unless the deployment sets HTMLARTIFACT_ENTERPRISE_CONNECTIONS=on, because WorkOS bills each connection."],
  ["check <path>", "Validate against the publishing rules without publishing."]
];

const AGENT_SNIPPET = `## Sharing work with the team
When you write a plan, spec, review or report as HTML,
publish it so the team can open it:

  npx htmlartifact upload <file> --json

Share the "url" it returns. To read a link a teammate
shared with you:

  npx htmlartifact read <url>`;

export function Docs({ session }: { session: Session | null }) {
  return (
    <div>
      <SiteHeader session={session} current="docs" />
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-28 pt-10 *:min-w-0 sm:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:pt-16">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-8">
            <p className="text-[13px] font-medium text-ink">On this page</p>
            <ul className="mt-3 space-y-1 border-l border-rule text-[14px]">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1 pl-4 text-fog transition-colors duration-150 hover:border-ink hover:text-ink">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="max-w-[46rem]">
          <h1 className="font-wide text-title font-[740] tracking-[-0.03em] text-ink">Docs</h1>
          <p className="mt-5 text-[18px] leading-relaxed text-ink-2">
            htmlartifact publishes HTML from coding agents (plans, specs, reviews, reports, mocks) to your workspace. Everyone in
            the workspace can open it; nobody else can. Everything works from a terminal, so an agent can run the whole flow.
          </p>

          <Section id="start" title="Get started">
            <p>One person signs in, starts a workspace and invites the team. Everyone else signs in and joins. Then anyone can publish.</p>
            <Code
              code={`# 1. Sign in or create an account (opens a browser once; works over SSH)
npx htmlartifact login

# 2. One person creates the workspace and invites people
npx htmlartifact workspace create "Northwind"
npx htmlartifact workspace invite          # → HA-7KQ2-MX9P-4TRA

# 3. Everyone else joins with the code
npx htmlartifact login
npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA

# 4. Anyone publishes; every member can open the link
npx htmlartifact upload plan.html          # → https://…/d/k3j9x0a1b2c4
npx htmlartifact read https://…/d/k3j9x0a1b2c4`}
            />
            <p>
              Prefer a browser? Sign in on the web, join with a code or a <code>/join/&lt;code&gt;</code> link, and browse your
              workspace's artifacts there.
            </p>
          </Section>

          <Section id="agents" title="With an agent">
            <p>
              Add this to your project's <code>CLAUDE.md</code> or <code>AGENTS.md</code>. Every command also takes{" "}
              <code>--json</code>, so the agent gets structured output, errors included.
            </p>
            <Code code={AGENT_SNIPPET} label="CLAUDE.md" />
            <p>
              The first <code>upload</code> needs a signed-in machine. Run <code>npx htmlartifact login</code> once yourself; the agent
              uses that sign-in from then on.
            </p>
          </Section>

          <Section id="commands" title="Commands">
            <p>
              Run any of these with <code>npx htmlartifact</code>.
            </p>
            <dl className="mt-6 divide-y divide-rule border-y border-rule">
              {COMMANDS.map(([cmd, body]) => (
                <div key={cmd} className="grid gap-1.5 py-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-6">
                  <dt className="font-mono text-[12.5px] leading-6 text-ink">{cmd}</dt>
                  <dd className="text-[15px] leading-relaxed text-fog">{body}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="access" title="Who can see what">
            <ul className="list-none space-y-4 pl-0">
              <Point title="An artifact belongs to the workspace it was published in.">
                Only active members of that workspace can open it, in a browser or with a token.
              </Point>
              <Point title="Signed-out visitors are sent to sign in.">
                Members of other workspaces get a 404 that looks exactly like a missing page, so a URL reveals nothing.
              </Point>
              <Point title="Membership is confirmed with WorkOS,">
                not taken from a token alone. It's cached for 5 minutes, and WorkOS webhooks revoke it at once when someone is removed.
              </Point>
              <Point title="Artifact HTML runs under a strict CSP.">
                It's served from a separate sandbox origin, so pages with scripts can't read your session or act as the app.
              </Point>
              <Point title="Only admins can create invite codes.">Codes expire (7 days by default) and have a use limit.</Point>
            </ul>
          </Section>

          <Section id="ci" title="CI">
            <p>
              In CI, set <code>HTMLARTIFACT_TOKEN</code> to a WorkOS organization API key instead of signing in. Uploads from CI land in
              that organization's workspace.
            </p>
            <Code code={`HTMLARTIFACT_TOKEN=sk_test_… npx htmlartifact upload report.html --json`} />
          </Section>

          <Section id="publishing" title="What you can publish">
            <p>
              A single <code>.html</code> file, or a folder of pages with an <code>index.html</code>. Run <code>check</code> first to see
              whether it passes the rules (size limits, page count, markup) without publishing anything. Each workspace holds up to 50 MiB of
              HTML across all versions; delete old artifacts to make room.
            </p>
            <Code code={`npx htmlartifact check ./report\nnpx htmlartifact upload ./report --slug q4-report`} />
            <p>
              Re-uploading the same path publishes a new version at the same URL, and every earlier version stays available from its
              history.
            </p>
          </Section>

          <Section id="self-host" title="Run your own">
            <p>
              htmlartifact is one Cloudflare Worker: Workers for the API, web pages and artifact serving, D1 for the index and the
              artifact HTML, and WorkOS AuthKit for accounts and workspaces. It runs on free tiers. The{" "}
              <a href={`${REPO_URL}#deploying-later`}>README</a> walks through setting it up, and{" "}
              <a href={`${REPO_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> covers data handling.
            </p>
            <Code code={`bun install\nbun run dev:local   # WorkOS emulator + Worker at http://localhost:8787, fully offline`} />
          </Section>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="docs-prose mt-16 scroll-mt-8">
      <h2 className="font-wide text-[24px] font-[700] tracking-[-0.02em] text-ink">
        <a href={`#${id}`} className="hover:text-intaglio">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-l-2 border-rule pl-4">
      <strong className="font-medium text-ink">{title}</strong> {children}
    </li>
  );
}

function Flag({ children }: { children: ReactNode }) {
  return <code className="whitespace-nowrap">{children}</code>;
}

// Shell blocks: comments dimmed, nothing else coloured.
function Code({ code, label }: { code: string; label?: string }) {
  return (
    <div className="my-6 overflow-hidden rounded-2xl border border-rule bg-paper-2">
      <div className="flex items-center justify-between border-b border-rule py-1.5 pl-4 pr-1.5">
        <span className="font-mono text-[11.5px] text-fog">{label ?? "shell"}</span>
        <CopyText text={code.replace(/\s+#.*$/gm, "").replace(/^#.*\n?/gm, "").trim()} />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12.5px] leading-[1.85] text-ink-2">
        {code.split("\n").map((line, i) => {
          const hash = line.indexOf("#");
          const isComment = hash === 0 || (hash > 0 && /\s{2,}#/.test(line));
          return (
            <div key={i}>
              {isComment && hash > 0 ? (
                <>
                  {line.slice(0, hash)}
                  <span className="text-fog/80">{line.slice(hash)}</span>
                </>
              ) : isComment ? (
                <span className="text-fog/80">{line}</span>
              ) : (
                line || " "
              )}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
