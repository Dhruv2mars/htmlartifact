import { useDeferredValue, useEffect, useState } from "react";
import type { ArtifactSummary } from "../page";
import { SearchIcon } from "./icons";
import { Seal } from "./Seal";
import { Time } from "./Time";

const SERVER_ROWS = 30;

// The workspace's documents, newest first: a title you can read, who
// published it and from where, how many versions (the link to its history),
// and when. The title opens the artifact.
// `paged`: older artifacts are on later pages, so the filter covers only this one.
export function ArtifactList({
  artifacts,
  mine = false,
  paged = false,
  initialQuery = ""
}: {
  artifacts: ArtifactSummary[];
  mine?: boolean;
  paged?: boolean;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  // The server renders the first rows only (Workers Free: 10 ms of CPU); the
  // browser renders the rest right after hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const q = useDeferredValue(query.trim().toLowerCase());
  const shown = q
    ? artifacts.filter((a) => [a.title, a.description, a.author, a.repo, a.id].some((v) => v?.toLowerCase().includes(q)))
    : artifacts;
  const rows = hydrated ? shown : shown.slice(0, SERVER_ROWS);

  return (
    <div>
      {(artifacts.length > 6 || initialQuery) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-control border border-control bg-paper-2 px-3 text-fog transition-[border-color,box-shadow] duration-150 focus-within:border-intaglio focus-within:shadow-[0_0_0_3px_var(--wash)] sm:max-w-[22rem]">
            <SearchIcon className="size-4 shrink-0" />
            <span className="sr-only">Filter artifacts by title, author or repository</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title, author or repo"
              className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-fog sm:text-[14px]"
            />
          </label>
          <p className="text-[13px] text-fog" aria-live="polite">
            {q ? `${shown.length} of ${artifacts.length} match` : `${artifacts.length} ${artifacts.length === 1 ? "artifact" : "artifacts"}`}
            {paged && " on this page"}
          </p>
        </div>
      )}
      <div className="overflow-hidden rounded-card border border-rule bg-paper-2">
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1fr)_11rem_7rem_6.5rem] gap-6 border-b border-rule bg-paper-3/50 px-5 py-2.5 text-[12.5px] font-medium text-fog md:grid lg:grid-cols-[minmax(0,1fr)_13rem_7rem_7rem]"
        >
          <span className="pl-12">Artifact</span>
          <span>{mine ? "Repository" : "Published by"}</span>
          <span>Versions</span>
          <span className="text-right">Updated</span>
        </div>
        <ul className="divide-y divide-rule">
          {rows.map((a) => (
            <Row key={a.id} artifact={a} mine={mine} />
          ))}
          {shown.length === 0 && (
            <li className="px-5 py-12 text-center text-[14.5px] text-fog">
              Nothing {paged ? "on this page " : ""}matches “{query.trim()}”.{" "}
              <button type="button" onClick={() => setQuery("")} className="font-medium text-intaglio underline-offset-4 hover:underline">
                Clear the filter
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Row({ artifact: a, mine }: { artifact: ArtifactSummary; mine: boolean }) {
  const title = a.title || "Untitled";
  const versions = a.versionCount || (a.version ?? 0);
  const who = mine ? a.repo : a.author;
  return (
    <li className="group relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3.5 px-4 py-3.5 transition-colors duration-150 hover:bg-paper-3/60 sm:px-5 md:grid-cols-[2rem_minmax(0,1fr)_11rem_7rem_6.5rem] md:items-center md:gap-x-6 md:py-3 lg:grid-cols-[2rem_minmax(0,1fr)_13rem_7rem_7rem]">
      <Seal id={a.id} size={32} className="mt-0.5 size-7! md:mt-0 md:size-8!" deferred />
      <div className="min-w-0">
        <a
          href={a.url}
          className="line-clamp-2 text-[15px] font-medium leading-snug text-ink outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-intaglio md:line-clamp-1"
        >
          {title}
        </a>
        {a.description && <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-fog md:line-clamp-1">{a.description}</p>}
        <div className="mt-1.5 space-y-0.5 text-[12.5px] text-fog md:hidden">
          {(a.repo || (!mine && a.author)) && (
            <p className="flex min-w-0 items-baseline gap-x-2.5">
              {!mine && a.author && <span className="min-w-0 shrink truncate text-ink-2">{a.author}</span>}
              {a.repo && <span className="min-w-0 shrink truncate font-mono text-[12px]">{a.repo}</span>}
            </p>
          )}
          <p className="flex items-baseline gap-x-2.5">
            <Time iso={a.updatedAt} />
            <VersionsLink artifact={a} count={versions} title={title} />
          </p>
        </div>
      </div>
      <div className="hidden min-w-0 text-[13.5px] md:block">
        {who ? <p className={mine ? "truncate font-mono text-[12px] text-fog" : "truncate text-ink-2"}>{who}</p> : <p className="text-fog">—</p>}
        {!mine && a.repo && <p className="mt-0.5 truncate font-mono text-[12px] text-fog">{a.repo}</p>}
      </div>
      <div className="hidden md:block">
        <VersionsLink artifact={a} count={versions} title={title} />
      </div>
      <Time iso={a.updatedAt} className="hidden text-right text-[13px] text-fog md:block" />
    </li>
  );
}

// The way into an artifact's history, named for what it holds.
function VersionsLink({ artifact, count, title }: { artifact: ArtifactSummary; count: number; title: string }) {
  return (
    <a
      href={`/history/${artifact.id}`}
      className="relative z-[1] inline-flex items-center gap-1 rounded-chip text-[12.5px] font-medium text-intaglio underline-offset-4 hover:underline md:text-[13px]"
    >
      {count === 1 ? "1 version" : `${count} versions`}
      <span className="sr-only"> of {title}</span>
    </a>
  );
}
