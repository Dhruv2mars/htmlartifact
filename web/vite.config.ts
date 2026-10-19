import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [tailwindcss(), reactRouter()],
  // The server build is bundled again into the Worker (wrangler / Bun), so
  // it stays ESM with dependencies left as imports for that bundler.
  ...(isSsrBuild ? { ssr: { target: "webworker" as const } } : {})
}));
