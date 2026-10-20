import { AppShell } from "../components/AppShell";
import { Button, ButtonLink } from "../components/Button";
import { Seal } from "../components/Seal";
import { fullDate } from "../lib/time";
import type { Session } from "../page";

const MICRO = "HTMLARTIFACT MEMBERS ONLY ".repeat(40);

// An invitation, printed like a ticket: the workspace's seal, microprint
// edges, and the code as its serial number. A member opening their own
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
  return (
    <AppShell session={session} section={null}>
      <main className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-[1120px] place-items-center px-4 py-14 sm:px-6">
        <div className="ticket relative w-full max-w-[640px] overflow-hidden rounded-[28px] border border-rule bg-paper-2 shadow-[0_40px_80px_-40px_rgba(18,26,51,0.35)]">
          <p aria-hidden className="microprint border-b border-rule px-6 py-1.5">{MICRO}</p>
          <div className="grid gap-8 px-6 py-9 *:min-w-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10 sm:px-10 sm:py-12">
            <Seal id={code} size={148} className="ticket-seal mx-auto size-[120px]! sm:size-[148px]!" label={`Seal of the ${name} invite`} />
            <div>
              <p className="text-[14px] text-fog">{member ? "You're already a member of" : "You're invited to"}</p>
              <h1 className={`mt-1 text-balance font-wide font-[740] leading-[1.02] tracking-[-0.03em] text-ink [overflow-wrap:anywhere] ${name.length > 24 ? "text-[26px] sm:text-[30px]" : "text-[34px] sm:text-[40px]"}`}>
                {member ? name : `Join ${name}`}
              </h1>
              <p className="mt-3 text-[15.5px] leading-relaxed text-fog">
                {member
                  ? `This invite is for a workspace you're in. Share it with whoever should join.`
                  : `You'll see everything ${name} publishes, and they'll see what you publish there.`}
              </p>
              {member === "current" ? (
                <ButtonLink href="/" size="lg" className="mt-7">
                  {`Open ${name.length > 24 ? "workspace" : name}`}
                </ButtonLink>
              ) : (
                <form method="post" action={member ? "/workspaces/switch" : "/join"} className="mt-7 flex flex-wrap items-center gap-3">
                  {member ? <input type="hidden" name="id" value={workspace.id} /> : <input type="hidden" name="code" value={code} />}
                  <Button type="submit" size="lg">
                    {member ? `Switch to ${name.length > 24 ? "workspace" : name}` : "Join workspace"}
                  </Button>
                </form>
              )}
              <p className="mt-4 text-[13px] text-fog">
                {"Expires "}
                <time dateTime={expiresAt} title={fullDate(expiresAt)} className="text-ink-2" suppressHydrationWarning>
                  {until(expiresAt)}
                </time>
                {`, and admits ${usesLeft} more ${usesLeft === 1 ? "person" : "people"}.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-dashed border-rule-2 px-6 py-3.5 sm:px-10">
            <span className="font-mono text-[12.5px] tracking-[0.06em] text-ink-2">{code}</span>
            <span className="truncate text-[12.5px] text-fog">Signed in as {session.email ?? session.name}</span>
          </div>
          <p aria-hidden className="microprint border-t border-rule px-6 py-1.5">{MICRO}</p>
        </div>
      </main>
    </AppShell>
  );
}

// "in 6 days" rather than "next week": an invite's expiry is a count.
function until(iso: string): string {
  const hours = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  if (hours < 48) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `in ${Math.round(hours / 24)} days`;
}
