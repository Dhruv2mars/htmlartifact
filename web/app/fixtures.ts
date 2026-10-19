import type { ArtifactSummary, ArtifactVersion, Page, Session } from "./page";

// Dev-only pages for `react-router dev` (the real Worker supplies these).
// Pick one with ?page=<kind>; add &fixture=worst for break-ui data, or
// &fixture=empty for empty states.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const session: Session = {
  name: "Priya Raman",
  email: "priya@northwind.dev",
  workspace: { id: "org_01NWND", name: "Northwind", handle: "northwind" }
};

const artifacts: ArtifactSummary[] = [
  { id: "k3j9x0a1b2c4", title: "Billing migration plan", description: "Six weeks from legacy invoices to the new ledger, with dual writes.", author: "Priya Raman", url: "https://htmlartifact.pages.dev/d/k3j9x0a1b2c4", repo: "northwind/billing", version: 3, versionCount: 3, updatedAt: ago(12) },
  { id: "r7v2kq9d0m3a", title: "Code review: session refresh race", description: null, author: "Marcus Lee", url: "https://htmlartifact.pages.dev/d/r7v2kq9d0m3a", repo: "northwind/auth", version: 1, versionCount: 1, updatedAt: ago(64) },
  { id: "w2e8pl5n1x6c", title: "Pricing page, three directions", description: "Mocks A, B and C with the copy variants.", author: "Wen Zhao", url: "https://htmlartifact.pages.dev/d/w2e8pl5n1x6c", repo: "northwind/web", version: 5, versionCount: 5, updatedAt: ago(190) },
  { id: "h6t1zc8b4q2r", title: "Postmortem: queue backlog on Oct 14", description: null, author: "Diego Alvarez", url: "https://htmlartifact.pages.dev/d/h6t1zc8b4q2r", repo: "northwind/infra", version: 2, versionCount: 2, updatedAt: ago(1500) },
  { id: "y9m3fa0s7u1k", title: "Public API v2 spec", description: "Endpoints, pagination and the deprecation timeline.", author: "Priya Raman", url: "https://htmlartifact.pages.dev/d/y9m3fa0s7u1k", repo: "northwind/api", version: 7, versionCount: 7, updatedAt: ago(8000) },
  { id: "c4b7n2m9q1z8", title: "Q4 onboarding funnel report", description: null, author: "Wen Zhao", url: "https://htmlartifact.pages.dev/d/c4b7n2m9q1z8", repo: null, version: 1, versionCount: 1, updatedAt: ago(20000) },
  { id: "f5g6h7j8k9l0", title: "Search ranking experiment readout", description: "Variant B wins on long-tail queries.", author: "Marcus Lee", url: "https://htmlartifact.pages.dev/d/f5g6h7j8k9l0", repo: "northwind/search", version: 2, versionCount: 2, updatedAt: ago(40000) }
];

const LONG = "Supercalifragilisticexpialidocious-migration-plan-for-the-entire-billing-and-invoicing-platform-v2-final-FINAL";
const worstSession: Session = {
  name: "Maximiliana Alexandrovna Konstantinopoulou-Wolfeschlegelsteinhausen",
  email: "maximiliana.alexandrovna.konstantinopoulou@extremely-long-subdomain.example-corporation.co.uk",
  workspace: { id: "org_WORST", name: "株式会社 Globex International Holdings Research & Development Division (EMEA)", handle: "globex" }
};
const worstArtifacts: ArtifactSummary[] = [
  { id: "aaaaaaaaaaaa", title: LONG, description: "x".repeat(400), author: worstSession.name, url: `https://htmlartifact.pages.dev/w/globex/${"very-long-slug-".repeat(8)}`, repo: "an-organisation-with-a-long-name/a-repository-with-an-even-longer-name", version: 9999, versionCount: 9999, updatedAt: ago(60 * 24 * 900) },
  { id: "b", title: "A", description: null, author: null, url: "https://htmlartifact.pages.dev/d/b", repo: null, version: null, versionCount: 0, updatedAt: null },
  { id: "zzzzzzzzzzzz", title: "🚀🔥 Plan: émigré façade naïve 日本語のタイトル とても長いタイトルです العربية", description: "Ünïcödé everywhere ✨", author: "李小龍", url: "https://htmlartifact.pages.dev/d/zzzzzzzzzzzz", repo: "x/y", version: 1, versionCount: 1, updatedAt: ago(1) },
  ...Array.from({ length: 40 }, (_, i) => ({ ...artifacts[i % artifacts.length]!, id: `gen${String(i).padStart(9, "0")}`, title: `${artifacts[i % artifacts.length]!.title} #${i + 1}` }))
];

