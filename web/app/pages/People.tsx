import { Menu } from "@base-ui/react/menu";
import { useId } from "react";
import { AppShell, PageHead } from "../components/AppShell";
import { CopyButton, useCopy } from "../components/Copy";
import { CopyLink } from "../components/CopyLink";
import { MoreIcon } from "../components/icons";
import { menuItem, menuPopup } from "../components/menu";
import { Rule } from "../components/Sheet";
import { Submit } from "../components/Submit";
import { Time } from "../components/Time";
import { cx } from "../lib/cx";
import type { InviteLink, Person, Session } from "../page";

// Who is in the workspace and who runs it. Admins also get the invite links:
// make one, send it, see who used it, revoke it. Members see who to ask.
export function People({
  session,
  people,
  invites,
  invite
}: {
  session: Session;
  people: Person[];
  invites: InviteLink[] | null;
  invite: Invite;
}) {
  const workspace = session.workspace?.name ?? "this workspace";
  const admin = session.role === "admin";
  const admins = people.filter((p) => p.role === "admin" && !p.you);
  const fresh = session.notice?.fresh ?? null;
  return (
    <AppShell session={session} section="people">
      <PageHead title="People" count={people.length}>
        Everyone here can open every artifact in {workspace}.{" "}
        {admin ? (
          "Invite your team with a link, and choose who else runs the workspace."
        ) : admins.length ? (
          <>To invite someone, ask an admin: {list(admins.map((a) => a.name))}.</>
        ) : (
          "Only admins can invite people."
        )}
      </PageHead>

      {admin && invites && <InviteLinks workspace={workspace} invites={invites} invite={invite} fresh={fresh} />}

      <section aria-labelledby="members">
        <Rule width="app" inner="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
          <h2 id="members" className="font-mono text-[12.5px] text-muted">
            Members
          </h2>
          <p className="font-mono text-[12.5px] text-faint">
            {count(people.length, "person", "people")}, {count(people.filter((p) => p.role === "admin").length, "admin")}
          </p>
        </Rule>
        <Rule width="app" inner="">
          <ul className="divide-y divide-line">
            {people.map((person) => (
              <PersonRow key={person.id} person={person} workspace={workspace} admin={admin} />
            ))}
          </ul>
        </Rule>
      </section>
      <div aria-hidden className="mx-auto w-full max-w-[1040px] flex-1 border-x border-line" />
    </AppShell>
  );
}

function PersonRow({ person, workspace, admin }: { person: Person; workspace: string; admin: boolean }) {
  const initial = (person.name || person.email || "?").trim().charAt(0).toUpperCase();
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:px-5">
      <span aria-hidden className="grid size-8 place-items-center rounded-full border border-border bg-surface text-[12.5px] font-medium text-foreground">
        {initial}
      </span>
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[14.5px] leading-snug">
          <span className="font-medium text-foreground [overflow-wrap:anywhere]">{person.name}</span>
          {person.you && <span className="text-[13.5px] text-muted">you</span>}
        </p>
        <p className="truncate font-mono text-[12.5px] leading-snug text-faint" title={person.email}>
          {person.email}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {person.joinedAt && (
          <span className="hidden font-mono text-[12.5px] text-faint sm:block">
            joined <Time iso={person.joinedAt} />
          </span>
        )}
        {person.role === "admin" && <span className="rounded-[5px] border border-border px-1.5 font-mono text-[11.5px] leading-[18px] text-foreground">admin</span>}
        {admin && <PersonMenu person={person} workspace={workspace} />}
      </div>
    </li>
  );
}

