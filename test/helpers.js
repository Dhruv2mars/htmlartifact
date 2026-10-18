import { createEmulator } from "@workos/emulate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

// One real stack per test file: the official WorkOS emulator, a throwaway
// Postgres database, disk storage, and the htmlartifact app on a free port.
// TEST_DATABASE_URL must point at a Postgres server we may create databases on.

export const WEBHOOK_SECRET = "whsec_htmlartifact_test";
export const CI_KEY = "sk_test_acme_ci_key";
export const OTHER_CI_KEY = "sk_test_other_ci_key";
export const PASSWORD = "correct-horse-battery";

export const SEED = {
  users: [
    // First user: the emulator approves every device-flow login as them.
    { email: "alice@acme.test", first_name: "Alice", password: PASSWORD, email_verified: true },
    { email: "bob@acme.test", first_name: "Bob", password: PASSWORD, email_verified: true },
    { email: "olivia@other.test", first_name: "Olivia", password: PASSWORD, email_verified: true },
    { email: "max@both.test", first_name: "Max", password: PASSWORD, email_verified: true },
    { email: "nora@none.test", first_name: "Nora", password: PASSWORD, email_verified: true }
  ],
  organizations: [
    {
      name: "Acme",
      memberships: [{ email: "alice@acme.test" }, { email: "bob@acme.test" }, { email: "max@both.test" }]
    },
    { name: "Other", memberships: [{ email: "olivia@other.test" }, { email: "max@both.test" }] }
  ],
  apiKeys: [
    { name: "Acme CI", organization: "Acme", value: CI_KEY },
    { name: "Other CI", organization: "Other", value: OTHER_CI_KEY }
  ]
};

export async function startStack() {
  const adminUrl = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5432/postgres";
  const dbName = `htmlartifact_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;

  const emulator = await createEmulator({ port: 0, requestsPerMinute: 100_000, seed: SEED });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "htmlartifact-test-"));

  Object.assign(process.env, {
    DATABASE_URL: dbUrl.toString(),
    WORKOS_API_KEY: emulator.apiKey || "sk_test_default",
    WORKOS_CLIENT_ID: "client_htmlartifact_test",
    WORKOS_API_URL: emulator.url,
    WORKOS_WEBHOOK_SECRET: WEBHOOK_SECRET,
    HTMLARTIFACT_COOKIE_PASSWORD: "x".repeat(32) + "-test-cookie-password",
    HTMLARTIFACT_STORAGE_DIR: path.join(tmp, "storage"),
    HTMLARTIFACT_PUBLIC_BASE_URL: "http://127.0.0.1:0"
  });

  const { config } = await import("../src/config.js");
  const { initDb, pool } = await import("../src/db.js");
  const { createApp } = await import("../src/api.js");
  await initDb();

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  config.publicBaseUrl = baseUrl;

  // Webhooks from the emulator are delivered to the running app.
  await workosApi(emulator, "POST", "/webhook_endpoints", {
    endpoint_url: `${baseUrl}/webhooks/workos`,
    secret: WEBHOOK_SECRET,
    events: []
  });

  return {
    baseUrl,
    emulator,
    config,
    pool,
    tmp,
    async stop() {
      server.close();
      await pool.end();
      await emulator.close();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await cleanup.end();
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
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${text}`);
  return json;
}

export async function findOrganization(emulator, name) {
  const { data } = await workosApi(emulator, "GET", "/organizations?limit=100");
  return data.find((org) => org.name === name);
}

export async function findUser(emulator, email) {
  const { data } = await workosApi(emulator, "GET", `/user_management/users?email=${encodeURIComponent(email)}`);
  return data[0];
}

// A CLI-style access token for any seeded user, scoped to one organization.
export async function accessToken(stack, email, organizationName) {
  const response = await fetch(`${stack.emulator.url}/user_management/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      email,
      password: PASSWORD,
      client_id: process.env.WORKOS_CLIENT_ID,
      client_secret: process.env.WORKOS_API_KEY
    })
  });
  let body = await response.json();
  if (body.code === "organization_selection_required" || (organizationName && body.organization_id === undefined)) {
    const org = await findOrganization(stack.emulator, organizationName);
    const selected = await fetch(`${stack.emulator.url}/user_management/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:workos:oauth:grant-type:organization-selection",
        pending_authentication_token: body.pending_authentication_token,
        organization_id: org.id,
        client_id: process.env.WORKOS_CLIENT_ID,
        client_secret: process.env.WORKOS_API_KEY
      })
    });
    body = await selected.json();
  }
  if (!body.access_token) throw new Error(`no token for ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
}

// A minimal browser: a cookie jar and manual redirects, so a test can sign in
// through the real AuthKit redirect dance (app → emulator → app).
export class Browser {
  constructor(stack) {
    this.stack = stack;
    this.cookies = new Map();
  }

  async get(url, options = {}) {
    return this.request(url, { ...options, method: "GET" });
  }

  async post(url, form = {}, options = {}) {
    return this.request(url, {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString()
    });
  }

  // Follows redirects within the app and emulator. `rewrite` may edit any
  // hop's URL (e.g. to add login_hint at the emulator).
  async request(url, { method = "GET", headers = {}, body, follow = true, rewrite } = {}) {
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
      if (!follow || !location || response.status < 300 || response.status >= 400) break;
      target = new URL(location, target).toString();
      method = "GET";
      body = undefined;
      headers = {};
    }
    response.text_ = await response.text();
    return response;
  }

  async signIn(email, { next = "/workspace", organizationName } = {}) {
    const org = organizationName ? await findOrganization(this.stack.emulator, organizationName) : null;
    const query = new URLSearchParams({ next, ...(org ? { org: org.id } : {}) });
    return this.get(`/auth/sign-in?${query}`, {
      rewrite: (url) => {
        const u = new URL(url);
        if (u.origin === new URL(this.stack.emulator.url).origin && u.pathname.endsWith("/authorize")) {
          u.searchParams.set("login_hint", email);
        }
        return u.toString();
      }
    });
  }

  cookieHeader(url) {
    const host = new URL(url).host;
    const jar = this.cookies.get(host) || {};
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
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired || !value) delete jar[name];
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
