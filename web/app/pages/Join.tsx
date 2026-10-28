import { AppShell } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { FoilSeal } from "../components/FoilSeal";
import { Seal } from "../components/Seal";
import { Submit } from "../components/Submit";
import { cx } from "../lib/cx";
import { fullDate } from "../lib/time";
import type { Session } from "../page";

const MICRO = "HTMLARTIFACT MEMBERS ONLY ".repeat(40);

// An invitation, printed like a ticket: the invite's seal, a foil edge,
// microprint, and the code as its serial number. A member opening their own
// workspace's link gets the way in instead of a second "Join".
export function Join({
  session,
  code,
  workspace,
  expiresAt,
  usesLeft,
  member
}: {
  session: Session;
  code: string;
  workspace: { id: string; name: string };
  expiresAt: string;
  usesLeft: number;
  member: "current" | "other" | null;
}) {
  const name = workspace.name;
  // Buttons name the workspace while it fits on one line.
  const short = name.length <= 24;
  return (
    <AppShell session={session} section={null}>
      <div className="mx-auto flex w-full max-w-[1040px] flex-1 items-center justify-center border-x border-line px-4 py-8 sm:px-6 sm:py-14">
        <article aria-labelledby="invite-title" className="relative w-full max-w-[620px] overflow-hidden rounded-card border border-border bg-card">
          <div aria-hidden className="h-px" style={{ background: "var(--foil)" }} />
          <p aria-hidden className="microprint border-b border-line px-5 py-1.5 sm:px-8">
            {MICRO}
          </p>
          <div className="grid gap-6 px-5 pb-7 pt-6 *:min-w-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-9 sm:px-8 sm:py-10">
            <div className="hidden sm:block">
              <FoilSeal id={code} size={120} label={`Seal of the ${name} invite`} />
            </div>
            <div className="lock sm:hidden">
              <Seal id={code} size={64} />
            </div>
            <div>
              <p className="text-[14px] text-muted">{member ? "You're already a member of" : "You're invited to"}</p>
              <h1
                id="invite-title"
                className={cx(
                  "mt-1 text-balance font-medium tracking-[-0.035em] text-foreground [overflow-wrap:anywhere]",
                  name.length <= 14
                    ? "text-[32px] leading-[1.04] sm:text-[40px]"
                    : name.length <= 32
                      ? "text-[27px] leading-[1.08] sm:text-[32px]"
                      : "text-[22px] leading-[1.15] sm:text-[25px]"
                )}
              >
                {member ? name : `Join ${name}`}
              </h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
                {member === "current"
                  ? "It's the workspace you're in now. Share this link with whoever should join."
                  : member
                    ? "Switch to it to see what it publishes, or share this link with whoever should join."
                    : "You'll see everything its members publish, and they'll see what you publish there."}
              </p>
              {member === "current" ? (
                <ButtonLink href="/" size="lg" className="mt-6 w-full sm:w-auto">
                  {short ? `Open ${name}` : "Open workspace"}
                </ButtonLink>
              ) : (
                <form method="post" action={member ? "/workspaces/switch" : "/join"} className="mt-6">
                  {member ? <input type="hidden" name="id" value={workspace.id} /> : <input type="hidden" name="code" value={code} />}
                  <Submit size="lg" pending={member ? "Switching…" : "Joining…"} className="w-full sm:w-auto">
                    {member ? (short ? `Switch to ${name}` : "Switch to workspace") : "Join workspace"}
                  </Submit>
                </form>
              )}
              <p className="mt-4 text-[13.5px] text-muted">
                {"Expires "}
                <time dateTime={expiresAt} title={fullDate(expiresAt)} className="text-foreground" suppressHydrationWarning>
                  {until(expiresAt)}
                </time>
                {`, and admits ${usesLeft} more ${usesLeft === 1 ? "person" : "people"}.`}
              </p>
            </div>
          </div>
          <footer className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-dashed border-border px-5 py-3.5 sm:px-8">
            <p className="font-mono text-[12.5px] tracking-[0.06em] text-foreground">
              <span aria-hidden className="text-faint">
                No.{" "}
              </span>
              <span className="sr-only">Invite code </span>
              {code}
            </p>
            <p className="min-w-0 text-[13px] text-muted [overflow-wrap:anywhere]">Signed in as {session.email ?? session.name}</p>
          </footer>
          <p aria-hidden className="microprint border-t border-line px-5 py-1.5 sm:px-8">
            {MICRO}
          </p>
        </article>
      </div>
    </AppShell>
  );
}

// "in 6 days" rather than "next week": an invite's expiry is a count.
function until(iso: string): string {
  const hours = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  if (hours < 48) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `in ${Math.round(hours / 24)} days`;
}
