import { Menu } from "@base-ui/react/menu";
import { Fragment, useDeferredValue, useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { matchesAll, words } from "../lib/search";
import type { ArtifactSummary } from "../page";
import { MoreIcon, SearchIcon } from "./icons";
import { menuItem, menuPopup } from "./menu";
import { Seal } from "./Seal";
import { Rule } from "./Sheet";
import { Time } from "./Time";

const SERVER_ROWS = 30;

// The workspace's artifacts as ruled rows, newest first: the seal, a title
// you can read, who published it and from where, its versions (the way into
// its history), and when. The title opens the artifact.
// The filter is the page's (it also goes on the older-page link): `query`
// and `onQueryChange`. `paged`: the feed has other pages, so the filter
// covers only this one. `filterable`: show the filter row.
export function ArtifactList({
  artifacts,
  mine = false,
  paged = false,
  filterable,
  query,
  onQueryChange
}: {
  artifacts: ArtifactSummary[];
  mine?: boolean;
  paged?: boolean;
  filterable: boolean;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  // The server renders the first rows only (Workers Free: 10 ms of CPU); the
  // browser renders the rest right after hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const q = useDeferredValue(query.trim());
  const terms = words(q);
  const shown = terms.length ? artifacts.filter((a) => matchesAll(terms, [a.title, a.description, a.author, a.repo, a.id])) : artifacts;
  const rows = hydrated ? shown : shown.slice(0, SERVER_ROWS);
  const field = useRef<HTMLInputElement>(null);

  return (
    <>
      {filterable && (
        <Rule width="app" inner="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
          <label className="flex h-9 min-w-0 flex-1 basis-full items-center gap-2.5 rounded-control border border-control bg-card px-3 text-muted transition-[border-color,box-shadow] duration-150 focus-within:border-foreground focus-within:shadow-[0_0_0_3px_var(--line)] sm:max-w-[20rem] sm:basis-auto">
            <SearchIcon className="size-4 shrink-0" />
            <span className="sr-only">Filter artifacts by title, author or repository</span>
            <input
              ref={field}
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Filter by title, author or repo"
              className="h-full w-full bg-transparent text-[16px] text-foreground outline-none placeholder:text-faint sm:text-[14px]"
            />
          </label>
          <p className="font-mono text-[12.5px] text-muted" aria-live="polite">
            {q ? `${shown.length} of ${artifacts.length} match` : `${artifacts.length} ${artifacts.length === 1 ? "artifact" : "artifacts"}`}
            {paged && " on this page"}
          </p>
        </Rule>
      )}
      <Rule width="app" inner="">
        <div aria-hidden className={cx(COLUMNS, "hidden border-b border-line font-mono text-[12px] text-faint md:grid")}>
          <span className="border-r border-line" />
          <span className="px-4 py-2">Artifact</span>
          <span className="px-4 py-2">{mine ? "Repository" : "Published by"}</span>
          <span className="px-4 py-2">Versions</span>
          <span className="px-4 py-2 text-right">Updated</span>
          <span />
        </div>
        {byDay(rows, hydrated).map((group) => (
          <Fragment key={group.label}>
            <h2 className="border-b border-line bg-surface/50 px-4 py-1.5 font-mono text-[12px] text-faint sm:px-5">{group.label}</h2>
            <ul className="divide-y divide-line border-b border-line last:border-b-0">
              {group.rows.map((a) => (
                <Row key={a.id} artifact={a} mine={mine} />
              ))}
            </ul>
          </Fragment>
        ))}
        {shown.length === 0 && (
          <ul>
            <li className="px-5 py-14 text-center text-[14px] text-muted">
              Nothing {paged ? "on this page " : ""}matches “{query.trim()}”.{" "}
              <button
                type="button"
                onClick={() => {
                  onQueryChange("");
                  field.current?.focus();
                }}
                className="text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground">
                Clear the filter
              </button>
            </li>
          </ul>
        )}
      </Rule>
    </>
  );
}

// The list's columns on wide screens: seal, artifact, who, versions, when, actions.
const COLUMNS = "md:grid-cols-[3.5rem_minmax(0,1fr)_11rem_7.5rem_8.5rem_2.75rem]";

// Rows newest first, under Today / Yesterday / This week / Earlier, so a busy
// feed (agents publish dozens a day) still reads as days. The server renders
// in UTC; after hydration the reader's own days take over.
function byDay(rows: ArtifactSummary[], local: boolean): { label: string; rows: ArtifactSummary[] }[] {
  const zone = local ? undefined : "UTC";
  const day = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
  };
  const today = day(new Date());
  const label = (iso: string | null) => {
    if (!iso) return "Earlier";
    const ago = today - day(new Date(iso));
    return ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : ago < 7 ? "This week" : "Earlier";
  };
  const groups: { label: string; rows: ArtifactSummary[] }[] = [];
  for (const row of rows) {
    const name = label(row.updatedAt);
    const last = groups.at(-1);
    if (last?.label === name) last.rows.push(row);
    else groups.push({ label: name, rows: [row] });
  }
  return groups;
}

function Row({ artifact: a, mine }: { artifact: ArtifactSummary; mine: boolean }) {
  const title = a.title || "Untitled";
  const versions = a.versionCount || (a.version ?? 0);
  const who = mine ? a.repo : a.author;
  return (
    <li className={cx("group relative grid grid-cols-[minmax(0,1fr)] transition-colors duration-150 hover:bg-surface", COLUMNS)}>
      <span className="hidden place-items-center border-r border-line py-3.5 md:grid">
        <Seal id={a.id} size={22} deferred />
      </span>
      <div className="min-w-0 py-3.5 pl-4 pr-12 md:px-4">
        {/* Phones: the seal sits with the title, so the title gets the width. */}
        <Seal id={a.id} size={16} deferred className="float-left mr-2 mt-[3px] md:hidden" />
        <a
          href={a.url}
          className="line-clamp-2 text-[14.5px] font-medium leading-snug text-foreground outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-foreground md:line-clamp-1"
        >
          {title}
        </a>
        {a.description && <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-muted md:line-clamp-1">{a.description}</p>}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px] text-muted md:hidden">
          {!mine && a.author && <span className="max-w-full truncate font-sans text-[13px] text-foreground/80">{a.author}</span>}
          {a.repo && (
            <span className="max-w-full truncate" title={a.repo}>
              {a.repo}
            </span>
          )}
          <Time iso={a.updatedAt} />
          <VersionsLink artifact={a} count={versions} title={title} />
        </div>
      </div>
      <div className="hidden min-w-0 px-4 py-3.5 md:block">
        {who ? (
          <p title={who} className={mine ? "truncate font-mono text-[12.5px] text-muted" : "truncate text-[13.5px] text-foreground/85"}>
            {who}
          </p>
        ) : (
          <p className="text-faint">None</p>
        )}
        {!mine && a.repo && (
          <p title={a.repo} className="mt-0.5 truncate font-mono text-[12px] text-muted">
            {a.repo}
          </p>
        )}
      </div>
      <div className="hidden px-4 py-3.5 md:block">
        <VersionsLink artifact={a} count={versions} title={title} />
      </div>
      <Time iso={a.updatedAt} className="hidden px-4 py-3.5 text-right font-mono text-[12.5px] text-muted md:block" />
      <div className="absolute right-2 top-2.5 md:static md:flex md:items-start md:justify-center md:py-2.5">
        <RowMenu artifact={a} title={title} />
      </div>
    </li>
  );
}

// What you do with an artifact without opening it: copy its link (the thing
// people paste in chat many times a day), or go to its versions.
function RowMenu({ artifact, title }: { artifact: ArtifactSummary; title: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.url);
      setCopied("copied");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(false), 700);
    } catch {
      setCopied("failed");
    }
  };
  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCopied("idle");
      }}
    >
      <Menu.Trigger
        aria-label={`Actions for ${title}`}
        className="press relative z-[1] grid size-8 place-items-center rounded-control text-muted hover:bg-card hover:text-foreground data-popup-open:bg-card data-popup-open:text-foreground"
      >
        <MoreIcon className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-40 outline-none">
          <Menu.Popup className={cx(menuPopup, "w-56")}>
            <Menu.Item closeOnClick={false} onClick={copy} className={menuItem}>
              {copied === "copied" ? "Link copied" : copied === "failed" ? "Couldn't copy: open it and copy from there" : "Copy link"}
            </Menu.Item>
            <Menu.LinkItem href={`/history/${artifact.id}`} className={menuItem}>
              Versions and details
            </Menu.LinkItem>
            <p role="status" className="sr-only">
              {copied === "copied" ? "Link copied" : copied === "failed" ? "Couldn't copy the link" : ""}
            </p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// The way into an artifact's history, named for what it holds.
function VersionsLink({ artifact, count, title }: { artifact: ArtifactSummary; count: number; title: string }) {
  return (
    <a
      href={`/history/${artifact.id}`}
      className="relative z-[1] -my-1 inline-flex min-h-7 items-center whitespace-nowrap font-mono text-[12.5px] text-foreground underline decoration-control underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
    >
      {count === 1 ? "1 version" : `${count} versions`}
      <span className="sr-only"> of {title}</span>
    </a>
  );
}