const versions = (n: number, worst = false): ArtifactVersion[] =>
  Array.from({ length: n }, (_, i) => ({
    number: n - i,
    url: `https://htmlartifact.pages.dev/d/k3j9x0a1b2c4/v/${n - i}`,
    subject: worst ? (i % 2 ? null : `${LONG} ${LONG}`) : ["Add rollback plan", "Address review: proration", "First draft"][i % 3]!,
    branch: worst ? "feature/an-extremely-long-branch-name-that-goes-on-and-on-forever" : "plan/billing-ledger",
    commit: i % 4 === 3 ? null : "4f2a9c1",
    dirty: i === 0,
    size: [18_432, 912, 5_242_880][i % 3]!,
    createdAt: ago(i * 300 + 12)
  }));

export function fixturePage(url: URL): Page {
  const kind = url.searchParams.get("page") ?? (url.pathname === "/" ? "landing" : url.pathname.slice(1));
  const worst = url.searchParams.get("fixture") === "worst";
  const empty = url.searchParams.get("fixture") === "empty";
  const s = worst ? worstSession : session;
  const list = empty ? [] : worst ? worstArtifacts : artifacts;
  switch (kind) {
    case "docs":
      return { kind: "docs", session: null };
    case "sign-in":
      return { kind: "sign-in", next: "/d/k3j9x0a1b2c4" };
    case "message":
      return { kind: "message", title: "Invite not valid", message: "That invite is invalid, expired, or used up.", retry: false, session: null };
    case "not-found":
      return { kind: "not-found", session: null };
    case "feed":
      return { kind: "feed", session: s, artifacts: list };
    case "mine":
      return { kind: "mine", session: s, artifacts: list.filter((a, i) => worst || i % 2 === 0) };
    case "artifact":
      return {
        kind: "artifact",
        session: s,
        artifact: worst
          ? { id: "aaaaaaaaaaaa", title: LONG, description: "y".repeat(300), url: worstArtifacts[0]!.url }
          : { id: "k3j9x0a1b2c4", title: "Billing migration plan", description: "Six weeks from legacy invoices to the new ledger, with dual writes.", url: "https://htmlartifact.pages.dev/d/k3j9x0a1b2c4" },
        versions: versions(worst ? 60 : 3, worst)
      };
    case "workspaces":
      return {
        kind: "workspaces",
        session: empty ? { ...s, workspace: null } : s,
        workspaces: empty ? [] : worst ? [{ id: "org_WORST", name: worstSession.workspace!.name, current: true }, ...Array.from({ length: 12 }, (_, i) => ({ id: `org_${i}`, name: `Workspace ${i} ${"long ".repeat(i)}`, current: false }))] : [{ id: "org_01NWND", name: "Northwind", current: true }, { id: "org_01SIDE", name: "Side project", current: false }],
        next: url.searchParams.has("next") ? "/d/k3j9x0a1b2c4" : null
      };
    case "join":
      return { kind: "join", session: s, code: "HA-7KQ2-MX9P-4TRA", workspaceName: worst ? worstSession.workspace!.name : "Northwind" };
    default:
      return { kind: "landing", session: null };
  }
}
