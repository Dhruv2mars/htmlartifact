import { Hono } from "hono";
import { isHttpError, registerApi } from "./api.ts";
import { getConfig } from "./config.ts";
import { ensureSchema } from "./db.ts";
import { renderNotFound } from "./render.ts";
import { isSandboxRequest, registerSandbox } from "./sandbox.ts";
import { registerServing } from "./serve.ts";
import type { AppEnv, Env } from "./types.ts";
import { registerWeb } from "./web.ts";
import { registerWebhooks } from "./webhooks.ts";
import { FAVICON_SVG } from "./favicon.ts";

// htmlartifact on Cloudflare Workers. Bindings: DB (D1), ARTIFACTS (R2).
// One bundle, two origins, routed by request host: the app, and the sandbox
// origin that serves artifact HTML only (src/sandbox.ts).
function baseApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const config = getConfig(c.env);
    c.set("config", config);
    c.set("origin", config.publicBaseUrl || new URL(c.req.url).origin);
    await ensureSchema(c.env.DB);
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
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
    const target = isSandboxRequest(new URL(request.url), sandboxOrigin) ? sandbox : app;
    return target.fetch(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;
