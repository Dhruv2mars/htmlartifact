import type { ArtifactSummary, ArtifactVersion, Confirmation, InviteLink, Notice, Page, Person, Session } from "./page";

// Dev-only pages for `react-router dev` (the real Worker supplies these).
// Pick one with ?page=<kind>; add &fixture=worst for break-ui data, or
// &fixture=empty for empty states. artifact takes &teammate; join takes
// &member=current|other; workspaces takes &next[=/path] (a followed link)
// and &error (a refused invite code); message takes &retry=none|signin.
// feed and mine take &full (a nearly full workspace). Any signed-in page
// takes &role=member (default admin) and
// &notice=done|problem|fresh|lost; confirm takes &change=make-admin|
// make-member|remove|leave|delete|blocked.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const session: Session = {
  name: "Priya Raman",
  email: "priya@northwind.dev",
  workspace: { id: "org_01NWND", name: "Northwind", handle: "northwind" },
  role: "admin",
  notice: null
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
  workspace: { id: "org_WORST", name: "株式会社 Globex International Holdings Research & Development Division (EMEA)", handle: "globex" },
  role: "admin",
  notice: null
};
const worstArtifacts: ArtifactSummary[] = [
  { id: "aaaaaaaaaaaa", title: LONG, description: "x".repeat(400), author: worstSession.name, url: `https://htmlartifact.pages.dev/w/globex/${"very-long-slug-".repeat(8)}`, repo: "an-organisation-with-a-long-name/a-repository-with-an-even-longer-name", version: 9999, versionCount: 9999, updatedAt: ago(60 * 24 * 900) },
  { id: "b", title: "A", description: null, author: null, url: "https://htmlartifact.pages.dev/d/b", repo: null, version: null, versionCount: 0, updatedAt: null },
  { id: "zzzzzzzzzzzz", title: "🚀🔥 Plan: émigré façade naïve 日本語のタイトル とても長いタイトルです العربية", description: "Ünïcödé everywhere ✨", author: "李小龍", url: "https://htmlartifact.pages.dev/d/zzzzzzzzzzzz", repo: "x/y", version: 1, versionCount: 1, updatedAt: ago(1) },
  ...Array.from({ length: 40 }, (_, i) => ({ ...artifacts[i % artifacts.length]!, id: `gen${String(i).padStart(9, "0")}`, title: `${artifacts[i % artifacts.length]!.title} #${i + 1}` }))
];

