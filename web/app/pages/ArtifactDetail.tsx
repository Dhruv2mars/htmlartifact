import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { CopyLink } from "../components/CopyLink";
import { ArrowLeft, ChevronDown } from "../components/icons";
import { Seal } from "../components/Seal";
import { Rule } from "../components/Sheet";
import { Time } from "../components/Time";
import { cx } from "../lib/cx";
import { bytes, fullDate } from "../lib/time";
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
      <Rule width="app" inner="px-4 py-3 sm:px-5">
        <a href={artifact.mine ? "/mine" : "/"} className="inline-flex items-center gap-1.5 rounded-chip text-[13.5px] text-muted transition-colors duration-150 hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          {artifact.mine ? "My artifacts" : "All artifacts"}
        </a>
      </Rule>
      <Rule as="header" width="app" inner="grid md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 px-4 pb-8 pt-8 sm:px-5 sm:pt-10">
          <h1
            className={cx(
              "text-balance font-medium tracking-[-0.035em] text-foreground [overflow-wrap:anywhere]",
              long ? "text-[24px] leading-[1.15] sm:text-[28px]" : "text-page"
            )}
          >
            {artifact.title}
          </h1>
          {!artifact.mine && artifact.author && <p className="mt-2 text-[14px] text-muted [overflow-wrap:anywhere]">By {artifact.author}</p>}
          {artifact.description && <Description text={artifact.description} />}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-start">
            <ButtonLink href={artifact.url} className="shrink-0">
              Open latest version
            </ButtonLink>
            <CopyLink url={artifact.url} className="min-w-0 sm:max-w-[28rem] sm:flex-1" />
          </div>
        </div>
        <div className="lock hidden flex-col items-center justify-center gap-4 border-l border-line px-5 py-8 md:flex" style={{ "--d": "80ms" } as React.CSSProperties}>
          <Seal id={artifact.id} size={136} label={`Seal of artifact ${artifact.id}`} />
          <p className="font-mono text-[12px] text-faint">No. {artifact.id}</p>
        </div>
      </Rule>
      <section aria-labelledby="versions">
        <Rule width="app" inner="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5">
          <h2 id="versions" className="font-mono text-[12.5px] text-muted">
            Versions
          </h2>
          <p className="font-mono text-[12.5px] text-faint">
            {versions.length} {versions.length === 1 ? "version" : "versions"}, newest first
          </p>
        </Rule>
        <Rule width="app" inner="">
          <ol className="divide-y divide-line">
            {shown.map((v, i) => (
              <Version key={v.number} version={v} current={i === 0} />
            ))}
          </ol>
        </Rule>
      </section>
      <div aria-hidden className="mx-auto w-full max-w-[1040px] flex-1 border-x border-line" />
    </AppShell>
  );
}

// Long descriptions show three lines until asked for the rest.
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div className="mt-3 max-w-[64ch]">
      <p className={cx("text-[14.5px] leading-relaxed text-muted [overflow-wrap:anywhere]", long && !open && "line-clamp-3")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-[13.5px] text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground">
          {open ? "Show less" : "Show the full description"}
        </button>
      )}
    </div>
  );
}

function Version({ version: v, current }: { version: ArtifactVersion; current: boolean }) {
  // Uploads from outside git have no commit message: name the version instead.
  const subject = v.subject || `Version ${v.number}`;
  const [open, setOpen] = useState(false);
  const details = `version-${v.number}-details`;
  return (
    <li className="group relative grid grid-cols-[4rem_minmax(0,1fr)] transition-colors duration-150 hover:bg-surface sm:grid-cols-[4.5rem_minmax(0,1fr)_9rem]">
      <span className="border-r border-line px-4 py-4 font-mono text-[13px] text-foreground">v{v.number}</span>
      <div className="min-w-0 px-4 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={v.url}
            className="line-clamp-2 min-w-0 text-[14.5px] leading-snug text-foreground outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-foreground"
          >
            <span className="sr-only">Open version {v.number}: </span>
            {subject}
          </a>
          {current && <span className="shrink-0 rounded-[5px] border border-border px-1.5 font-mono text-[11.5px] leading-[18px] text-foreground">latest</span>}
          {v.dirty && <span className="shrink-0 rounded-[5px] bg-ask-wash px-1.5 font-mono text-[11.5px] leading-[18px] text-ask">uncommitted</span>}
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
          {v.branch && <span className="min-w-0 max-w-full truncate">{v.branch}</span>}
          {v.commit && <span>{v.commit}</span>}
          <span>{bytes(v.size)}</span>
          <Time iso={v.createdAt} className="sm:hidden" />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={details}
            className="relative z-[1] -my-1 inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 font-sans text-[12.5px] text-foreground hover:bg-card"
          >
            {open ? "Hide details" : "Details"}
            <span className="sr-only"> of version {v.number}</span>
            <ChevronDown className={cx("size-3.5 transition-transform duration-150", open && "rotate-180")} />
          </button>
        </div>
        {open && (
          <dl id={details} className="relative z-[1] mt-3 grid gap-x-4 gap-y-2 rounded-control border border-line bg-card p-3.5 text-[13.5px] sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-muted">Commit message</dt>
            <dd className={cx("[overflow-wrap:anywhere]", v.subject ? "text-foreground" : "text-muted")}>{v.subject ?? "None (uploaded outside a git repository, or without a commit)"}</dd>
            <dt className="text-muted">Branch</dt>
            <dd className="font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">{v.branch ?? "None"}</dd>
            <dt className="text-muted">Commit</dt>
            <dd className="font-mono text-[12.5px] text-foreground">
              {v.commit ?? "None"}
              {v.dirty && <span className="ml-2 font-sans text-ask">with uncommitted changes</span>}
            </dd>
            <dt className="text-muted">Size</dt>
            <dd className="text-foreground">{bytes(v.size)}</dd>
            <dt className="text-muted">Published</dt>
            <dd className="text-foreground">{fullDate(v.createdAt) || "Unknown"}</dd>
          </dl>
        )}
      </div>
      <Time iso={v.createdAt} className="hidden px-4 py-4 text-right font-mono text-[12.5px] text-muted sm:block" />
    </li>
  );
}
