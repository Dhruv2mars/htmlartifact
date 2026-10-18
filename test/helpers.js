import { createEmulator } from "@workos/emulate";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { unstable_dev } from "wrangler";

// One real stack per test file: the official WorkOS emulator plus the
// htmlartifact Worker running locally in workerd (wrangler), with fresh
// local D1 and R2 state.

export const WEBHOOK_SECRET = "whsec_htmlartifact_test";
export const CI_KEY = "sk_test_acme_ci_key";
export const OTHER_CI_KEY = "sk_test_other_ci_key";
export const PASSWORD = "correct-horse-battery";
export const CLIENT_ID = "client_htmlartifact_test";
export const COOKIE_PASSWORD = `${"x".repeat(32)}-test-cookie-password`;

export const SEED = {
  roles: [
    { slug: "admin", name: "Admin" },
    { slug: "member", name: "Member" }
  ],
  users: [
    // First user: the emulator approves every device-flow sign-in as them.
    { email: "alice@acme.test", first_name: "Alice", password: PASSWORD, email_verified: true },
    { email: "bob@acme.test", first_name: "Bob", password: PASSWORD, email_verified: true },
    { email: "olivia@other.test", first_name: "Olivia", password: PASSWORD, email_verified: true },
    { email: "max@both.test", first_name: "Max", password: PASSWORD, email_verified: true },
    { email: "nora@new.test", first_name: "Nora", password: PASSWORD, email_verified: true },
    { email: "sam@new.test", first_name: "Sam", password: PASSWORD, email_verified: true }
  ],
  organizations: [
    {
      name: "Acme",
      memberships: [
        { email: "alice@acme.test", role: "admin" },
        { email: "bob@acme.test" },
        { email: "max@both.test" }
      ]
    },
    { name: "Other", memberships: [{ email: "olivia@other.test" }, { email: "max@both.test" }] }
  ],
  // The emulator has no Admin Portal revocation endpoint; stand in for it.
  errorHooks: [{ method: "POST", path: "/portal/revoke_link", status: 200, body: {} }],
  apiKeys: [
    { name: "Acme CI", organization: "Acme", value: CI_KEY },
    { name: "Other CI", organization: "Other", value: OTHER_CI_KEY }
  ]
};

// A free local TCP port, so URLs can be configured before the Worker starts.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// With `sandbox`, the app is http://127.0.0.1:<port> and the sandbox origin
// is http://localhost:<port>: the same Worker, routed by request host.
export async function startStack({ sandbox = false, directoryProvisioning = false } = {}) {
  const emulator = await createEmulator({ port: 0, requestsPerMinute: 100_000, seed: SEED });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "htmlartifact-test-"));
  const port = sandbox ? await freePort() : undefined;
  const sandboxUrl = sandbox ? `http://localhost:${port}` : null;
  const worker = await unstable_dev(new URL("../src/index.ts", import.meta.url).pathname, {
    config: new URL("../wrangler.toml", import.meta.url).pathname,
    ip: "127.0.0.1",
    ...(port ? { port } : {}),
    persistTo: path.join(tmp, "state"),
    logLevel: "warn",
    vars: {
      WORKOS_API_URL: emulator.url,
      WORKOS_API_KEY: emulator.apiKey || "sk_test_default",
      WORKOS_CLIENT_ID: CLIENT_ID,
      WORKOS_WEBHOOK_SECRET: WEBHOOK_SECRET,
      HTMLARTIFACT_COOKIE_PASSWORD: COOKIE_PASSWORD,
      ...(directoryProvisioning ? { HTMLARTIFACT_DIRECTORY_PROVISIONING: "on" } : {}),
      ...(sandbox
        ? { HTMLARTIFACT_PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, HTMLARTIFACT_SANDBOX_ORIGIN: sandboxUrl }
        : {})
    },
    experimental: { disableExperimentalWarning: true }
  });
  const baseUrl = `http://127.0.0.1:${worker.port}`;

  // Webhooks from the emulator are delivered to the running Worker.
  await workosApi(emulator, "POST", "/webhook_endpoints", {
    endpoint_url: `${baseUrl}/webhooks/workos`,
    secret: WEBHOOK_SECRET,
    events: []
  });

  return {
    baseUrl,
    sandboxUrl,
    emulator,
    tmp,
    async stop() {
      await worker.stop();
      await emulator.close();
    }
  };
}

export async function workosApi(emulator, method, pathname, body) {
  const response = await fetch(`${emulator.url}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${emulator.apiKey || "sk_test_default"}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// Makes the emulator fail one WorkOS endpoint until the returned remover runs.
export async function breakWorkos(emulator, method, pathname, status = 503) {
  const response = await fetch(`${emulator.url}/_emulate/hooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path: pathname, status })
  });
  const hook = await response.json();
  return () => fetch(`${emulator.url}/_emulate/hooks/${hook.id}`, { method: "DELETE" });
}

