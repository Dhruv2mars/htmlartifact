import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, LimitKind } from "./types.ts";

// Rate limits, two layers:
//   1. env.OPS (production): the ops Worker's Workers rate-limit binding
//      (src/ops.ts), counted across every isolate; limits per kind are set in
//      deploy/ops/wrangler.toml. Skipped when the binding is absent (local dev,
//      tests) or the call fails.
//   2. Always: a fixed window per Worker isolate with this call site's `max`.
// Coarse on purpose: it stops a runaway agent loop. Use Cloudflare
// rate-limiting rules for real abuse.
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface LimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  // Which ops limiter counts this call site (see LimitKind in types.ts).
  kind: LimitKind;
}

interface RateLimitOptions extends LimitOptions {
  key: (c: Context<AppEnv>) => string | null | undefined;
}

// One hit against `key`: { ok: true }, or { ok: false, retryAfter } in seconds.
export async function checkLimit<E extends AppEnv>(
  c: Context<E>,
  { windowMs, max, keyPrefix, kind }: LimitOptions,
  key: string | null | undefined
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const bucketKey = `${keyPrefix}:${key || "anonymous"}`;
  const ops = c.env.OPS;
  if (ops) {
    const allowed = await ops.limit(kind, bucketKey).catch((error: unknown) => {
      console.error("ops rate limiter failed:", error instanceof Error ? error.message : error);
      return null;
    });
    // The ops limiters count per 60-second period.
    if (allowed === false) return { ok: false, retryAfter: 60 };
  }
  const now = Date.now();
  const current = buckets.get(bucketKey);
  if (!current || current.resetAt <= now) {
    if (buckets.size > 50_000) buckets.clear();
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  current.count += 1;
  if (current.count > max) return { ok: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  return { ok: true };
}

export function rateLimit({ key, ...options }: RateLimitOptions): MiddlewareHandler<AppEnv> {
  return async function limiter(c, next) {
    const verdict = await checkLimit(c, options, key(c));
    if (!verdict.ok) return tooMany(c, verdict.retryAfter);
    return next();
  };
}

export function tooMany<E extends AppEnv>(c: Context<E>, retryAfter: number): Response {
  c.header("Retry-After", String(retryAfter));
  return c.json({ ok: false, error: "Rate limit exceeded. Slow down." }, 429);
}

// Thrown where a limit trips below the route handler (credential checks):
// app.onError answers with its status; Retry-After is set on the context.
export class RateLimitedError extends Error {
  readonly status = 429 as const;
  constructor() {
    super("Rate limit exceeded. Slow down.");
  }
}

export const clientIp = <E extends AppEnv>(c: Context<E>): string => c.req.header("cf-connecting-ip") || "local";