// Workspace names are capped at 100 characters (POST /workspaces); this is 100.
const LONG_WORKSPACE = "Northwind Platform Engineering, Infrastructure, Developer Experience and Internal Tools Group (EMEA)";

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
  const role = url.searchParams.get("role") === "member" ? "member" : "admin";
  const full = url.searchParams.has("full");
  const s: Session = { ...(worst ? worstSession : session), role, notice: fixtureNotice(url.searchParams.get("notice"), worst) };
  const list = empty ? [] : worst ? worstArtifacts : artifacts;
  switch (kind) {
    case "docs":
      return { kind: "docs", session: null };
    case "privacy":
      return { kind: "privacy", session: null };
    case "sign-in":
      // ?next=/join/<code> for the invite variant, ?next=/mine for the plain one.
      return { kind: "sign-in", next: url.searchParams.get("next") ?? "/d/k3j9x0a1b2c4" };
    case "message": {
      // Default: what a dead /join/<code> link shows (src/web.ts).
      const retry = url.searchParams.get("retry");
      if (retry === "none") return { kind: "message", title: "Invite not valid", message: "That invite is invalid, expired, or used up.", retry: null, session: null };
      if (retry === "signin") return { kind: "message", title: "Sign-in problem", message: "Sign-in was cancelled or denied.", retry: "/auth/sign-in?next=%2F", session: null };
      return {
        kind: "message",
        title: "Invite not valid",
        message: "That invite link is invalid, expired, or used up. Ask whoever sent it for a new one.",
        retry: "/workspaces",
        retryLabel: "Enter another code",
        session: null
      };
    }
    case "not-found":
      return { kind: "not-found", session: null };
    case "feed":
      return { kind: "feed", session: s, artifacts: list, older: worst ? "/?cursor=1.k3j9x0a1b2c4" : null, usage: full ? { storedBytes: 45_100_000, limitBytes: 52_428_800 } : null };
    case "mine":
      return { kind: "mine", session: s, artifacts: list.filter((a, i) => worst || i % 2 === 0), older: null, usage: full ? { storedBytes: 51_000_000, limitBytes: 52_428_800 } : null };
    case "artifact":
      return {
        kind: "artifact",
        session: s,
        artifact: worst
          ? { id: "aaaaaaaaaaaa", title: LONG, description: "y".repeat(300), url: worstArtifacts[0]!.url, author: worstSession.name, repo: worstArtifacts[0]!.repo, mine: false }
          : { id: "k3j9x0a1b2c4", title: "Billing migration plan", description: "Six weeks from legacy invoices to the new ledger, with dual writes.", url: "https://htmlartifact.pages.dev/d/k3j9x0a1b2c4", author: "Marcus Lee", repo: "northwind/billing", mine: !url.searchParams.has("teammate") },
        versions: versions(worst ? 60 : 3, worst)
      };
    case "workspaces": {
      const next = url.searchParams.get("next");
      return {
        kind: "workspaces",
        session: empty ? { ...s, workspace: null } : s,
        workspaces: empty
          ? []
          : worst
            ? [
                { id: "org_WORST", name: worstSession.workspace!.name, current: true },
                { id: "org_LONG", name: LONG_WORKSPACE, current: false },
                { id: "org_UNBROKEN", name: "W".repeat(100), current: false },
                ...Array.from({ length: 12 }, (_, i) => ({ id: `org_${i}`, name: `Workspace ${i} ${"long ".repeat(i)}`, current: false }))
              ]
            : [
                { id: "org_01NWND", name: "Northwind", current: true },
                { id: "org_01SIDE", name: "Side project", current: false }
              ],
        next: next === null ? null : next.startsWith("/") ? next : "/d/k3j9x0a1b2c4",
        join: url.searchParams.has("error")
          ? { code: worst ? `https://htmlartifact.pages.dev/join/${"HA-7KQ2-MX9P-4TRZ".repeat(4)}` : "HA-7KQ2-MX9P-4TRZ", error: "That invite code is invalid, expired, or used up. Check it for typos, or ask whoever sent it for a new one." }
          : null
      };
    }
    case "join":
      return {
        kind: "join",
        session: s,
        code: "HA-7KQ2-MX9P-4TRA",
        workspace: { id: "org_01NWND", name: worst ? LONG_WORKSPACE : "Northwind" },
        expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        usesLeft: worst ? 1 : 49,
        member: url.searchParams.get("member") === "current" ? "current" : url.searchParams.get("member") === "other" ? "other" : null
      };
    case "people":
      return {
        kind: "people",
        session: s,
        people: (worst ? worstPeople : people).map((p) => ({ ...p, role: p.you ? role : p.role })),
        invites: role === "admin" ? (empty ? [] : worst ? worstInvites : invites) : null,
        invite: { days: [1, 7, 30], defaultDays: 7, defaultUses: 10, maxUses: 50 }
      };
    case "settings":
      return {
        kind: "settings",
        session: s,
        usage: { storedBytes: empty ? 0 : worst ? 49_100_000 : 12_582_912, limitBytes: 52_428_800 },
        admins: ["Priya Raman", "Marcus Lee"]
      };
    case "confirm": {
      const change = url.searchParams.get("change") ?? "remove";
      return { kind: "confirm", session: s, section: change === "leave" || change === "delete" ? "settings" : "people", confirm: confirmations(change, worst) };
    }
    default:
      return { kind: "landing", session: null };
  }
}

function fixtureNotice(kind: string | null, worst: boolean): Notice | null {
  switch (kind) {
    case "done":
      return { tone: "done", text: worst ? `${worstSession.name} is now an admin of ${worstSession.workspace!.name}.` : "Wen Zhao is now an admin of Northwind." };
    case "problem":
      return { tone: "problem", text: "That is the workspace's last admin. Make someone else an admin first." };
    case "fresh":
      return { tone: "done", text: "New invite link ready. Copy it and send it to your team.", fresh: "HA-7KQ2-MX9P-4TRA" };
    case "lost":
      return { tone: "problem", text: "You no longer have access to Lumen Labs, so you're now in Northwind." };
    default:
      return null;
  }
}

const people: Person[] = [
  { id: "user_priya", name: "Priya Raman", email: "priya@northwind.dev", role: "admin", joinedAt: ago(60 * 24 * 40), you: true },
  { id: "user_marcus", name: "Marcus Lee", email: "marcus@northwind.dev", role: "admin", joinedAt: ago(60 * 24 * 38), you: false },
  { id: "user_diego", name: "Diego Alvarez", email: "diego@northwind.dev", role: "member", joinedAt: ago(60 * 24 * 9), you: false },
  { id: "user_wen", name: "Wen Zhao", email: "wen.zhao@northwind.dev", role: "member", joinedAt: ago(60 * 5), you: false }
];

