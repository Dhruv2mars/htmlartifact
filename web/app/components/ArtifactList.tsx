import { useDeferredValue, useState } from "react";
import type { ArtifactSummary } from "../page";
import { ArrowUpRight, SearchIcon } from "./icons";
import { Seal } from "./Seal";
import { Time } from "./Time";

// A feed of artifacts. Titles open the artifact in a new tab; on "Mine",
// each row also links to its version history.
export function ArtifactList({ artifacts, mine = false }: { artifacts: ArtifactSummary[]; mine?: boolean }) {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const shown = q
    ? artifacts.filter((a) => [a.title, a.description, a.author, a.repo].some((v) => v?.toLowerCase().includes(q)))
    : artifacts;

  return (
    <div>
      {artifacts.length > 6 && (
        <label className="mb-4 flex h-11 items-center gap-2.5 rounded-xl border border-rule bg-paper-2 px-3.5 text-fog focus-within:border-intaglio">
          <SearchIcon className="size-4 shrink-0" />
          <span className="sr-only">Filter artifacts</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${artifacts.length} artifacts`}
            className="h-full w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-fog sm:text-[14.5px]"
          />
        </label>
      )}
      <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-paper-2">
        {shown.map((a) => (
          <li key={a.id} className="group relative flex items-start gap-4 px-4 py-4 transition-colors duration-150 hover:bg-paper sm:items-center sm:px-5">
            <Seal id={a.id} size={44} className="mt-0.5 sm:mt-0" />
            <div className="min-w-0 flex-1">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-intaglio"
              >
                {a.title || "Untitled"}
              </a>
              {a.description && <p className="mt-0.5 truncate text-[13.5px] text-fog">{a.description}</p>}
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-fog">
                {!mine && a.author && <span className="max-w-[16rem] truncate text-ink-2">{a.author}</span>}
                {a.repo && <span className="max-w-[18rem] truncate">{a.repo}</span>}
                {a.version != null && <span className="tabular-nums">v{a.version}</span>}
                <Time iso={a.updatedAt} className="sm:hidden" />
              </p>
            </div>
            <Time iso={a.updatedAt} className="hidden shrink-0 text-[12.5px] text-fog sm:block" />
            {mine ? (
              <a
                href={`/mine/${a.id}`}
                className="press relative z-[1] shrink-0 rounded-full border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 hover:border-rule-2 hover:text-ink"
              >
                History
              </a>
            ) : (
              <ArrowUpRight className="hidden size-4 shrink-0 text-fog opacity-0 transition-opacity duration-150 group-hover:opacity-100 sm:block" />
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="px-5 py-10 text-center text-[14px] text-fog">No artifact matches “{query}”.</li>}
      </ul>
    </div>
  );
}
