import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "./types.ts";

// Fixed-window limiter, per Worker isolate. Coarse on purpose: it stops a
// runaway agent loop. Use Cloudflare rate-limiting rules for real abuse.
const buckets = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  key: (c: Context<AppEnv>) => string | null | undefined;
}

export function rateLimit({ windowMs, max, keyPrefix, key }: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async function limiter(c, next) {
    const now = Date.now();
    const bucketKey = `${keyPrefix}:${key(c) || "anonymous"}`;
    const current = buckets.get(bucketKey);
    if (!current || current.resetAt <= now) {
      if (buckets.size > 50_000) buckets.clear();
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      c.header("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return c.json({ ok: false, error: "Rate limit exceeded. Slow down." }, 429);
    }
    return next();
  };
}

export const clientIp = <E extends AppEnv>(c: Context<E>): string => c.req.header("cf-connecting-ip") || "local";
