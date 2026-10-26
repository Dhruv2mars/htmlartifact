import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { CopyText } from "../components/CopyText";
import { ChevronDown } from "../components/icons";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import { cx } from "../lib/cx";
import type { Session } from "../page";

type Toc = ReadonlyArray<{ id: string; title: string }>;

const SECTIONS: Toc = [
  { id: "start", title: "Get started" },
  { id: "agents", title: "With an agent" },
  { id: "commands", title: "Commands" },
  { id: "access", title: "Who can see what" },
  { id: "ci", title: "CI" },
  { id: "publishing", title: "What you can publish" },
  { id: "self-host", title: "Run your own" }
];

// Command names: a space is where a line may break, so a flag never splits
// from its value (they're joined by a no-break space) or at its hyphens.
type Command = { names: string[]; body: ReactNode };
const NB = " ";

const COMMAND_GROUPS: Array<{ id: string; title: string; note?: string; commands: Command[] }> = [
  {
    id: "account",
    title: "Account",
    commands: [
      { names: ["login"], body: "Sign in, or create an account, in your browser. Over SSH, open the link it prints on any device." },
      { names: ["logout"], body: "Sign out and forget the saved sign-in on this machine." },
      { names: ["whoami"], body: "Show who you're signed in as and your current workspace." }
    ]
  },
  {
    id: "workspaces",
    title: "Workspaces and members",
    commands: [
      { names: ["workspace create <name>"], body: "Create a workspace and switch to it. You become its admin." },
      {
        names: ["workspace join <code>"],
        body: (
          <>
            Join a workspace with an invite code or its <code>/join/</code> link, and switch to it.
          </>
        )
      },
      { names: ["workspace list"], body: "List your workspaces. The current one is marked with an asterisk." },
      { names: ["workspace switch <name>"], body: "Make another of your workspaces the current one." },
      { names: ["workspace members"], body: "List the members of the current workspace." },
      { names: ["workspace leave"], body: "Leave the current workspace. Its last admin must promote someone else first." }
    ]
  },
  {
    id: "publishing-commands",
    title: "Publishing and reading",
    commands: [
      {
        names: ["upload <file-or-folder>"],
        body: (
          <>
            Publish a file or folder. Uploading the same path again publishes a new version at the same URL.{" "}
            <code>--slug &lt;name&gt;</code> gives it a stable URL within the workspace, and <code>--description &lt;text&gt;</code>{" "}
            sets a short description.
          </>
        )
      },
      {
        names: ["read <url-or-id>"],
        body: (
          <>
            Download an artifact's HTML with your sign-in, from any workspace you're in. This is how agents read links.{" "}
            <code>--out &lt;file&gt;</code> chooses where it's saved.
          </>
        )
      },
      {
        names: ["list"],
        body: (
          <>
            List your artifacts in the current workspace. <code>--all</code> lists everyone's, and <code>--workspace &lt;name&gt;</code>{" "}
            lists another of your workspaces.
          </>
        )
      },
      {
        names: ["check <path>"],
        body: "Validate a file or folder against the publishing rules and show your limits and storage. It never publishes; signed out or offline, it checks the markup only."
      },
      { names: ["delete <id-or-url>"], body: "Delete an artifact and every version of its HTML. Its author or a workspace admin can delete it." },
      {
        names: [`prune <id-or-url> --keep${NB}<n>`],
        body: "Delete an artifact's old versions, keeping the latest n, to free workspace storage."
      }
    ]
  },
  {
    id: "automation",
    title: "CI and automation",
    note: "Workspace admins only.",
    commands: [
      {
        names: ["workspace api-key create"],
        body: (
          <>
            Create an API key to use as <code>HTMLARTIFACT_TOKEN</code>. It's shown once. <code>--name &lt;label&gt;</code> names it.
          </>
        )
      },
      { names: ["workspace api-key list"], body: "List the workspace's live API keys." },
      { names: ["workspace api-key revoke <id>"], body: "Revoke a key so it stops working." }
    ]
  },
  {
    id: "admin",
    title: "Admin",
    note: "Workspace admins only.",
    commands: [
      {
        names: ["workspace invite"],
        body: (
          <>
            Create an invite code and join link. <code>--days</code> sets when it expires (1 to 30, default 7) and{" "}
            <code>--max-uses</code> how many people can use it (default 50).
          </>
        )
      },
      {
        names: ["workspace invites"],
        body: (
          <>
            List live invite codes. <code>--all</code> adds used, expired and revoked codes and who joined;{" "}
            <code>--revoke &lt;code&gt;</code> revokes one, and <code>--revoke all</code> every live code.
          </>
        )
      },
      {
        names: ["workspace remove <email>"],
        body: "Remove a member. Their access ends immediately, and every invite code issued until then is revoked, so share a fresh one with the team."
      },
      {
        names: ["workspace promote <email>", "workspace demote <email>"],
        body: "Make a member an admin, or an admin a member. One admin always remains."
      },
      {
        names: [`workspace delete --confirm${NB}<name>`],
        body: (
          <>
            Delete the current workspace and everything in it. <code>--confirm</code> takes the workspace's exact name.
          </>
        )
      },
      {
        names: ["workspace sso", "workspace directory", "workspace domains"],
        body: (
          <>
            A WorkOS Admin Portal link for your IT admin: set up SSO (SAML or OIDC), connect a SCIM directory, or verify your email
            domain. SSO and directory links are off unless the deployment sets{" "}
            <code className="whitespace-normal wrap-anywhere">HTMLARTIFACT_ENTERPRISE_CONNECTIONS=on</code>, because WorkOS bills
            each connection.
          </>
        )
      }
    ]
  }
];

