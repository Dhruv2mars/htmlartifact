import { useState } from "react";
import { useSearchParams } from "react-router";
import { AppShell, PageHead } from "../components/AppShell";
import { ArtifactList } from "../components/ArtifactList";
import { ButtonLink } from "../components/Button";
import { CommandBlock } from "../components/CommandBlock";
import { Rule } from "../components/Sheet";
import { bytes } from "../lib/time";
import type { ArtifactSummary, Session, Usage } from "../page";

export function Feed({ session, artifacts, older, usage }: { session: Session; artifacts: ArtifactSummary[]; older: string | null; usage: Usage | null }) {
  const name = session.workspace?.name ?? "Workspace";
  return (
    <AppShell session={session} section="feed" artifacts={artifacts}>
      <PageHead title={name} count={artifacts.length || undefined}>
        Everything published in {name}, newest first. Only members can open these links.
      </PageHead>
      {usage && <NearlyFull usage={usage} workspace={name} admin={session.role === "admin"} />}
      {artifacts.length ? <Listing artifacts={artifacts} older={older} /> : <FirstArtifact workspace={name} admin={session.role === "admin"} />}
      <Fill />
    </AppShell>
  );
}

export function Mine({ session, artifacts, older, usage }: { session: Session; artifacts: ArtifactSummary[]; older: string | null; usage: Usage | null }) {
  const name = session.workspace?.name ?? "this workspace";
  return (
    <AppShell session={session} section="mine" artifacts={artifacts}>
      <PageHead title="My artifacts" count={artifacts.length || undefined}>
        What you've published in {name}. Open an artifact's versions to see its history.
      </PageHead>
      {usage && <NearlyFull usage={usage} workspace={name} admin={session.role === "admin"} />}
      {artifacts.length ? <Listing artifacts={artifacts} older={older} mine /> : <FirstArtifact workspace={name} mine />}
      <Fill />
    </AppShell>
  );
}

// An empty workspace: the commands that fill it, in full (the CLI publishes
// to its own current workspace, which may not be this one), and, for an
// admin, the way to bring the team in.
function FirstArtifact({ workspace, mine = false, admin = false }: { workspace: string; mine?: boolean; admin?: boolean }) {
  return (
    <Rule as="section" width="app" labelledBy="first" inner="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="border-b border-line px-4 py-8 sm:px-5 lg:border-b-0 lg:border-r">
        <h2 id="first" className="text-[18px] font-medium tracking-[-0.02em] text-foreground">
          {mine ? "You haven't published anything here yet" : "Nothing published yet"}
        </h2>
        <p className="mt-2 max-w-[44ch] text-[14.5px] leading-relaxed text-muted">
          Publish any HTML file your agent wrote: a plan, a review, a report. It appears here, and only people in {workspace} can
          open its link.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {admin && (
            <ButtonLink href="/people#links" size="sm">
              Invite your team
            </ButtonLink>
          )}
          <ButtonLink href="/docs#agents" tone="line" size="sm">
            Let your agent publish
          </ButtonLink>
        </div>
      </div>
      <ol className="space-y-5 bg-surface/50 px-4 py-8 sm:px-5">
        <li>
          <p className="mb-2 font-mono text-[12.5px] text-muted">01 Sign in from your terminal, once per machine</p>
          <CommandBlock commands={["npx htmlartifact login"]} />
        </li>
        <li>
          <p className="mb-2 font-mono text-[12.5px] text-muted">02 In more than one workspace? Publish to this one</p>
          <CommandBlock commands={[`npx htmlartifact workspace switch ${shellWord(workspace)}`]} />
        </li>
        <li>
          <p className="mb-2 font-mono text-[12.5px] text-muted">03 Publish a file</p>
          <CommandBlock
            commands={["npx htmlartifact upload plan.html"]}
            note="Replace plan.html with your file, or a folder with an index.html. Upload the same path again to publish a new version at the same link."
          />
        </li>
      </ol>
    </Rule>
  );
}

// The workspace is nearly full: say how full, what stops, and the way out,
// before CI fails cold.
function NearlyFull({ usage, workspace, admin }: { usage: Usage; workspace: string; admin: boolean }) {
  const percent = Math.min(100, Math.round((usage.storedBytes / usage.limitBytes) * 100));
  return (
    <Rule width="app" inner="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-5">
      <p className="min-w-0 flex-1 basis-72 text-[14px] leading-relaxed text-foreground">
        {workspace} has used <span className="font-mono tabular-nums">{bytes(usage.storedBytes)}</span> of{" "}
        <span className="font-mono tabular-nums">{bytes(usage.limitBytes)}</span> ({percent}%). Uploads stop when it's full: prune old versions with{" "}
        <code className="font-mono text-[12.5px]">npx htmlartifact prune</code> or delete what nobody needs.
      </p>
      {admin && (
        <ButtonLink href="/settings#storage" tone="line" size="sm">
          Storage
        </ButtonLink>
      )}
    </Rule>
  );
}

// A workspace name as one shell word: bare when it is safe, else single-quoted.
const shellWord = (word: string) => (/^[\w.@%+=:,/-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

// The rails run to the bottom of the screen on short pages.
function Fill() {
  return <div aria-hidden className="mx-auto w-full max-w-[1040px] flex-1 border-x border-line" />;
}

// A feed page and its filter. "?q=" pre-fills the filter (search from other
// pages lands here) on the server and in the browser alike; the filter as it
// stands now travels with the link to the next, older page.
function Listing({ artifacts, older, mine = false }: { artifacts: ArtifactSummary[]; older: string | null; mine?: boolean }) {
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const paged = Boolean(older) || params.has("cursor");
  const q = query.trim();
  return (
    <>
      <ArtifactList
        artifacts={artifacts}
        mine={mine}
        paged={paged}
        filterable={artifacts.length > 6 || paged || params.has("q")}
        query={query}
        onQueryChange={setQuery}
      />
      <Older href={older && q ? `${older}&q=${encodeURIComponent(q)}` : older} />
    </>
  );
}

// The feed is paged, newest first; this opens the next page.
function Older({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <Rule width="app" inner="flex justify-center px-4 py-4">
      <ButtonLink href={href} tone="line" size="sm">
        Show older artifacts
      </ButtonLink>
    </Rule>
  );
}
