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

export interface WorkspaceChoice {
  id: string;
  name: string;
  current: boolean;
}

export type Page =
  | { kind: "landing"; session: Session | null }
  | { kind: "docs"; session: Session | null }
  | { kind: "sign-in"; next: string }
  | { kind: "message"; title: string; message: string; retry: boolean; session: Session | null }
  | { kind: "not-found"; session: Session | null }
  | { kind: "feed"; session: Session; artifacts: ArtifactSummary[] }
  | { kind: "mine"; session: Session; artifacts: ArtifactSummary[] }
  | { kind: "artifact"; session: Session; artifact: { id: string; title: string; description: string | null; url: string }; versions: ArtifactVersion[] }
  | { kind: "workspaces"; session: Session; workspaces: WorkspaceChoice[]; next: string | null }
  | { kind: "join"; session: Session; code: string; workspaceName: string };
