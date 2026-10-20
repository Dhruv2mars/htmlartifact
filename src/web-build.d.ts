// The React Router server build (bun run build:web). Typed at the call site.
declare module "*/web/build/server/index.js" {
  const build: Record<string, unknown>;
  export = build;
}

// Pages pre-rendered at build time (web/prerender.mjs).
declare module "*/web/build/server/static-pages.js" {
  export const ORIGIN_TOKEN: string;
  const pages: Record<"landing" | "docs" | "privacy" | "not-found", string>;
  export default pages;
}
