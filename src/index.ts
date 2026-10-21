import { Hono } from "hono";
import { isHttpError, registerApi } from "./api.ts";
import { getConfig } from "./config.ts";
import { ensureSchema } from "./db.ts";
import { renderNotFound } from "./render.ts";
import { isSandboxRequest, registerSandbox } from "./sandbox.ts";
import { registerServing } from "./serve.ts";
import { probeStorage, storageKind } from "./storage.ts";
import type { AppEnv, Env } from "./types.ts";
import { registerWeb } from "./web.ts";
import { registerWebhooks } from "./webhooks.ts";
import { registerAssets, renderPage } from "./frontend.ts";
import { FAVICON_SVG } from "./favicon.ts";

// htmlartifact on Cloudflare Workers. Bindings: DB (D1), optional ARTIFACTS (R2).
// One bundle, two origins, routed by request host: the app, and the sandbox
// origin that serves artifact HTML only (src/sandbox.ts).
function baseApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const config = getConfig(c.env);
    c.set("config", config);
    c.set("origin", config.publicBaseUrl || new URL(c.req.url).origin);
    // Closed for a database restore (SECURITY.md: Backups and restore): no
    // reads or writes until the restore is reconciled. /healthz still answers.
    if (c.env.HTMLARTIFACT_MAINTENANCE === "on" && c.req.path !== "/healthz") {
      c.header("Retry-After", "300");
      c.header("Cache-Control", "no-store");
      return c.req.path.startsWith("/api/")
        ? c.json({ ok: false, code: "maintenance", error: "htmlartifact is down for maintenance. Try again in a few minutes." }, 503)
        : c.text("htmlartifact is down for maintenance. Try again in a few minutes.\n", 503);
    }
    await ensureSchema(c.env.DB);
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  // Deep health: config loaded (middleware above), D1 reachable with the
  // schema in place, artifact storage (R2 or D1) reachable. 503 names the
  // failing store, nothing more.
  app.get("/healthz", async (c) => {
    const probe = (run: () => Promise<unknown>) => run().then(() => true, () => false);
    const checks = {
      d1: await probe(() => c.env.DB.prepare("SELECT 1 FROM drafts LIMIT 1").all()),
      storage: await probe(() => probeStorage(c.env))
    };
    const ok = checks.d1 && checks.storage;
    return c.json({ ok, checks, storage: storageKind(c.env) }, ok ? 200 : 503);
  });
  app.get("/favicon.svg", (c) => c.body(FAVICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" }));

  app.notFound((c) => c.html(renderNotFound(), 404));

  app.onError((error, c) => {
    const status = (isHttpError(error) && error.status) || 500;
    if (status >= 500) console.error(error);
    if (c.req.path.startsWith("/api/")) {
      return c.json({ ok: false, error: status >= 500 ? "Internal server error." : error.message }, status);
    }
    return c.text(status >= 500 ? "Internal server error.\n" : `${error.message}\n`, status);
  });

  return app;
}

const app = baseApp();
registerWebhooks(app);
registerApi(app);
registerServing(app);
registerWeb(app);
registerAssets(app);
// Unknown app paths get the web app's page; artifact and API misses keep
// the static one (serve.ts), which the sandbox origin shares.
app.notFound((c) =>
  c.req.path.startsWith("/api/") ? c.html(renderNotFound(), 404) : renderPage(c, { kind: "not-found", session: null }, 404)
);

// No session cookie, no web or API routes: capability URLs only.
const sandbox = baseApp();
registerSandbox(sandbox);

export default {
  fetch(request, env, ctx) {
    let sandboxOrigin: string | null = null;
    try {
      sandboxOrigin = getConfig(env).sandboxOrigin;
    } catch {
      // Misconfigured: the app's middleware reports it.
    }
    // The usercontent deployment never serves the app, on any of its hosts
    // (including Pages preview aliases the host check cannot know about).
    const sandboxOnly = env.HTMLARTIFACT_SERVE === "sandbox";
    const target = sandboxOnly || isSandboxRequest(new URL(request.url), sandboxOrigin) ? sandbox : app;
    return target.fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
