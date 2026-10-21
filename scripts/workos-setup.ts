// One-time production setup against the real WorkOS environment. Never prints secret values.
//   bun scripts/workos-setup.ts            -> production
//   bun scripts/workos-setup.ts --staging  -> staging (same WorkOS env, staging URLs, Pages preview env)
//   --dry-run                              -> print what it would do; calls nothing
// URLs and project names come from deploy/*/wrangler.toml (scripts/deployment.ts).
// Reads WORKOS_API_KEY / WORKOS_CLIENT_ID from ~/.config/htmlartifact/workos.env, then:
//   1. registers the AuthKit redirect URI   <app>/auth/callback
//   2. registers the webhook endpoint       <app>/webhooks/workos  (secret goes straight to Cloudflare)
//   3. stores WORKOS_API_KEY, WORKOS_CLIENT_ID (+ WORKOS_WEBHOOK_SECRET) as Cloudflare secrets on
//      both Pages projects and the ops Worker.
import { $ } from "bun";
import { homedir } from "node:os";
import { deployment } from "./deployment.ts";

const staging = process.argv.includes("--staging");
const { appUrl: app, appProject, sandboxProject, opsWorker } = await deployment(staging);
const root = new URL("..", import.meta.url).pathname;
const wrangler = `${root}node_modules/.bin/wrangler`;
const EVENTS = [
  "organization_membership.created",
  "organization_membership.updated",
  "organization_membership.deleted",
  "organization.deleted",
  "user.deleted",
  "session.revoked",
  "api_key.revoked"
  // (api_key.deleted is handled by the webhook code but is not an event type
  // WorkOS lets endpoints subscribe to.)
];

if (process.argv.includes("--dry-run")) {
  console.log(`redirect URI:     ${app}/auth/callback`);
  console.log(`webhook endpoint: ${app}/webhooks/workos (${EVENTS.join(", ")})`);
  console.log(`Pages secrets:    ${appProject}, ${sandboxProject}${staging ? " (preview)" : ""}`);
  console.log(`Worker secret:    ${opsWorker}`);
  process.exit(0);
}

const file = await Bun.file(`${homedir()}/.config/htmlartifact/workos.env`).text();
const env = Object.fromEntries(
  file
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const apiKey = env.WORKOS_API_KEY;
const clientId = env.WORKOS_CLIENT_ID;
if (!apiKey || !clientId) throw new Error("workos.env needs WORKOS_API_KEY and WORKOS_CLIENT_ID");
if (!apiKey.startsWith("sk_")) throw new Error("WORKOS_API_KEY should start with sk_");
console.log(`WorkOS key mode: ${apiKey.startsWith("sk_live_") ? "live" : "test"}`);

async function workos(method: string, path: string, body?: unknown) {
  const response = await fetch(`https://api.workos.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

type Listed<T> = { data: T[] };

// 1. Redirect URI
const redirectUri = `${app}/auth/callback`;
const uris = (await workos("GET", "/user_management/redirect_uris?limit=100")) as unknown as Listed<{ uri: string }>;
if (uris.data.some((entry) => entry.uri === redirectUri)) console.log(`redirect URI present: ${redirectUri}`);
else {
  await workos("POST", "/user_management/redirect_uris", { uri: redirectUri });
  console.log(`redirect URI added: ${redirectUri}`);
}

// 2. Webhook endpoint (recreated if it exists, because the secret is only returned on create)
const endpointUrl = `${app}/webhooks/workos`;
const endpoints = (await workos("GET", "/webhook_endpoints?limit=100")) as unknown as Listed<{ id: string; endpoint_url: string }>;
for (const existing of endpoints.data.filter((entry) => entry.endpoint_url === endpointUrl)) {
  await workos("DELETE", `/webhook_endpoints/${existing.id}`);
  console.log(`webhook endpoint replaced: ${existing.id}`);
}
const created = await workos("POST", "/webhook_endpoints", { endpoint_url: endpointUrl, events: EVENTS });
const webhookSecret = created.secret;
if (typeof webhookSecret !== "string" || !webhookSecret) throw new Error("WorkOS returned no webhook secret");
console.log(`webhook endpoint created: ${endpointUrl} (${EVENTS.length} events)`);

// 3. Cloudflare secrets (values go over stdin only)
async function pagesSecret(project: "app" | "usercontent", name: string, value: string) {
  const projectName = project === "app" ? appProject : sandboxProject;
  const envFlag = staging ? ["--env", "preview"] : [];
  await $`${wrangler} pages secret put ${name} --project-name ${projectName} ${envFlag} < ${new Response(value)}`
    .cwd(`${root}deploy/${project}`)
    .quiet();
  console.log(`secret ${name} -> ${projectName}${staging ? " (preview)" : ""}`);
}
async function opsSecret(name: string, value: string) {
  const envFlag = staging ? "--env=staging" : "--env=";
  await $`${wrangler} secret put ${name} ${envFlag} < ${new Response(value)}`.cwd(`${root}deploy/ops`).quiet();
  console.log(`secret ${name} -> ${opsWorker}`);
}

for (const project of ["app", "usercontent"] as const) {
  await pagesSecret(project, "WORKOS_API_KEY", apiKey);
  await pagesSecret(project, "WORKOS_CLIENT_ID", clientId);
}
await pagesSecret("app", "WORKOS_WEBHOOK_SECRET", webhookSecret);
await opsSecret("WORKOS_API_KEY", apiKey);
console.log(`done. Remaining dashboard step: Redirects -> Sign-out URIs -> add ${app} as the default.`);
