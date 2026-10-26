import { AppShell } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
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
      <div className="flex w-full flex-1 items-center justify-center px-4 py-6 sm:px-6 sm:py-12">
        <article
          aria-labelledby="invite-title"
          className="relative w-full max-w-[640px] overflow-hidden rounded-sheet border border-rule bg-paper-2 shadow-sheet"
        >
          <div aria-hidden className="h-[2px]" style={{ background: "var(--foil)" }} />
          <p aria-hidden className="microprint border-b border-rule px-5 py-1.5 sm:px-10">
            {MICRO}
          </p>
          <div className="grid gap-6 px-5 pb-7 pt-6 *:min-w-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10 sm:px-10 sm:py-11">
            <Seal id={code} size={136} className="ticket-seal size-[72px]! sm:size-[136px]!" label={`Seal of the ${name} invite`} />
            <div>
              <p className="text-[14px] text-fog">{member ? "You're already a member of" : "You're invited to"}</p>
              <h1
                id="invite-title"
                className={cx(
                  "mt-1 text-balance font-wide font-[740] tracking-[-0.03em] text-ink [overflow-wrap:anywhere]",
                  name.length <= 14
                    ? "text-[32px] leading-[1.04] sm:text-[40px]"
                    : name.length <= 32
                      ? "text-[27px] leading-[1.08] sm:text-[32px]"
                      : "text-[22px] leading-[1.15] sm:text-[25px]"
                )}
              >
                {member ? name : `Join ${name}`}
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
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
              <p className="mt-4 text-[13.5px] text-fog">
                {"Expires "}
                <time dateTime={expiresAt} title={fullDate(expiresAt)} className="font-medium text-ink-2" suppressHydrationWarning>
                  {until(expiresAt)}
                </time>
                {`, and admits ${usesLeft} more ${usesLeft === 1 ? "person" : "people"}.`}
              </p>
            </div>
          </div>
          <footer className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-dashed border-rule-2 px-5 py-3.5 sm:px-10">
            <p className="font-mono text-[12.5px] tracking-[0.08em] text-ink-2">
              <span aria-hidden className="text-fog">
                No.{" "}
              </span>
              <span className="sr-only">Invite code </span>
              {code}
            </p>
            <p className="min-w-0 text-[13px] text-fog [overflow-wrap:anywhere]">Signed in as {session.email ?? session.name}</p>
          </footer>
          <p aria-hidden className="microprint border-t border-rule px-5 py-1.5 sm:px-10">
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
