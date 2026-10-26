import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { AppShell, PageHead } from "../components/AppShell";
import { Field } from "../components/Field";
import { LockIcon } from "../components/icons";
import { Seal } from "../components/Seal";
import { Submit } from "../components/Submit";
import type { JoinFailure, Session, WorkspaceChoice } from "../page";

// Every way into a workspace: switch to one you're in, create one, or join
// with a code. `next` is the link that brought them here (joining or
// switching goes back to it); `join`, a code the server refused.
export function Workspaces({
  session,
  workspaces,
  next,
  join
}: {
  session: Session;
  workspaces: WorkspaceChoice[];
  next: string | null;
  join?: JoinFailure | null;
}) {
  const failed = join ?? null;
  // Only a link to an artifact means "you followed someone else's link".
  const followedLink = Boolean(next && /^\/(d|w|history)\//.test(next));
  const canSwitch = workspaces.some((w) => !w.current);
  // Joining comes first for someone with nothing else to do, a link to
  // follow, or a code to fix.
  const joinFirst = followedLink || Boolean(failed) || !workspaces.length;
  // A refused code: the field has focus; bring the whole form, error and
  // button included, into view (a phone shows only the field otherwise).
  const joinRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (failed) joinRef.current?.scrollIntoView({ block: "nearest" });
  }, [failed]);

  const joinPanel = (
    <FormPanel
      ref={joinRef}
      id="join-title"
      title="Join a workspace"
      description="Use the invite code an admin of the workspace sent you."
    >
      <form method="post" action="/join">
        {next && <input type="hidden" name="next" value={next} />}
        <Field
          label="Invite code"
          name="code"
          required
          maxLength={200}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={failed?.code}
          error={failed?.error}
          autoFocus={Boolean(failed)}
          inputClassName="font-mono tracking-[0.02em]"
          hint={
            <>
              The code, like <span className="whitespace-nowrap font-mono text-[12px] text-ink-2">HA-7KQ2-MX9P-4TRA</span>, or the whole
              invite link.
            </>
          }
        />
        <Submit tone={joinFirst ? "ink" : "line"} pending="Joining…" className="mt-4 w-full sm:w-auto">
          Join workspace
        </Submit>
      </form>
    </FormPanel>
  );
  const createPanel = (
    <FormPanel id="create-title" title="Create a workspace" description="You'll be its admin, and can invite people from a terminal.">
      <form method="post" action="/workspaces">
        <Field label="Workspace name" name="name" required maxLength={100} autoComplete="off" hint="Usually your team or company, like Northwind." />
        <Submit tone={joinFirst ? "line" : "ink"} pending="Creating workspace…" className="mt-4 w-full sm:w-auto">
          Create workspace
        </Submit>
      </form>
    </FormPanel>
  );

  return (
    <AppShell session={session} section="workspaces">
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-9 sm:px-6 sm:pt-12">
        <PageHead title="Workspaces">
          {workspaces.length
            ? "Switch workspaces, create a new one, or join one with an invite code."
            : "You're not in a workspace yet. Join your team's with an invite code, or create one."}
        </PageHead>

        {followedLink && (
          <div className="mt-8 flex gap-3.5 rounded-card border border-rule bg-wash px-4 py-4 sm:px-5">
            <LockIcon className="mt-[3px] size-[18px] shrink-0 text-intaglio" />
            <div className="min-w-0 text-[14.5px] leading-relaxed">
              <p className="font-medium text-ink">Your link opens inside its workspace</p>
              <p className="mt-0.5 text-ink-2">
                {canSwitch
                  ? "If you're a member, switch to that workspace below. If not, ask whoever shared it for an invite code. Either way, you'll go straight back to the link."
                  : "Ask whoever shared it for an invite code and enter it below. You'll go straight back to the link."}
              </p>
            </div>
          </div>
        )}

        {workspaces.length > 0 && (
          <section aria-labelledby="yours" className="mt-10">
            <h2 id="yours" className="font-wide text-[19px] font-[700] tracking-[-0.015em] text-ink">
              Your workspaces
            </h2>
            <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-paper-2">
              {workspaces.map((w) => (
                <li key={w.id} className="flex min-h-14 items-center gap-3.5 px-4 py-2.5 sm:px-5">
                  <Seal id={w.id} size={28} deferred />
                  <span className="min-w-0 flex-1 text-[15px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{w.name}</span>
                  {w.current ? (
                    <span className="shrink-0 rounded-chip bg-wash px-2 py-1 text-[12px] font-medium leading-none text-intaglio">Current</span>
                  ) : (
                    <form method="post" action="/workspaces/switch" className="shrink-0">
                      <input type="hidden" name="id" value={w.id} />
                      {next && <input type="hidden" name="next" value={next} />}
                      <Submit tone="line" size="sm" pending="Switching…">
                        Switch<span className="sr-only"> to {w.name}</span>
                      </Submit>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10 grid gap-4 *:min-w-0 sm:gap-5 md:grid-cols-2">
          {joinFirst ? (
            <>
              {joinPanel}
              {createPanel}
            </>
          ) : (
            <>
              {createPanel}
              {joinPanel}
            </>
          )}
        </div>

        <section aria-labelledby="terminal" className="mt-10 border-t border-rule pt-6">
          <h2 id="terminal" className="text-[13.5px] font-medium text-ink">
            From a terminal or an agent
          </h2>
          <dl className="mt-3 space-y-2.5 sm:space-y-1.5">
            {COMMANDS.filter(([what]) => canSwitch || what !== "Switch").map(([what, command]) => (
              <div key={what} className="grid gap-0.5 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
                <dt className="text-[13.5px] text-fog">{what}</dt>
                <dd className="font-mono text-[12.5px] leading-[1.9] text-ink-2 [overflow-wrap:anywhere]">{command}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </AppShell>
  );
}

const COMMANDS = [
  ["Switch", "npx htmlartifact workspace switch <name>"],
  ["Create", "npx htmlartifact workspace create <name>"],
  ["Join", "npx htmlartifact workspace join <code>"],
  ["Invite", "npx htmlartifact workspace invite"]
] as const;

function FormPanel({
  ref,
  id,
  title,
  description,
  children
}: {
  ref?: Ref<HTMLElement>;
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section ref={ref} aria-labelledby={id} className="rounded-card border border-rule bg-paper-2 p-5 sm:p-6">
      <h2 id={id} className="font-wide text-[17px] font-[680] tracking-[-0.015em] text-ink">
        {title}
      </h2>
      <p className="mt-1 text-[14px] leading-relaxed text-fog">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}