const worstPeople: Person[] = [
  { id: "user_worst", name: worstSession.name, email: worstSession.email!, role: "admin", joinedAt: ago(60 * 24 * 900), you: true },
  { id: "user_x", name: "X", email: "x@x.co", role: "member", joinedAt: null, you: false },
  { id: "user_unbroken", name: "W".repeat(64), email: `${"w".repeat(60)}@example.com`, role: "member", joinedAt: ago(1), you: false },
  { id: "user_cjk", name: "李小龍 🚀 Ünïcödé", email: "li@example.cn", role: "admin", joinedAt: ago(60 * 3), you: false },
  ...Array.from({ length: 30 }, (_, i): Person => ({ id: `user_${i}`, name: `Teammate ${i + 1}`, email: `teammate${i + 1}@northwind.dev`, role: "member", joinedAt: ago(i * 700), you: false }))
];

const inFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const invites: InviteLink[] = [
  { code: "HA-7KQ2-MX9P-4TRA", url: "https://htmlartifact.pages.dev/join/HA-7KQ2-MX9P-4TRA", createdAt: ago(3), expiresAt: inFuture(7), uses: 0, maxUses: 50, createdBy: "Priya Raman" },
  { code: "HA-Q3W8-ZC5N-7KPD", url: "https://htmlartifact.pages.dev/join/HA-Q3W8-ZC5N-7KPD", createdAt: ago(60 * 24 * 2), expiresAt: inFuture(5), uses: 3, maxUses: 50, createdBy: "Marcus Lee" }
];
const worstInvites: InviteLink[] = Array.from({ length: 12 }, (_, i) => ({
  code: `HA-${String(i).padStart(4, "0")}-MX9P-4TRA`,
  url: `https://htmlartifact.pages.dev/join/HA-${String(i).padStart(4, "0")}-MX9P-4TRA`,
  createdAt: ago(i * 300),
  expiresAt: inFuture(i % 3 ? 29 : 0.02),
  uses: i * 4,
  maxUses: 50,
  createdBy: i % 2 ? worstSession.name : null
}));

function confirmations(change: string, worst: boolean): Confirmation {
  const name = worst ? worstSession.name : "Diego Alvarez";
  const workspace = worst ? worstSession.workspace!.name : "Northwind";
  const back = { href: "/people", label: "Back to People" };
  switch (change) {
    case "make-admin":
      return {
        title: `Make ${name} an admin?`,
        lead: `Admins run ${workspace}. ${name} will be able to:`,
        points: ["Invite people, and revoke invite links", "Make others admins or members, and remove people", "Update and delete anyone's artifacts", "Create CI keys, and delete the workspace"],
        action: "/people/user_diego/make-admin",
        fields: {},
        submit: "Make admin",
        tone: "plain",
        back
      };
    case "make-member":
      return {
        title: `Make ${name} a member?`,
        lead: `${name} stops being an admin of ${workspace} right away.`,
        points: [`${name} keeps reading and publishing, like every member.`, `2 invite links ${name} made stop working.`, `1 CI key ${name} made stops working, so CI using it can't publish.`],
        action: "/people/user_diego/make-member",
        fields: {},
        submit: "Make member",
        tone: "plain",
        back
      };
    case "leave":
      return {
        title: `Leave ${workspace}?`,
        lead: `You lose access to everything in ${workspace} right away.`,
        points: [`Your 4 artifacts stay in ${workspace} for the team. You won't be able to update or delete them.`, "To come back, you need a new invite link from an admin."],
        action: "/settings/leave",
        fields: {},
        submit: `Leave ${workspace}`,
        tone: "danger",
        back: { href: "/settings", label: "Back to Settings" }
      };
    case "delete":
      return {
        title: `Delete ${workspace}?`,
        lead: `This deletes ${workspace} and everything in it, for everyone. It can't be undone.`,
        points: ["37 artifacts, with every version, are erased. Their links stop opening.", "3 other people lose access.", "Every invite link and CI key stops working."],
        action: "/settings/delete",
        fields: {},
        submit: "Delete workspace",
        tone: "danger",
        type: workspace,
        back: { href: "/settings", label: "Back to Settings" }
      };
    case "blocked":
      return {
        title: `Leave ${workspace}?`,
        lead: `You lose access to everything in ${workspace} right away.`,
        points: ["To come back, you need a new invite link from an admin."],
        action: "/settings/leave",
        fields: {},
        submit: `Leave ${workspace}`,
        tone: "danger",
        back: { href: "/settings", label: "Back to Settings" },
        blocked: `You're the only admin of ${workspace}. Make someone else an admin on People first, or delete the workspace.`
      };
    default:
      return {
        title: `Remove ${name} from ${workspace}?`,
        lead: `${name} loses access to ${workspace} right away, on the web and in the CLI.`,
        points: [`Both live invite links stop working, because ${name} might have one. You can make a new one right after.`, "The 6 artifacts they published stay. Admins can still update or delete them.", `To come back, ${name} needs a new invite link.`],
        action: "/people/user_diego/remove",
        fields: {},
        submit: `Remove ${name}`,
        tone: "danger",
        back
      };
  }
}