// An admin's choices for one person; each opens a page that says what will
// happen before anything does.
function PersonMenu({ person, workspace }: { person: Person; workspace: string }) {
  const base = `/people/${encodeURIComponent(person.id)}`;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Change ${person.you ? "your" : `${person.name}'s`} role or access`}
        className="press -mr-1.5 grid size-8 place-items-center rounded-control text-muted hover:bg-surface hover:text-foreground data-popup-open:bg-surface data-popup-open:text-foreground"
      >
        <MoreIcon className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-40 outline-none">
          <Menu.Popup className={cx(menuPopup, "w-60")}>
            {person.role === "member" ? (
              <Menu.LinkItem href={`${base}/make-admin`} className={menuItem}>
                Make admin…
              </Menu.LinkItem>
            ) : (
              <Menu.LinkItem href={`${base}/make-member`} className={menuItem}>
                {person.you ? "Stop being an admin…" : "Make member…"}
              </Menu.LinkItem>
            )}
            <Menu.Separator className="-mx-1 my-1 h-px bg-line" />
            {person.you ? (
              <Menu.LinkItem href="/settings/leave" className={menuItem}>
                Leave {workspace}…
              </Menu.LinkItem>
            ) : (
              <Menu.LinkItem href={`${base}/remove`} className={cx(menuItem, "text-deny data-highlighted:text-deny")}>
                Remove from workspace…
              </Menu.LinkItem>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function InviteLinks({
  workspace,
  invites,
  invite,
  fresh
}: {
  workspace: string;
  invites: InviteLink[];
  invite: Invite;
  fresh: string | null;
}) {
  const uses = [...new Set([1, 5, 10, 25, invite.defaultUses, invite.maxUses])].filter((n) => n <= invite.maxUses).sort((a, b) => a - b);
  return (
    <section id="links" aria-labelledby="links-title" className="scroll-mt-28">
      <Rule width="app" inner="flex items-center justify-between gap-4 px-4 py-2 sm:px-5">
        <h2 id="links-title" className="py-1 font-mono text-[12.5px] text-muted">
          Invite links
        </h2>
        {invites.length > 1 && (
          <form method="post" action="/people/invites/revoke">
            <input type="hidden" name="code" value="all" />
            <Submit tone="ghost" size="sm" pending="Revoking…">
              Revoke all
            </Submit>
          </form>
        )}
      </Rule>
      <Rule width="app" inner="px-4 py-4 sm:px-5">
        <form method="post" action="/people/invites" className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <Choice label="Works for" name="days" options={invite.days.map((d) => [d, d === 1 ? "1 day" : `${d} days`])} value={invite.defaultDays} />
          <Choice label="Up to" name="uses" options={uses.map((n) => [n, n === 1 ? "1 person" : `${n} people`])} value={invite.defaultUses} />
          <Submit pending="Creating link…" className="w-full sm:w-auto">
            Create invite link
          </Submit>
          <p className="basis-full text-[13px] leading-relaxed text-muted">
            Anyone with the link can join {workspace} and read everything in it until it expires or is used up. Revoke it here any time.
          </p>
        </form>
      </Rule>
      <Rule width="app" inner="">
        {invites.length ? (
          <ul className="divide-y divide-line">
            {invites.map((link) => (
              <InviteRow key={link.code} link={link} workspace={workspace} fresh={link.code === fresh} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-4 text-[14px] leading-relaxed text-muted sm:px-5">
            No live invite links. Removing someone stops every team link; you can make a new one right after.
          </p>
        )}
      </Rule>
    </section>
  );
}

function InviteRow({ link, workspace, fresh }: { link: InviteLink; workspace: string; fresh: boolean }) {
  const until = new Date(link.expiresAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const message = `Join ${workspace} on htmlartifact, where we share the plans, reviews and reports our agents write. Open this link and sign in: ${link.url} (it works until ${until}).`;
  const [linkState, copyLink] = useCopy(link.url);
  const [messageState, copyMessage] = useCopy(message);
  return (
    <li className={cx("px-4 py-3.5 sm:px-5", fresh && "bg-surface/70")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-60">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[13.5px] text-foreground">
            {link.code}
            {fresh && <span className="rounded-[5px] border border-border bg-card px-1.5 text-[11.5px] leading-[18px]">new</span>}
          </p>
          <p className="mt-0.5 font-mono text-[12.5px] leading-snug text-faint">
            {link.uses} of {link.maxUses} joined · expires <Time iso={link.expiresAt} />
            {link.createdBy && <> · by {link.createdBy}</>}
          </p>
        </div>
        <div className="-ml-2.5 flex flex-wrap items-center gap-2">
          {!fresh && <CopyButton state={linkState} onCopy={copyLink} what="Invite link" label="Copy link" accessibleLabel={`Copy link ${link.code}`} />}
          <CopyButton
            state={messageState}
            onCopy={copyMessage}
            what="Invite message"
            label="Copy message"
            accessibleLabel={`Copy message for ${link.code}`}
          />
          <form method="post" action="/people/invites/revoke">
            <input type="hidden" name="code" value={link.code} />
            <Submit tone="ghost" size="sm" pending="Revoking…">
              Revoke<span className="sr-only"> {link.code}</span>
            </Submit>
          </form>
        </div>
      </div>
      {fresh && <CopyLink url={link.url} className="mt-3 sm:max-w-[36rem]" />}
    </li>
  );
}

// A small labelled native select: works before the page's script loads, and
// phones give it their own picker.
function Choice({ label, name, options, value }: { label: string; name: string; options: [number, string][]; value: number }) {
  const id = useId();
  return (
    <div className="min-w-0 flex-1 sm:flex-none">
      <label htmlFor={id} className="block text-[13px] text-muted">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        className="mt-1.5 h-9 w-full min-w-32 rounded-control border border-control bg-card px-2.5 text-[16px] text-foreground outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/50 focus:border-foreground focus:shadow-[0_0_0_3px_var(--line)] sm:text-[14px]"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

type Invite = { days: number[]; defaultDays: number; defaultUses: number; maxUses: number };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Maya", "Maya and Dhruv", "Maya, Dhruv and Wen".
const list = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
