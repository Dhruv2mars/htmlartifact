import { AppShell, PageHead } from "../components/AppShell";
import { Button } from "../components/Button";
import { Seal } from "../components/Seal";
import { cx } from "../lib/cx";
import type { Session, WorkspaceChoice } from "../page";

const field =
  "h-11 w-full min-w-0 rounded-xl border border-rule-2 bg-paper px-3.5 text-[16px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-fog/70 focus:border-intaglio focus:shadow-[0_0_0_3px_var(--wash)] sm:text-[14.5px]";

export function Workspaces({ session, workspaces, next }: { session: Session; workspaces: WorkspaceChoice[]; next: string | null }) {
  // Only an artifact link means "you followed someone else's link".
  const foreignLink = Boolean(next && /^\/(d|w)\//.test(next));
  const join = (
    <Panel title="Join with an invite code" body={<>Ask an admin of the workspace for a code. It looks like <span className="whitespace-nowrap font-mono text-[12.5px]">HA-7KQ2-MX9P-4TRA</span>.</>}>
      <form method="post" action="/join" className="flex flex-col gap-2.5 sm:flex-row">
        {next && <input type="hidden" name="next" value={next} />}
        <label className="sr-only" htmlFor="code">
          Invite code
        </label>
        <input
          id="code"
          name="code"
          required
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="HA-XXXX-XXXX-XXXX"
          className={cx(field, "font-mono uppercase tracking-wide placeholder:normal-case")}
        />
        <Button type="submit" className="h-11 shrink-0">
          Join
        </Button>
      </form>
    </Panel>
  );
  const create = (
    <Panel title="Start a workspace" body={<>You'll be its admin. Invite people from a terminal with <span className="whitespace-nowrap font-mono text-[12.5px]">htmlartifact workspace invite</span>.</>}>
      <form method="post" action="/workspaces" className="flex flex-col gap-2.5 sm:flex-row">
        <label className="sr-only" htmlFor="name">
          Workspace name
        </label>
        <input id="name" name="name" required maxLength={100} placeholder="Northwind" className={field} />
        <Button type="submit" tone="line" className="h-11 shrink-0">
          Create
        </Button>
      </form>
    </Panel>
  );

  return (
    <AppShell session={session} section="workspaces">
      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <PageHead title="Workspaces">
          {workspaces.length
            ? "Switch to another workspace, start a new one, or join one with an invite code."
            : "You're not in a workspace yet. Join your team's with an invite code, or start one."}
        </PageHead>

        {foreignLink && (
          <div role="status" className="mt-8 flex gap-4 rounded-2xl border border-intaglio/25 bg-wash px-5 py-4 text-[14.5px] leading-relaxed text-ink-2">
            <Seal id="htmlartifact" size={28} className="mt-0.5" />
            <p>
              That link belongs to a workspace you are not in. Ask whoever shared it for an invite code and enter it below; you
              will go straight back to the link.
            </p>
          </div>
        )}

        {workspaces.length > 0 && (
          <ul className="mt-10 divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-paper-2">
            {workspaces.map((w) => (
              <li key={w.id}>
                <form method="post" action="/workspaces/switch">
                  <input type="hidden" name="id" value={w.id} />
                  <button
                    type="submit"
                    disabled={w.current}
                    className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 enabled:hover:bg-paper"
                  >
                    <Seal id={w.id} size={40} />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{w.name}</span>
                    {w.current ? (
                      <span className="rounded-full bg-wash px-2.5 py-1 text-[12px] font-medium text-intaglio">Current</span>
                    ) : (
                      <span className="text-[13px] text-fog transition-colors duration-150 group-hover:text-ink">Switch</span>
                    )}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 grid gap-5 *:min-w-0 md:grid-cols-2">
          {foreignLink || !workspaces.length ? (
            <>
              {join}
              {create}
            </>
          ) : (
            <>
              {create}
              {join}
            </>
          )}
        </div>
        <p className="mt-8 text-[13.5px] text-fog">
          From a terminal or an agent: <code className="text-[12.5px] text-ink-2">htmlartifact workspace create "Northwind"</code> or{" "}
          <code className="text-[12.5px] text-ink-2">htmlartifact workspace join &lt;code&gt;</code>
        </p>
      </main>
    </AppShell>
  );
}

function Panel({ title, body, children }: { title: string; body: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-rule bg-paper-2 p-5 sm:p-6">
      <h2 className="font-wide text-[18px] font-[680] tracking-[-0.015em] text-ink">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-fog">{body}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}
