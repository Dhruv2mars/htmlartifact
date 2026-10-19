import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { CopyText } from "../components/CopyText";
import { ArrowUpRight } from "../components/icons";
import { Seal } from "../components/Seal";
import { Time } from "../components/Time";
import { bytes } from "../lib/time";
import type { ArtifactVersion, Session } from "../page";

const SERVER_ROWS = 30;

export function ArtifactDetail({
  session,
  artifact,
  versions
}: {
  session: Session;
  artifact: { id: string; title: string; description: string | null; url: string };
  versions: ArtifactVersion[];
}) {
  // Like the feed: the server renders the newest versions only (Workers Free
  // allows 10 ms of CPU), the browser renders the rest after hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const shown = hydrated ? versions : versions.slice(0, SERVER_ROWS);
  return (
    <AppShell session={session} section="mine">
      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <a href="/mine" className="text-[14px] text-fog transition-colors duration-150 hover:text-ink">
          My artifacts
        </a>
        <div className="mt-6 grid gap-8 *:min-w-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div>
            <h1 className="text-balance font-wide text-[32px] [overflow-wrap:anywhere] font-[720] leading-[1.05] tracking-[-0.03em] text-ink sm:text-[42px]">{artifact.title}</h1>
            {artifact.description && <p className="mt-3 max-w-[60ch] text-[15.5px] leading-relaxed text-fog">{artifact.description}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <ButtonLink href={artifact.url} target="_blank" rel="noopener noreferrer">
                Open
                <ArrowUpRight className="size-3.5" />
              </ButtonLink>
              <div className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-rule bg-paper-2 py-1 pl-4 pr-1">
                <span className="truncate font-mono text-[12px] text-fog">{artifact.url}</span>
                <CopyText text={artifact.url} label="Copy link" />
              </div>
            </div>
          </div>
          <div className="hidden md:block">
            <Seal id={artifact.id} size={168} label={`Seal of ${artifact.id}`} />
            <p className="mt-2 text-center font-mono text-[11px] text-fog">{artifact.id}</p>
          </div>
        </div>

        <h2 className="mt-14 font-wide text-[19px] font-[680] tracking-[-0.015em] text-ink">
          {versions.length} {versions.length === 1 ? "version" : "versions"}
        </h2>
        <ol className="mt-4 overflow-hidden rounded-2xl border border-rule bg-paper-2">
          {shown.map((v, i) => (
            <li key={v.number} className="relative grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 border-b border-rule px-4 py-4 last:border-b-0 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:px-5">
              <a
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[13px] text-intaglio outline-none after:absolute after:inset-0 hover:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-intaglio"
              >
                v{v.number}
              </a>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="min-w-0 max-w-full truncate text-[14.5px] text-ink">{v.subject || (i === 0 ? "Latest version" : "No commit message")}</p>
                  {i === 0 && <span className="shrink-0 rounded-full bg-wash px-2 py-0.5 text-[11px] font-medium text-intaglio">Current</span>}
                  {v.dirty && <span className="shrink-0 rounded-full bg-hold/12 px-2 py-0.5 text-[11px] font-medium text-hold">Uncommitted changes</span>}
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11.5px] text-fog">
                  {v.branch && <span className="max-w-[16rem] truncate">{v.branch}</span>}
                  {v.commit && <span>{v.commit}</span>}
                  <span>{bytes(v.size)}</span>
                  <Time iso={v.createdAt} className="font-sans text-[12.5px] sm:hidden" />
                </p>
              </div>
              <Time iso={v.createdAt} className="hidden self-center text-[12.5px] text-fog sm:block" />
            </li>
          ))}
        </ol>
      </main>
    </AppShell>
  );
}
