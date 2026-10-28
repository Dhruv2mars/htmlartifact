import { SECURITY_URL } from "../components/SiteHeader";
import type { Session } from "../page";
import { Fact, Facts, ReadingPage, Section } from "../components/ReadingPage";

// What the hosted service (htmlartifact.pages.dev) keeps. SECURITY.md's data
// handling sections are the source of truth; keep the two in step.
const PRIVACY_CONTACT = "Dhruv2mars@gmail.com";

const SECTIONS = [
  { id: "store", title: "What we store, and why" },
  { id: "processors", title: "Who processes it" },
  { id: "retention", title: "How long we keep it" },
  { id: "choices", title: "Your choices" }
];

export function Privacy({ session }: { session: Session | null }) {
  return (
    <ReadingPage
      session={session}
      current="privacy"
      title="Privacy"
      intro="What the hosted service at htmlartifact.pages.dev stores, why, for how long, and who processes it. If you run your own copy, you are responsible for that deployment's data."
      sections={SECTIONS}
    >
      <div className="mt-8 rounded-card border border-line bg-card px-5 py-4">
        <p className="mt-0 text-[13px] font-medium text-foreground">In short</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-muted">
          <li>Only members of your workspace can open what you publish.</li>
          <li>No analytics, ads or third-party trackers. Cookies are used only for signing in.</li>
          <li>What you delete is gone for good after 7 days. There are no other backups.</li>
        </ul>
      </div>

      <Section toc={SECTIONS} id="store">
        <p>Only what the service needs to publish artifacts and show them to the members of your workspace.</p>
        <Facts>
          <Fact title="Artifact HTML,">every version and every page, so members can open it.</Fact>
          <Fact title="Artifact details:">
            title, description, custom URL, repository name, git branch and commit subject, filename and sizes, to list and find
            artifacts.
          </Fact>
          <Fact title="Upload request details:">
            the IP address and user agent of each upload, kept as a record of where it came from. These are erased after 30 days.
          </Fact>
          <Fact title="Workspaces:">name, handle, and invite codes (which expire and have a use limit).</Fact>
          <Fact title="Your name and email,">
            cached from your account to show who published what, plus a 5-minute cache of your workspace memberships to check who
            can open an artifact.
          </Fact>
          <Fact title="Your account:">
            sign-in details, sessions, organizations and memberships are held by WorkOS. htmlartifact never sees your password or
            your identity provider's credentials.
          </Fact>
        </Facts>
        <p>
          There are no analytics, ads or third-party trackers. Cookies are used only for signing in. Server logs hold request paths
          and errors, never artifact HTML or credentials.
        </p>
      </Section>

      <Section toc={SECTIONS} id="processors">
        <Facts>
          <Fact title="Cloudflare">
            runs the service and stores everything above except your account: Workers, Pages, and the D1 database, encrypted at
            rest.
          </Fact>
          <Fact title="WorkOS">handles accounts, sign-in, sessions, workspaces (organizations) and memberships.</Fact>
        </Facts>
        <p>We don't sell your data or share it with anyone else.</p>
      </Section>

      <Section toc={SECTIONS} id="retention">
        <ul className="list-disc space-y-2 pl-5 marker:text-muted">
          <li>Upload IP addresses and user agents are erased after 30 days.</li>
          <li>
            Deleting an artifact makes it unreadable at once and deletes every version of its HTML in the same request. A step that
            fails is retried automatically, usually within 15 minutes.
          </li>
          <li>Deleting a workspace deletes all of its artifacts, invites and records, and the workspace itself at WorkOS.</li>
          <li>
            When someone leaves a workspace, their access ends on their next request; artifacts they published stay with the
            workspace until an admin deletes them. When an account is deleted, its cached name and email are scrubbed.
          </li>
          <li>Deleted data stays in the database's point-in-time history for 7 days, then is gone. There are no other backups.</li>
        </ul>
      </Section>

      <Section toc={SECTIONS} id="choices">
        <p>
          To ask for a copy of your data, a correction, or deletion, email{" "}
          <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. You can delete your own artifacts any time with{" "}
          <code>htmlartifact delete</code>, and a workspace admin can delete the workspace with{" "}
          <code>htmlartifact workspace delete</code>.
        </p>
        <p>
          <a href={SECURITY_URL}>SECURITY.md</a> has the full detail: where each item is stored, how deletion
          works, and how we respond to incidents.
        </p>
      </Section>
    </ReadingPage>
  );
}
