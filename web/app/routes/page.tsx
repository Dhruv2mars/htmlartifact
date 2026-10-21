import { useRouteLoaderData, type MetaDescriptor, type MetaFunction } from "react-router";
import { lazy, Suspense } from "react";
import { Message, NotFound, SignIn } from "../pages/Bare";

// Split by audience: the landing's motion code never ships to the app, and
// the app's menus and palette never ship to the landing. The server renders
// the whole page first (entry.server waits for allReady), so the HTML is
// complete; the browser hydrates once the page's chunk arrives.
const Landing = lazy(() => import("../landing/Landing").then((m) => ({ default: m.Landing })));
const Docs = lazy(() => import("../pages/Docs").then((m) => ({ default: m.Docs })));
const Privacy = lazy(() => import("../pages/Privacy").then((m) => ({ default: m.Privacy })));
const Feed = lazy(() => import("../pages/Feed").then((m) => ({ default: m.Feed })));
const Mine = lazy(() => import("../pages/Feed").then((m) => ({ default: m.Mine })));
const ArtifactDetail = lazy(() => import("../pages/ArtifactDetail").then((m) => ({ default: m.ArtifactDetail })));
const Workspaces = lazy(() => import("../pages/Workspaces").then((m) => ({ default: m.Workspaces })));
const Join = lazy(() => import("../pages/Join").then((m) => ({ default: m.Join })));
import type { Page } from "../page";

export const meta: MetaFunction = ({ matches }) => {
  const page = matches.find((m) => m?.id === "root")?.loaderData as (Page & { origin: string }) | undefined;
  const title = titleFor(page);
  const tags: MetaDescriptor[] = [{ title }, { name: "description", content: DESCRIPTION }];
  // Only public pages get a social preview; private pages stay bare.
  if (page && (page.kind === "landing" || page.kind === "docs" || page.kind === "privacy")) {
    const image = `${page.origin}/og.png`;
    tags.push(
      { property: "og:type", content: "website" },
      { property: "og:title", content: page.kind === "landing" ? "htmlartifact: Members only." : title },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: image }
    );
  }
  return tags;
};

const DESCRIPTION =
  "Publish the HTML your coding agents write (plans, specs, reviews, reports) to links only your workspace can open.";

function titleFor(page: Page | undefined): string {
  switch (page?.kind) {
    case "landing":
      return "htmlartifact: members-only links for the HTML your agents write";
    case "docs":
      return "Docs · htmlartifact";
    case "privacy":
      return "Privacy · htmlartifact";
    case "sign-in":
      return "Sign in · htmlartifact";
    case "message":
      return `${page.title} · htmlartifact`;
    case "not-found":
      return "Not found · htmlartifact";
    case "feed":
      return `${page.session.workspace?.name ?? "Workspace"} · htmlartifact`;
    case "mine":
      return "My artifacts · htmlartifact";
    case "artifact":
      return `${page.artifact.title} · htmlartifact`;
    case "workspaces":
      return "Workspaces · htmlartifact";
    case "join":
      return `${page.member ? page.workspace.name : `Join ${page.workspace.name}`} · htmlartifact`;
    default:
      return "htmlartifact";
  }
}

export default function PageRoute() {
  return (
    <Suspense fallback={null}>
      <PageBody />
    </Suspense>
  );
}

function PageBody() {
  const page = useRouteLoaderData("root") as Page;
  switch (page.kind) {
    case "landing":
      return <Landing session={page.session} />;
    case "docs":
      return <Docs session={page.session} />;
    case "privacy":
      return <Privacy session={page.session} />;
    case "sign-in":
      return <SignIn next={page.next} />;
    case "message":
      return <Message title={page.title} message={page.message} retry={page.retry} />;
    case "not-found":
      return <NotFound />;
    case "feed":
      return <Feed session={page.session} artifacts={page.artifacts} older={page.older} />;
    case "mine":
      return <Mine session={page.session} artifacts={page.artifacts} older={page.older} />;
    case "artifact":
      return <ArtifactDetail session={page.session} artifact={page.artifact} versions={page.versions} />;
    case "workspaces":
      return <Workspaces session={page.session} workspaces={page.workspaces} next={page.next} />;
    case "join":
      return <Join {...page} />;
  }
}
