import { useSearchParams } from "react-router";
import { AppShell, PageHead } from "../components/AppShell";
import { ArtifactList } from "../components/ArtifactList";
import { ButtonLink } from "../components/Button";
import { CommandBlock } from "../components/CommandBlock";
import type { ArtifactSummary, Session } from "../page";

export function Feed({ session, artifacts, older }: { session: Session; artifacts: ArtifactSummary[]; older: string | null }) {
  const name = session.workspace?.name ?? "Workspace";
  // "?q=" pre-fills the filter (search from other pages lands here), on the
  // server and in the browser alike.
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  return (
    <AppShell session={session} section="feed" artifacts={artifacts}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-9 sm:px-6 sm:pt-12">
        <PageHead title={name}>Everything published in {name}, newest first. Only members can open these links.</PageHead>
        <div className="mt-8">
          {artifacts.length ? (
            <>
              <ArtifactList artifacts={artifacts} paged={Boolean(older)} initialQuery={q} />
              <Older href={older && q ? `${older}&q=${encodeURIComponent(q)}` : older} />
            </>
          ) : (
            <FirstArtifact workspace={name} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

export function Mine({ session, artifacts, older }: { session: Session; artifacts: ArtifactSummary[]; older: string | null }) {
  const name = session.workspace?.name ?? "this workspace";
  return (
    <AppShell session={session} section="mine" artifacts={artifacts}>
      <div className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-9 sm:px-6 sm:pt-12">
        <PageHead title="My artifacts">What you've published in {name}. Open an artifact's versions to see its history.</PageHead>
        <div className="mt-8">
          {artifacts.length ? (
            <>
              <ArtifactList artifacts={artifacts} mine paged={Boolean(older)} />
              <Older href={older} />
            </>
          ) : (
            <FirstArtifact workspace={name} mine />
          )}
        </div>
      </div>
    </AppShell>
  );
}

// An empty workspace: the two commands that fill it, in full.
function FirstArtifact({ workspace, mine = false }: { workspace: string; mine?: boolean }) {
  return (
    <section aria-labelledby="first" className="grid gap-8 rounded-card border border-rule bg-paper-2 p-5 sm:p-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div>
        <h2 id="first" className="font-wide text-[22px] font-[700] tracking-[-0.02em] text-ink">
          {mine ? "You haven't published anything here yet" : "Nothing published yet"}
        </h2>
        <p className="mt-2 max-w-[44ch] text-[15px] leading-relaxed text-fog">
          Publish any HTML file your agent wrote: a plan, a review, a report. It appears here, and only people in {workspace} can open
          its link.
        </p>
        <ButtonLink href="/docs#agents" tone="line" size="sm" className="mt-5">
          Let your agent publish
        </ButtonLink>
      </div>
      <ol className="space-y-5">
        <li>
          <p className="mb-2 text-[13.5px] font-medium text-ink">1. Sign in from your terminal, once per machine</p>
          <CommandBlock commands={["npx htmlartifact login"]} />
        </li>
        <li>
          <p className="mb-2 text-[13.5px] font-medium text-ink">2. Publish a file</p>
          <CommandBlock
            commands={["npx htmlartifact upload plan.html"]}
            note="Replace plan.html with your file, or a folder with an index.html. Upload the same path again to publish a new version at the same link."
          />
        </li>
      </ol>
    </section>
  );
}

// The feed is paged, newest first; this opens the next page.
function Older({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <div className="mt-6 flex justify-center">
      <ButtonLink href={href} tone="line">
        Show older artifacts
      </ButtonLink>
    </div>
  );
}
