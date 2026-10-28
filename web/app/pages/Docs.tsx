import { Fragment, useRef, type ReactNode } from "react";
import { CopyText } from "../components/CopyText";
import { Facts, Fact, H3, ReadingPage, Section, type Toc } from "../components/ReadingPage";
import { REPO_URL } from "../components/SiteHeader";
import { cx } from "../lib/cx";
import type { Session } from "../page";


const SECTIONS: Toc = [
  { id: "start", title: "Get started" },
  { id: "agents", title: "With an agent" },
  {
    id: "commands",
    title: "Commands",
    children: [
      { id: "account", title: "Account" },
      { id: "workspaces", title: "Workspaces and members" },
      { id: "publishing-commands", title: "Publishing and reading" },
      { id: "automation", title: "CI and automation" },
      { id: "admin", title: "Admin" },
      { id: "output", title: "Output and exit codes" }
    ]
  },
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
            <p>
              Pages must be self-contained: inline scripts and styles run, but external scripts, forms, iframes and embeds are refused,
              and an upload holds up to 10 pages and 1 MiB. Run <code>check</code> first to see whether a file passes, and read{" "}
              <a href="#publishing">what you can publish</a> for the full rules.
            </p>
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
          <div key={group.id} id={group.id} className="mt-10">
            <h3 className={H3}>{group.title}</h3>
            {group.note && <p className="mt-1 text-[14px] text-muted">{group.note}</p>}
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {group.commands.map((c) => (
                <div key={c.names[0]} className="grid gap-1.5 py-3.5 sm:grid-cols-[13.5rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="min-w-0 text-[13px] leading-6 text-foreground">
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
                  <dd className="min-w-0 text-[15px] leading-relaxed text-muted">{c.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <div id="output" className="mt-10">
          <h3 className={H3}>Output and exit codes</h3>
          <p>
            Every command takes <code>--json</code>. Standard output is then one JSON object, errors included, and anything else goes
            to standard error. Each command exits with one of these codes:
          </p>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {EXIT_CODES.map(([code, meaning]) => (
              <div key={code} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-4 py-2">
                <dt className="text-[13px] leading-6 text-foreground">
                  <code>{code}</code>
                </dt>
                <dd className="min-w-0 text-[15px] leading-relaxed text-muted">{meaning}</dd>
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
        <ul className="list-disc space-y-2 pl-5 marker:text-muted">
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

function Step({ id, title, who, children }: { id: string; title: string; who: string; children: ReactNode }) {
  return (
    <li id={id}>
      <h3 className={cx(H3, "flex flex-wrap items-center gap-x-2.5 gap-y-1")}>
        {title}
        <span className="rounded-chip border border-border px-1.5 py-px font-sans text-[12px] font-medium tracking-normal text-muted font-stretch-normal">
          {who}
        </span>
      </h3>
      {children}
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
  const pre = useRef<HTMLPreElement>(null);
  return (
    <figure aria-label={props.name} className="mt-5 overflow-hidden rounded-card border border-line bg-card">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line pl-4 pr-1">
        <span className="min-w-0 py-2 font-mono text-[12px] leading-snug text-muted [overflow-wrap:anywhere]">{props.label}</span>
        <CopyText text={text} what={props.commands ? (props.commands.length > 1 ? "Commands" : "Command") : "File"} target={pre} />
      </div>
      {props.commands ? (
        <pre ref={pre} className="whitespace-pre-wrap break-words px-4 py-3 text-[12.5px] leading-[1.75] text-foreground sm:text-[13px]">
          {props.commands.map((c) => (
            <span key={c} className="block pl-[2ch] -indent-[2ch]">
              <span aria-hidden className="select-none text-muted">
                ${" "}
              </span>
              <Words text={c} />
            </span>
          ))}
        </pre>
      ) : (
        <pre ref={pre} className="whitespace-pre-wrap break-words px-4 py-3.5 text-[12.5px] leading-[1.75] text-muted sm:text-[13px]">
          {props.code.split("\n").map((line, i) => {
            const body = line.trimStart();
            const indent = line.length - body.length;
            const hang = props.hang ? 2 : 0;
            // The leading spaces are real text (so a manual copy keeps YAML
            // indentation); the hanging indent puts wrapped lines under the
            // content, `hang` deeper.
            return (
              <span key={i} className="block" style={{ paddingLeft: `${indent + hang}ch`, textIndent: `-${indent + hang}ch` }}>
                {line.slice(0, indent)}
                {body ? <Words text={body} /> : " "}
              </span>
            );
          })}
        </pre>
      )}
      {props.commands && props.note && (
        <p className="mt-0 border-t border-line bg-surface px-4 py-2.5 text-[13.5px] leading-relaxed text-muted">{props.note}</p>
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
