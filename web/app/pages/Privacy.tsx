import type { ReactNode } from "react";
import { REPO_URL, SiteFooter, SiteHeader } from "../components/SiteHeader";
import type { Session } from "../page";

// What the hosted service (htmlartifact.pages.dev) keeps. SECURITY.md's data
// handling sections are the source of truth; keep the two in step.
const PRIVACY_CONTACT = "Dhruv2mars@gmail.com";

export function Privacy({ session }: { session: Session | null }) {
  return (
    <div>
      <SiteHeader session={session} />
      <main className="mx-auto max-w-[46rem] px-5 pb-28 pt-10 sm:px-8 lg:pt-16">
        <h1 className="font-wide text-title font-[740] tracking-[-0.03em] text-ink">Privacy</h1>
        <p className="mt-5 text-[18px] leading-relaxed text-ink-2">
          This page covers the hosted service at htmlartifact.pages.dev: what it stores, why, for how long, and who processes it. If
          you run your own copy, you are responsible for that deployment's data.
        </p>

        <Section title="What we store, and why">
          <p>Only what the service needs to publish artifacts and show them to the members of your workspace.</p>
          <ul className="list-disc pl-5">
            <li>
              <strong>Artifact HTML</strong>, every version and every page, so members can open it.
            </li>
            <li>
              <strong>Artifact details</strong>: title, description, custom URL, repository name, git branch and commit subject,
              filename and sizes, to list and find artifacts.
            </li>
            <li>
              <strong>Upload request details</strong>: the IP address and user agent of each upload, kept as a record of where it came
              from. These are erased after 30 days.
            </li>
            <li>
              <strong>Workspaces</strong>: name, handle, and invite codes (which expire and have a use limit).
            </li>
            <li>
              <strong>Your name and email</strong>, cached from your account to show who published what, plus a 5-minute cache of
              your workspace memberships to check who can open an artifact.
            </li>
            <li>
              <strong>Your account</strong>: sign-in details, sessions, organizations and memberships are held by WorkOS.
              htmlartifact never sees your password or your identity provider's credentials.
            </li>
          </ul>
          <p>
            There are no analytics, ads or third-party trackers. Cookies are used only for signing in. Server logs hold request
            paths and errors, never artifact HTML or credentials.
          </p>
        </Section>

        <Section title="Who processes it">
          <ul className="list-disc pl-5">
            <li>
              <strong>Cloudflare</strong> runs the service and stores everything above except your account (Workers, Pages, and the D1
              database, encrypted at rest).
            </li>
            <li>
              <strong>WorkOS</strong> handles accounts, sign-in, sessions, workspaces (organizations) and memberships.
            </li>
          </ul>
          <p>We don't sell your data or share it with anyone else.</p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc pl-5">
            <li>Upload IP addresses and user agents are erased after 30 days.</li>
            <li>
              Deleting an artifact makes it unreadable at once and deletes every version of its HTML in the same request (any failed
              step is retried automatically, usually within 15 minutes).
            </li>
            <li>
              Deleting a workspace deletes all of its artifacts, invites and records, and the workspace itself at WorkOS.
            </li>
            <li>
              When someone leaves a workspace, their access ends on their next request; artifacts they published stay with the
              workspace until an admin deletes them. When an account is deleted, its cached name and email are scrubbed.
            </li>
            <li>
              Deleted data stays in the database's point-in-time history for 7 days, then is gone. There are no other backups.
            </li>
          </ul>
        </Section>

        <Section title="Your choices">
          <p>
            To ask for a copy of your data, a correction, or deletion, email{" "}
            <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>. You can delete your own artifacts any time with{" "}
            <code>htmlartifact delete</code>, and a workspace admin can delete the workspace with{" "}
            <code>htmlartifact workspace delete</code>.
          </p>
          <p>
            <a href={`${REPO_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> has the full detail: where each item is stored, how deletion
            works, and how we respond to incidents.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="docs-prose mt-14">
      <h2 className="font-wide text-[24px] font-[700] tracking-[-0.02em] text-ink">{title}</h2>
      {children}
    </section>
  );
}
