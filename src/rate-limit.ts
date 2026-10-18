import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.ts";

// Rate limits, two layers:
//   1. env.OPS (production): the ops Worker's Workers rate-limit binding
//      (src/ops.ts), counted across every isolate; limits per kind are set in
//      deploy/ops/wrangler.toml. Skipped when the binding is absent (local dev,
//      tests) or the call fails.
//   2. Always: a fixed window per Worker isolate with this call site's `max`.
// Coarse on purpose: it stops a runaway agent loop. Use Cloudflare
// rate-limiting rules for real abuse.
const buckets = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  // Which ops limiter counts this call site: "auth" (sign-in, joins) or "upload" (everything else).
  kind: "upload" | "auth";
  key: (c: Context<AppEnv>) => string | null | undefined;
}

export function rateLimit({ windowMs, max, keyPrefix, kind, key }: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async function limiter(c, next) {
    const bucketKey = `${keyPrefix}:${key(c) || "anonymous"}`;
    const ops = c.env.OPS;
    if (ops) {
      const allowed = await ops.limit(kind, bucketKey).catch((error: unknown) => {
        console.error("ops rate limiter failed:", error instanceof Error ? error.message : error);
        return null;
      });
      if (allowed === false) {
        // The ops limiters count per 60-second period.
        c.header("Retry-After", "60");
        return tooMany(c);
      }
    }
    const now = Date.now();
    const current = buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      if (buckets.size > 50_000) buckets.clear();
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      c.header("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return tooMany(c);
    }
    return next();
  };
}

function tooMany(c: Context<AppEnv>): Response {
  return c.json({ ok: false, error: "Rate limit exceeded. Slow down." }, 429);
}

export const clientIp = <E extends AppEnv>(c: Context<E>): string => c.req.header("cf-connecting-ip") || "local";
