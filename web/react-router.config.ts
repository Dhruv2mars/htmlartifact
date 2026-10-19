import type { Config } from "@react-router/dev/config";

// Server-rendered inside the htmlartifact Worker (src/frontend.ts). Hono owns
// routing; this app only renders the page Hono hands it.
export default {
  appDirectory: "app",
  buildDirectory: "build",
  ssr: true,
  // Two routes, both known up front: never ask the Worker for /__manifest.
  routeDiscovery: { mode: "initial" }
} satisfies Config;
