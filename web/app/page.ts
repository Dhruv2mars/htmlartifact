// The contract between the Worker (src/frontend.ts) and the web app: Hono
// decides what to show and with which status; React renders it. Plain data
// only, safe to serialize into the page.

export interface Session {
  name: string;
  email: string | null;
  workspace: { id: string; name: string; handle: string } | null;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  description: string | null;
  author: string | null;
  url: string;
  repo: string | null;
  version: number | null;
  versionCount: number;
  updatedAt: string | null;
}

export interface ArtifactVersion {
  number: number;
  url: string;
  subject: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  size: number;
  createdAt: string | null;
}

// The artifact a version history page is about. `mine`: the viewer published it.
export interface ArtifactHead {
  id: string;
  title: string;
  description: string | null;
  url: string;
  author: string | null;
  // "org/name", from the published file's git remote.
  repo: string | null;
  mine: boolean;
}

// A join that failed: the code as they typed it, and what went wrong.
export interface JoinFailure {
  code: string;
  error: string;
}

export interface WorkspaceChoice {
  id: string;
  name: string;
  current: boolean;
}

export type Page =
  | { kind: "landing"; session: Session | null }
  | { kind: "docs"; session: Session | null }
  | { kind: "privacy"; session: Session | null }
  | { kind: "sign-in"; next: string }
  // retry: where the retry button goes (sign-in, keeping the destination, or
  // somewhere to try another way), or none. retryLabel names it; default "Try again".
  | { kind: "message"; title: string; message: string; retry: string | null; retryLabel?: string; session: Session | null }
  | { kind: "not-found"; session: Session | null }
  // older: the next page of the feed, when there is one.
  | { kind: "feed"; session: Session; artifacts: ArtifactSummary[]; older: string | null }
  | { kind: "mine"; session: Session; artifacts: ArtifactSummary[]; older: string | null }
  | { kind: "artifact"; session: Session; artifact: ArtifactHead; versions: ArtifactVersion[] }
  // next: where to go after joining or switching (a link they followed).
  // join: a join that failed, shown again with what they typed and why.
  | { kind: "workspaces"; session: Session; workspaces: WorkspaceChoice[]; next: string | null; join?: JoinFailure | null }
  | { kind: "join"; session: Session; code: string; workspace: { id: string; name: string }; expiresAt: string; usesLeft: number; member: "current" | "other" | null };
