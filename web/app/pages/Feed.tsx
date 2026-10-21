import { AppShell, PageHead } from "../components/AppShell";
import { ButtonLink } from "../components/Button";
import { ArtifactList } from "../components/ArtifactList";
import { Empty } from "../components/Empty";
import type { ArtifactSummary, Session } from "../page";

export function Feed({ session, artifacts, older }: { session: Session; artifacts: ArtifactSummary[]; older: string | null }) {
  const name = session.workspace?.name ?? "Workspace";
  return (
    <AppShell session={session} section="feed" artifacts={artifacts}>
      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <PageHead title={name}>
          Everything {name} has published. Only members can open these.
        </PageHead>
        <div className="mt-10">
          {artifacts.length ? (
            <>
              <ArtifactList artifacts={artifacts} />
              <Older href={older} />
            </>
          ) : (
            <Empty seed={session.workspace?.id ?? name} title="Nothing published yet" commands={["npx htmlartifact upload plan.html"]}>
              Ask your agent to publish its next plan, or run this yourself. It shows up here for everyone in {name}.
            </Empty>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export function Mine({ session, artifacts, older }: { session: Session; artifacts: ArtifactSummary[]; older: string | null }) {
  return (
    <AppShell session={session} section="mine" artifacts={artifacts}>
      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <PageHead title="My artifacts">
          What you've published in {session.workspace?.name ?? "this workspace"}. Open one's history to see every version.
        </PageHead>
        <div className="mt-10">
          {artifacts.length ? (
            <>
              <ArtifactList artifacts={artifacts} mine />
              <Older href={older} />
            </>
          ) : (
            <Empty seed={`${session.name}-mine`} title="You haven't published anything here" commands={["npx htmlartifact upload plan.html"]}>
              Publish a file or a folder of HTML. Upload the same path again later and it becomes a new version at the same link.
            </Empty>
          )}
        </div>
      </main>
    </AppShell>
  );
}

// The feed is paged, newest first; this opens the next page.
function Older({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <div className="mt-6 flex justify-center">
      <ButtonLink href={href} tone="ghost">
        Older artifacts
      </ButtonLink>
    </div>
  );
}
