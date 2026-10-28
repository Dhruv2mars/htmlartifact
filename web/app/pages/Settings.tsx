import type { ReactNode } from "react";
import { AppShell, PageHead } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { Rule } from "../components/Sheet";
import { bytes } from "../lib/time";
import type { Session } from "../page";

// The workspace itself: what it is, how full it is, and the two ways out
// (leaving it, or, for admins, deleting it). Each way out asks first.
export function Settings({ session, usage, admins }: { session: Session; usage: { storedBytes: number; limitBytes: number }; admins: string[] }) {
  const workspace = session.workspace;
  const name = workspace?.name ?? "this workspace";
  const admin = session.role === "admin";
  const share = usage.limitBytes ? Math.min(1, usage.storedBytes / usage.limitBytes) : 0;
  const percent = Math.round(share * 100);
  const nearlyFull = share >= 0.8;
  return (
    <AppShell session={session} section="settings">
      <PageHead title="Settings">The workspace {name}: storage, your membership, and deleting it.</PageHead>

      <Row title="Workspace" id="workspace">
        <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted">Name</dt>
          <dd className="text-foreground [overflow-wrap:anywhere]">{name}</dd>
          {workspace?.handle && (
            <>
              <dt className="text-muted">Custom URLs</dt>
              <dd className="font-mono text-[13px] text-foreground [overflow-wrap:anywhere]">/w/{workspace.handle}/&lt;name&gt;</dd>
            </>
          )}
          <dt className="text-muted">Your role</dt>
          <dd className="text-foreground">{admin ? "Admin" : "Member"}</dd>
        </dl>
      </Row>

      <Row title="Storage" id="storage" note="Every version of every artifact counts, until it is pruned or deleted.">
        <p className="text-[14px] text-foreground">
          <span className="font-mono tabular-nums">{bytes(usage.storedBytes)}</span> of <span className="font-mono tabular-nums">{bytes(usage.limitBytes)}</span> used
          <span className="text-muted"> ({percent}%)</span>
        </p>
        <div aria-hidden className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface ring-1 ring-line ring-inset">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(share > 0 ? 1.5 : 0, percent)}%` }} />
        </div>
        {nearlyFull && (
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
            Nearly full: uploads stop at {bytes(usage.limitBytes)}. Free space with <code className="font-mono text-[12.5px] text-foreground">npx htmlartifact prune</code>{" "}
            or by deleting artifacts nobody needs.
          </p>
        )}
      </Row>

      <Row title="Leave workspace" id="leave" note={`You lose access to everything in ${name}. Your artifacts stay for the team.`}>
        <ButtonLink href="/settings/leave" tone="line">
          Leave {name}…
        </ButtonLink>
      </Row>

      <Row title="Delete workspace" id="delete" note={`Deletes ${name} and every artifact in it, for everyone. It can't be undone.`}>
        {admin ? (
          <ButtonLink href="/settings/delete" tone="danger">
            Delete workspace…
          </ButtonLink>
        ) : (
          <p className="text-[14px] leading-relaxed text-muted">
            Only admins can delete it{admins.length ? `: ${admins.length < 2 ? admins[0] : `${admins.slice(0, -1).join(", ")} and ${admins.at(-1)}`}` : ""}.
          </p>
        )}
      </Row>
      <div aria-hidden className="mx-auto w-full max-w-[1040px] flex-1 border-x border-line" />
    </AppShell>
  );
}

// One setting: its name and what it means on the left, the control on the right.
function Row({ title, id, note, children }: { title: string; id: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Rule width="app" inner="grid gap-x-10 gap-y-4 px-4 py-6 sm:px-5 md:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-medium tracking-[-0.01em] text-foreground">
            {title}
          </h2>
          {note && <p className="mt-1 text-[13.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">{note}</p>}
        </div>
        <div className="min-w-0 md:pt-0.5">{children}</div>
      </Rule>
    </section>
  );
}