const EXIT_CODES: Array<[string, string]> = [
  ["0", "Success."],
  ["1", "Any other failure: a server error, a conflict or a local file."],
  ["2", "Usage: bad arguments or flags."],
  ["3", "Auth: not signed in, sign-in expired, token rejected, or not allowed."],
  ["4", "Not found: no such artifact, workspace, member or path."],
  ["5", "Validation: the HTML (or another input) was refused."],
  ["6", "Network: htmlartifact couldn't be reached."],
  ["7", "Rate limited: still refused after waiting out Retry-After once."],
  ["130", "Interrupted (Ctrl-C)."]
];

const AGENT_SNIPPET = `## Sharing work with the team
When you write a plan, spec, review or report as HTML, publish it so the team can open it: run \`npx htmlartifact upload <file> --json\` and share the "url" it returns.

To read a link a teammate shared with you, run \`npx htmlartifact read <url>\`.`;

const WORKFLOW = `name: Publish report
on:
  push:
    branches: [main]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npx --yes htmlartifact upload report.html --slug report
        env:
          HTMLARTIFACT_TOKEN: \${{ secrets.HTMLARTIFACT_TOKEN }}`;

export function Docs({ session }: { session: Session | null }) {
  return (
    <ReadingPage
      session={session}
      current="docs"
      title="Docs"
      intro="htmlartifact publishes the HTML your coding agents write (plans, specs, reviews, reports, mocks) to your team's workspace. Everyone in the workspace can open it; nobody else can. Everything works from a terminal, so an agent can run the whole flow."
      sections={SECTIONS}
    >
      <Section toc={SECTIONS} id="start">
        <p>
          You need Node.js 20.10 or later; <code>npx</code> fetches the CLI. One person sets up the workspace, everyone else joins it,
          then anyone in it can publish.
        </p>
        <ol className="mt-8 space-y-10">
          <Step id="start-workspace" title="Start a workspace" who="One person">
            <p>
              Sign in (a browser opens once; over SSH, open the link on any device), create the workspace and make an invite. You
              become its admin.
            </p>
            <Code
              label="Terminal"
              name="Commands to start a workspace"
              commands={["npx htmlartifact login", 'npx htmlartifact workspace create "Northwind"', "npx htmlartifact workspace invite"]}
              note={
                <>
                  <code>invite</code> prints a code like <code>HA-7KQ2-MX9P-4TRA</code> and a join link. Send either one to your team.
                </>
              }
            />
          </Step>
          <Step id="join-workspace" title="Join it" who="Everyone else">
            <p>Each teammate signs in and joins with the code.</p>
            <Code
              label="Terminal"
              name="Commands to join a workspace"
              commands={["npx htmlartifact login", "npx htmlartifact workspace join HA-7KQ2-MX9P-4TRA"]}
              note="Or open the join link in a browser and join there."
            />
          </Step>
          <Step id="publish" title="Publish" who="Any member">
            <p>Publish an HTML file or a folder of pages. Every member can open the link it prints; nobody else can.</p>
            <Code
              label="Terminal"
              name="Command to publish a file"
              commands={["npx htmlartifact upload plan.html"]}
              note="Upload the same file again to publish a new version at the same link."
            />
          </Step>
        </ol>
        <p className="mt-10">
          Prefer a browser? Sign in on the web, join with a code or a <code>/join/&lt;code&gt;</code> link, and browse your workspace's
          artifacts there.
        </p>
      </Section>

      <Section toc={SECTIONS} id="agents">
        <p>
          Add this to your project's <code>CLAUDE.md</code> or <code>AGENTS.md</code> so your agent publishes what it writes and reads
          the links your team shares.
        </p>
        <Code label="CLAUDE.md" name="Instructions for your agent" code={AGENT_SNIPPET} />
        <p>
          The agent uses your sign-in, so run <code>npx htmlartifact login</code> once on that machine first. Every command also takes{" "}
          <code>--json</code>: the agent gets one JSON object, errors included, and an exit code that says what went wrong (see{" "}
          <a href="#output">Output and exit codes</a>).
        </p>
      </Section>

      <Section toc={SECTIONS} id="commands">
        <p>
          Run any of these with <code>npx htmlartifact</code>, for example <code>npx htmlartifact whoami</code>. Add{" "}
          <code>--help</code> to any command to see all of its flags.
        </p>
        {COMMAND_GROUPS.map((group) => (
          <div key={group.id} id={group.id} className="mt-10 scroll-mt-[8.5rem] lg:scroll-mt-24">
            <h3 className={H3}>{group.title}</h3>
            {group.note && <p className="mt-1 text-[14px] text-fog">{group.note}</p>}
            <dl className="mt-4 divide-y divide-rule border-y border-rule">
              {group.commands.map((c) => (
                <div key={c.names[0]} className="grid gap-1.5 py-3.5 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="min-w-0 text-[13px] leading-6 text-ink">
                    {c.names.map((name) => (
                      <code key={name} className="block">
                        {name.split(" ").map((token, i) => (
                          <Fragment key={i}>
                            {i > 0 && " "}
                            <span className="whitespace-nowrap">{token}</span>
                          </Fragment>
                        ))}
                      </code>
                    ))}
                  </dt>
                  <dd className="min-w-0 text-[15px] leading-relaxed text-ink-2">{c.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <div id="output" className="mt-10 scroll-mt-[8.5rem] lg:scroll-mt-24">
          <h3 className={H3}>Output and exit codes</h3>
          <p>
            Every command takes <code>--json</code>. Standard output is then one JSON object, errors included, and anything else goes
            to standard error. Each command exits with one of these codes:
          </p>
          <dl className="mt-4 divide-y divide-rule border-y border-rule">
            {EXIT_CODES.map(([code, meaning]) => (
              <div key={code} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 py-2">
                <dt className="text-[13px] leading-6 text-ink">
                  <code>{code}</code>
                </dt>
                <dd className="min-w-0 text-[15px] leading-relaxed text-ink-2">{meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section toc={SECTIONS} id="access">
        <Facts>
          <Fact title="An artifact belongs to the workspace it was published in.">
            Only active members of that workspace can open it, in a browser or with a token.
          </Fact>
          <Fact title="Signed-out visitors are sent to sign in.">
            Members of other workspaces get a 404 that looks exactly like a missing page, so a URL reveals nothing.
          </Fact>
          <Fact title="Membership is checked with WorkOS,">
            not taken from a token alone. It's cached for at most 5 minutes, and WorkOS webhooks end it at once when someone is
            removed.
          </Fact>
          <Fact title="Artifact HTML runs in a sandbox.">
            It's served from a separate origin under a strict CSP, so scripts in a page can't read your session or act as the app.
          </Fact>
          <Fact title="Only admins can create invite codes.">
            Codes expire (7 days by default) and have a use limit. Removing a member revokes every code issued until then.
          </Fact>
        </Facts>
        <p>
          <a href={`${REPO_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> has the details: where each item is stored, how deletion works
          and how incidents are handled.
        </p>
      </Section>

      <Section toc={SECTIONS} id="ci">
        <p>
          In CI, set <code>HTMLARTIFACT_TOKEN</code> to a workspace API key instead of signing in. A workspace admin creates one; it's
          shown only once.
        </p>
        <Code
          label="Terminal"
          name="Command to create an API key"
          commands={['npx htmlartifact workspace api-key create --name "GitHub Actions"']}
        />
        <p>
          Save it as a repository secret named <code>HTMLARTIFACT_TOKEN</code>, then publish from a workflow:
        </p>
        <Code label=".github/workflows/publish-report.yml" name="GitHub Actions workflow" code={WORKFLOW} hang />
        <p>
          Give the upload a <code>--slug</code> (or <code>--draft &lt;id&gt;</code>) so every run updates the same URL. Without one, each
          run publishes a new artifact: a re-upload finds its artifact through a path mapping kept in <code>~/.htmlartifact</code>, and
          a CI run throws that away.
        </p>
        <p>
          The key publishes as the workspace (artifacts show the key's name) and can't manage it. It works until it's revoked with{" "}
          <code>workspace api-key revoke</code>, the admin who created it leaves or stops being an admin, or the workspace is
          deleted.
        </p>
      </Section>

      <Section toc={SECTIONS} id="publishing">
        <p>
          A single <code>.html</code> file, or a folder of pages with an <code>index.html</code>. Run <code>check</code> first: it applies
          the same rules as <code>upload</code>, reports problems with line numbers, and publishes nothing.
        </p>
        <Code
          label="Terminal"
          name="Commands to check and publish a folder"
          commands={["npx htmlartifact check ./report", "npx htmlartifact upload ./report --slug q4-report"]}
        />
        <ul className="list-disc space-y-2 pl-5 marker:text-fog">
          <li>
            Pages must be self-contained. Inline scripts and styles run; external scripts, forms, iframes and embeds are refused, and
            linked stylesheets need https URLs.
          </li>
          <li>Scripts run in a sandbox without network access, storage or cookies, so put the data a page needs in the page.</li>
          <li>
            On the hosted service an upload can hold 10 pages and 1 MiB, and each workspace holds 50 MiB of HTML across all versions.{" "}
            <code>check</code> and <code>list</code> show what's used and what's left.
          </li>
        </ul>
        <p>
          Re-uploading the same path publishes a new version at the same URL, and every earlier version stays available from its
          history. To free space, <code>prune</code> old versions or <code>delete</code> artifacts you no longer need.
        </p>
      </Section>

      <Section toc={SECTIONS} id="self-host">
        <p>
          The CLI uses the hosted service at htmlartifact.pages.dev. You can also run your own: htmlartifact is open source (MIT), one
          Worker bundle on Cloudflare (Pages and D1) with WorkOS AuthKit for accounts and workspaces, built to stay on free tiers. The{" "}
          <a href={`${REPO_URL}#deploying`}>README</a> walks through deploying it, and{" "}
          <a href={`${REPO_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> covers data handling.
        </p>
        <Code
          label="Terminal"
          name="Commands to run htmlartifact locally"
          commands={[`git clone ${REPO_URL}`, "cd htmlartifact", "bun install", "bun run dev:local"]}
          note={
            <>
              <code>dev:local</code> starts a WorkOS emulator and the Worker at <code>http://localhost:8787</code>, fully offline.
            </>
          }
        />
        <p>
          Point the CLI at your deployment with <code>HTMLARTIFACT_API_URL</code>. On your own deployment, a WorkOS organization API key
          also works as <code>HTMLARTIFACT_TOKEN</code>.
        </p>
      </Section>
    </ReadingPage>
  );
}

const H3 = "font-wide text-[17px] font-[680] leading-snug tracking-[-0.01em] text-ink";

// The reading system for /docs and /privacy: one ~68ch column, an "On this
// page" index that is a sticky sidebar on desktop and a sticky disclosure on
// smaller screens, marking the section in view once the page has hydrated.
export function ReadingPage({
  session,
  current,
  title,
  intro,
  sections,
  children
}: {
  session: Session | null;
  current?: "docs" | "privacy";
  title: string;
  intro: ReactNode;
  sections: Toc;
  children: ReactNode;
}) {
  const active = useActiveSection(sections);
  return (
    <div>
      {/* The header and the mobile index stick as one block, so the index
          sits flush under the header without guessing its height. (The
          header's own sticky is switched off inside it: nested sticky
          layers with backdrop blur break full-page screenshots.) */}
      <div className="sticky top-0 z-20 [&>header]:static">
        <SiteHeader session={session} current={current} />
        <MobileToc sections={sections} active={active} />
      </div>
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 sm:px-8 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-16 lg:pt-16 xl:gap-24">
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-24">
              <p className="text-[13px] font-medium text-ink">On this page</p>
              <ol className="mt-3 border-l border-rule">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={active === s.id ? "true" : undefined}
                      className="-ml-px flex gap-3 border-l-2 border-transparent py-1.5 pl-4 text-[14px] leading-snug text-ink-2 transition-colors duration-150 hover:text-ink aria-[current=true]:border-intaglio aria-[current=true]:font-medium aria-[current=true]:text-ink"
                    >
                      <Serial n={i} />
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
          <article className="docs-prose min-w-0 max-w-[68ch]">
            <h1 className="font-wide text-page font-[740] tracking-[-0.03em] text-ink">{title}</h1>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">{intro}</p>
            {children}
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function MobileToc({ sections, active }: { sections: Toc; active: string | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close after a jump, on Escape, and on a tap outside.
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const outside = (e: PointerEvent) => {
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const current = sections.find((s) => s.id === active);
  return (
    <details
      ref={ref}
      className="group relative border-b border-rule bg-paper/90 backdrop-blur-md backdrop-saturate-150 lg:hidden"
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="mx-auto flex h-12 max-w-[1240px] cursor-pointer list-none items-center gap-2 px-5 text-[14px] focus-visible:outline-offset-[-3px] sm:px-8 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-medium text-ink">On this page</span>
        {current && (
          <>
            <span aria-hidden className="text-fog">
              /
            </span>
            <span className="min-w-0 truncate text-ink-2">{current.title}</span>
          </>
        )}
        <ChevronDown className="ml-auto size-4 shrink-0 text-fog transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <nav
        aria-label="On this page"
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-8rem)] overflow-y-auto border-b border-rule bg-paper-2 shadow-pop"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
      >
        <ol className="mx-auto max-w-[1240px] px-2 py-2 sm:px-5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
                className="flex h-11 items-center gap-3 rounded-control px-3 text-[15px] text-ink-2 hover:bg-wash hover:text-ink aria-[current=true]:bg-wash aria-[current=true]:font-medium aria-[current=true]:text-ink"
              >
                <Serial n={i} />
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}

// The section whose top has passed just under the sticky chrome; at the very
// bottom, the last one (it may be too short to reach the top).
function useActiveSection(sections: Toc): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      let id: string | null = null;
      for (const el of els) if (el.getBoundingClientRect().top <= 150) id = el.id;
      const root = document.documentElement;
      if (id && window.scrollY + window.innerHeight >= root.scrollHeight - 2) id = els[els.length - 1]!.id;
      setActive(id);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [sections]);
  return active;
}

function Serial({ n }: { n: number }) {
  return (
    <span aria-hidden className="font-mono text-[12px] font-normal tabular-nums text-fog font-condensed">
      {String(n + 1).padStart(2, "0")}
    </span>
  );
}

// A numbered section with an ink heading; the heading links to itself and
// shows a "#" on hover or focus.
export function Section({ toc, id, children }: { toc: Toc; id: string; children: ReactNode }) {
  const index = toc.findIndex((s) => s.id === id);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-12 scroll-mt-[8.5rem] border-t border-rule pt-8 lg:mt-16 lg:scroll-mt-24">
      <h2 id={`${id}-h`} className="flex items-baseline gap-3 font-wide text-[24px] font-[700] leading-tight tracking-[-0.02em] text-ink">
        <Serial n={index} />
        <a href={`#${id}`} className="group/h min-w-0 rounded-[4px]">
          {toc[index]!.title}
          <span aria-hidden className="ml-2 text-fog opacity-0 transition-opacity duration-150 group-hover/h:opacity-100 group-focus-visible/h:opacity-100">
            #
          </span>
        </a>
      </h2>
      {children}
    </section>
  );
}

function Step({ id, title, who, children }: { id: string; title: string; who: string; children: ReactNode }) {
  return (
    <li id={id} className="scroll-mt-[8.5rem] lg:scroll-mt-24">
      <h3 className={cx(H3, "flex flex-wrap items-center gap-x-2.5 gap-y-1")}>
        {title}
        <span className="rounded-chip border border-rule-2 px-1.5 py-px font-sans text-[12px] font-medium tracking-normal text-fog font-stretch-normal">
          {who}
        </span>
      </h3>
      {children}
    </li>
  );
}

// Plain facts with a lead sentence, between hairlines.
export function Facts({ children }: { children: ReactNode }) {
  return <ul className="mt-5 divide-y divide-rule border-y border-rule">{children}</ul>;
}

export function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="py-3.5">
      <strong className="font-medium text-ink">{title}</strong> {children}
    </li>
  );
}

// A copyable block that never scrolls sideways. Commands get a "$" prompt;
// file lines keep their indentation. Long lines wrap, with continuation
// lines hung 2ch deeper (`hang`) so structure stays readable on a phone.
// Copy takes exactly what you'd paste: no prompts, original line breaks.
function Code(
  props: { label: string; name: string } & (
    | { commands: string[]; note?: ReactNode; code?: never }
    | { code: string; hang?: boolean; commands?: never }
  )
) {
  const text = props.commands ? props.commands.join("\n") : props.code;
  return (
    <figure aria-label={props.name} className="mt-5 overflow-hidden rounded-card border border-rule bg-paper-2">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-rule pl-4 pr-1">
        <span className="min-w-0 truncate font-mono text-[12px] text-fog font-condensed">{props.label}</span>
        <CopyText text={text} />
      </div>
      {props.commands ? (
        <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[12.5px] leading-[1.75] text-ink sm:text-[13px]">
          {props.commands.map((c) => (
            <span key={c} className="block pl-[2ch] -indent-[2ch]">
              <span aria-hidden className="select-none text-fog">
                ${" "}
              </span>
              <Words text={c} />
            </span>
          ))}
        </pre>
      ) : (
        <pre className="whitespace-pre-wrap break-words px-4 py-3.5 text-[12.5px] leading-[1.75] text-ink-2 sm:text-[13px]">
          {props.code.split("\n").map((line, i) => {
            const body = line.trimStart();
            const hang = props.hang ? 2 : 0;
            return (
              <span
                key={i}
                className="block"
                style={{ paddingLeft: `${line.length - body.length + hang}ch`, textIndent: `-${hang}ch` }}
              >
                {body ? <Words text={body} /> : " "}
              </span>
            );
          })}
        </pre>
      )}
      {props.commands && props.note && (
        <p className="mt-0 border-t border-rule bg-paper-3 px-4 py-2.5 text-[13.5px] leading-relaxed text-fog">{props.note}</p>
      )}
    </figure>
  );
}

// Wrapped code breaks only between words, never at a flag's hyphens: each
// word is atomic. A word wider than the whole line (a URL, a secret's name)
// breaks inside: after a slash if it can, anywhere if it must.
function Words({ text }: { text: string }) {
  return text.split(/(\s+)/).map((part, i) =>
    i % 2 ? (
      part
    ) : part ? (
      <span key={i} className="inline-block max-w-full indent-0 [overflow-wrap:anywhere]">
        {part.split(/(?<=\/)/).map((piece, j) => (
          <Fragment key={j}>
            {j > 0 && <wbr />}
            {piece}
          </Fragment>
        ))}
      </span>
    ) : null
  );
}