export async function findOrganization(emulator, name) {
  const { data } = await workosApi(emulator, "GET", "/organizations?limit=100");
  return data.find((org) => org.name === name);
}

export async function findUser(emulator, email) {
  const { data } = await workosApi(emulator, "GET", `/user_management/users?email=${encodeURIComponent(email)}`);
  return data[0];
}

// CLI-style tokens for a seeded user: { accessToken, refreshToken }, scoped to
// `workspace` when given (or when the user is in several).
export async function signInTokens(stack, email, workspace, { clientId = CLIENT_ID } = {}) {
  const authenticate = (body) =>
    fetch(`${stack.emulator.url}/user_management/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, client_id: clientId, client_secret: process.env.WORKOS_API_KEY || "sk_test_default" })
    }).then((r) => r.json());

  let body = await authenticate({ grant_type: "password", email, password: PASSWORD });
  if (body.code === "organization_selection_required") {
    const org = await findOrganization(stack.emulator, workspace);
    body = await authenticate({
      grant_type: "urn:workos:oauth:grant-type:organization-selection",
      pending_authentication_token: body.pending_authentication_token,
      organization_id: org.id
    });
  }
  if (!body.access_token) throw new Error(`no token for ${email}: ${JSON.stringify(body)}`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function accessToken(stack, email, workspace, options) {
  return (await signInTokens(stack, email, workspace, options)).accessToken;
}

// What the CLI does after `workspace create` / `join`: refresh into it.
export async function refreshInto(stack, tokens, organizationId) {
  const response = await fetch(`${stack.baseUrl}/api/cli/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refreshToken, organization_id: organizationId })
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`refresh failed: ${JSON.stringify(body)}`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function callApi(stack, token, method, pathname, body) {
  const response = await fetch(`${stack.baseUrl}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return { status: response.status, body: json };
}

// Delivers a correctly signed WorkOS webhook, as WorkOS would, including its
// retries of 5xx answers (locally the app, the ops Worker and the test proxy
// share one SQLite file and occasionally collide on a lock).
export async function sendWebhook(stack, payload) {
  const body = JSON.stringify(payload);
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    const t = Date.now();
    const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
    response = await fetch(`${stack.baseUrl}/webhooks/workos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "WorkOS-Signature": `t=${t}, v1=${v1}` },
      body
    });
    if (response.status < 500) return response;
  }
  return response;
}

// A minimal browser: a cookie jar and manual redirects, so a test can sign in
// through the real AuthKit redirect dance (app → emulator → app).
export class Browser {
  constructor(stack) {
    this.stack = stack;
    this.cookies = new Map();
  }

  get(url, options = {}) {
    return this.request(url, { ...options, method: "GET" });
  }

  post(url, form = {}, options = {}) {
    return this.request(url, {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: this.stack.baseUrl, ...options.headers },
      body: new URLSearchParams(form).toString()
    });
  }

  async request(url, { method = "GET", headers = {}, body, rewrite } = {}) {
    let target = new URL(url, this.stack.baseUrl).toString();
    let response;
    for (let hop = 0; hop < 10; hop += 1) {
      if (rewrite) target = rewrite(target);
      response = await fetch(target, {
        method,
        redirect: "manual",
        headers: { Accept: "text/html", ...headers, Cookie: this.cookieHeader(target) },
        body
      });
      this.store(target, response);
      const location = response.headers.get("location");
      if (!location || response.status < 300 || response.status >= 400) break;
      target = new URL(location, target).toString();
      method = "GET";
      body = undefined;
      headers = {};
    }
    response.finalUrl = target;
    response.text_ = await response.text();
    return response;
  }

  async signIn(email, { next = "/", workspace } = {}) {
    const org = workspace ? await findOrganization(this.stack.emulator, workspace) : null;
    const query = new URLSearchParams({ next, ...(org ? { org: org.id } : {}) });
    const emulatorOrigin = new URL(this.stack.emulator.url).origin;
    return this.get(`/auth/sign-in?${query}`, {
      rewrite: (url) => {
        const u = new URL(url);
        if (u.origin === emulatorOrigin && u.pathname.endsWith("/authorize")) u.searchParams.set("login_hint", email);
        return u.toString();
      }
    });
  }

  cookieHeader(url) {
    const jar = this.cookies.get(new URL(url).host) || {};
    return Object.entries(jar)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  store(url, response) {
    const host = new URL(url).host;
    const jar = this.cookies.get(host) || {};
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) delete jar[name];
      else jar[name] = value;
    }
    this.cookies.set(host, jar);
  }
}

export function writeHtml(dir, name, html) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, html);
  return file;
}

export const page = (title, body = "<p>hello</p>") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
