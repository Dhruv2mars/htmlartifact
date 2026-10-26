import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { CopyText } from "../components/CopyText";
import { ArrowLeft } from "../components/icons";
import { Seal } from "../components/Seal";
import { Time } from "../components/Time";
import { cx } from "../lib/cx";
import { bytes } from "../lib/time";
import type { ArtifactHead, ArtifactVersion, Session } from "../page";

const SERVER_ROWS = 30;

// An artifact's history: what it is, the link to share, and every version.
export function ArtifactDetail({ session, artifact, versions }: { session: Session; artifact: ArtifactHead; versions: ArtifactVersion[] }) {
  // Like the feed: the server renders the newest versions only (Workers Free
  // allows 10 ms of CPU), the browser renders the rest after hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const shown = hydrated ? versions : versions.slice(0, SERVER_ROWS);
  const long = artifact.title.length > 60;
  return (
    <AppShell session={session} section={artifact.mine ? "mine" : "feed"}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-6 sm:px-6 sm:pt-9">
        <a
          href={artifact.mine ? "/mine" : "/"}
          className="inline-flex items-center gap-1.5 rounded-chip text-[14px] text-fog transition-colors duration-150 hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          {artifact.mine ? "My artifacts" : "All artifacts"}
        </a>

        <header className="mt-6 grid gap-8 *:min-w-0 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12">
          <div>
            <h1
              className={cx(
                "text-balance font-wide font-[720] tracking-[-0.03em] text-ink [overflow-wrap:anywhere]",
                long ? "text-[24px] leading-[1.15] sm:text-[28px]" : "text-page"
              )}
            >
              {artifact.title}
            </h1>
            {!artifact.mine && artifact.author && <p className="mt-2.5 text-[14.5px] text-ink-2 [overflow-wrap:anywhere]">By {artifact.author}</p>}
            {artifact.description && <Description text={artifact.description} />}
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <ButtonLink href={artifact.url} className="shrink-0">
                Open latest version
              </ButtonLink>
              <div className="flex h-10 min-w-0 items-center gap-1 rounded-control border border-rule-2 bg-paper-2 pl-3.5 pr-1 sm:max-w-[30rem] sm:flex-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fog" title={artifact.url}>
                  {artifact.url}
                </span>
                <CopyText text={artifact.url} label="Copy link" />
              </div>
            </div>
          </div>
          <div className="hidden md:block">
            <Seal id={artifact.id} size={152} label={`Seal of artifact ${artifact.id}`} />
            <p className="mt-3 text-center font-mono text-[12px] text-fog">No. {artifact.id}</p>
          </div>
        </header>

        <section aria-labelledby="versions" className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="versions" className="font-wide text-[19px] font-[700] tracking-[-0.015em] text-ink">
              Versions
            </h2>
            <p className="text-[13px] text-fog">
              {versions.length} {versions.length === 1 ? "version" : "versions"}, newest first
            </p>
          </div>
          <ol className="mt-3 divide-y divide-rule overflow-hidden rounded-card border border-rule bg-paper-2">
            {shown.map((v, i) => (
              <Version key={v.number} version={v} current={i === 0} />
            ))}
          </ol>
        </section>
      </div>
    </AppShell>
  );
}

// Long descriptions show three lines until asked for the rest.
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div className="mt-3 max-w-[64ch]">
      <p className={cx("text-[15.5px] leading-relaxed text-fog [overflow-wrap:anywhere]", long && !open && "line-clamp-3")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-[13.5px] font-medium text-intaglio underline-offset-4 hover:underline">
          {open ? "Show less" : "Show the full description"}
        </button>
      )}
    </div>
  );
}

function Version({ version: v, current }: { version: ArtifactVersion; current: boolean }) {
  const subject = v.subject || (current ? "Latest version" : "No commit message");
  return (
    <li className="group relative grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 px-4 py-4 transition-colors duration-150 hover:bg-paper-3/60 sm:grid-cols-[3.75rem_minmax(0,1fr)_auto] sm:px-5">
      <span className="pt-px font-mono text-[13px] font-medium text-ink">v{v.number}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={v.url}
            title={v.subject ?? undefined}
            className="line-clamp-2 min-w-0 text-[15px] leading-snug text-ink outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-intaglio"
          >
            <span className="sr-only">Open version {v.number}: </span>
            {subject}
          </a>
          {current && <span className="shrink-0 rounded-chip bg-wash px-1.5 py-0.5 text-[12px] font-medium text-intaglio">Latest</span>}
          {v.dirty && <span className="shrink-0 rounded-chip bg-hold-wash px-1.5 py-0.5 text-[12px] font-medium text-hold">Uncommitted changes</span>}
        </div>
        <p className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12px] text-fog">
          {v.branch && (
            <span className="min-w-0 max-w-full truncate" title={v.branch}>
              {v.branch}
            </span>
          )}
          {v.commit && <span>{v.commit}</span>}
          <span>{bytes(v.size)}</span>
          <Time iso={v.createdAt} className="font-sans text-[12.5px] sm:hidden" />
        </p>
      </div>
      <Time iso={v.createdAt} className="hidden self-start pt-0.5 text-right text-[13px] text-fog sm:block" />
    </li>
  );
}
