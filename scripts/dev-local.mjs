// Runs htmlartifact fully offline: the WorkOS emulator (with its interactive
// login page) plus the Worker in local workerd, wired together.
//   bun run dev:local            → http://localhost:8787
// Sign in as any seeded email below; the CLI works with
//   HTMLARTIFACT_API_URL=http://localhost:8787 htmlartifact login
import { createEmulator } from "@workos/emulate";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// The Worker serves web/build (assets and server-rendered pages); a clean
// checkout has none yet. Run `bun run build:web` yourself after web changes.
if (!existsSync(new URL("../web/build/client", import.meta.url))) {
  console.log("web/build/client is missing: building the web app first (bun run build:web)…");
  const build = spawnSync("bun", ["run", "build:web"], { stdio: "inherit", cwd: new URL("..", import.meta.url) });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const PORT = Number(process.env.PORT || 8787);
const emulator = await createEmulator({
  port: Number(process.env.WORKOS_EMULATOR_PORT || 4100),
  interactiveAuth: true,
  seed: {
    roles: [
      { slug: "admin", name: "Admin" },
      { slug: "member", name: "Member" }
    ],
    users: [
      { email: "alice@example.com", first_name: "Alice", email_verified: true },
      { email: "bob@example.com", first_name: "Bob", email_verified: true },
      { email: "carol@example.com", first_name: "Carol", email_verified: true }
    ]
  }
});

const vars = {
  WORKOS_API_URL: emulator.url,
  WORKOS_API_KEY: emulator.apiKey || "sk_test_default",
  WORKOS_CLIENT_ID: "client_htmlartifact_local",
  WORKOS_WEBHOOK_SECRET: "whsec_local",
  HTMLARTIFACT_COOKIE_PASSWORD: "local-development-cookie-password-0123456789"
};
const worker = spawn(
  "bunx",
  ["wrangler", "dev", "--port", String(PORT), "--persist-to", ".wrangler/local", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
  { stdio: "inherit" }
);

await fetch(`${emulator.url}/webhook_endpoints`, {
  method: "POST",
  headers: { Authorization: `Bearer ${vars.WORKOS_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ endpoint_url: `http://localhost:${PORT}/webhooks/workos`, secret: vars.WORKOS_WEBHOOK_SECRET, events: [] })
});
console.log(`\nWorkOS emulator: ${emulator.url}\nhtmlartifact:    http://localhost:${PORT}\n`);

const stop = async () => {
  worker.kill();
  await emulator.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
worker.on("exit", stop);
