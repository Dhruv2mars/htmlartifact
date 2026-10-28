import type { Context } from "hono";
import type { AppEnv } from "./types.ts";

// Daily budgets that keep D1 inside its free rows-written allowance (100,000 a
// day, account-wide; past it D1 refuses every write, for every workspace,
// until 00:00 UTC). Three scopes, each with a deployment-wide and a
// per-workspace share (README: Storage and the free-tier budget):
//   upload  publishing
//   engage  social writes (comments, read markers, events, pins): none yet
//   ops     invites, CI keys, role changes, joins, new workspaces
// Sign-ins, webhooks, removals, deletions and the cron are never refused; they
// write in what the three leave. A busy day in one scope never stops another.
//
// Counted as D1 measures it: an action reserves an estimate (refused if that
// doesn't fit; one conditional upsert, so concurrent requests cannot
// overdraw), runs with its D1 binding metered, then settles the reservation to
// the rows it actually wrote (meta.rows_written: rows and index entries, the
// budget's own included). One row per UTC day and scope key.

export const DAILY_BUDGET_SCHEMA = `CREATE TABLE IF NOT EXISTS daily_budget (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (day, scope)
)`;

export type BudgetScope = "upload" | "engage" | "ops";

export interface ScopeBudget {
  perDay: number;
  perWorkspaceDay: number;
}

// Scope keys: the deployment's ("d1:rows" is the one uploads used before
// scopes, so today's count carries over), and a workspace's ("<key>:<org>").
const SCOPE_KEYS: Record<BudgetScope, string> = { upload: "d1:rows", engage: "d1:engage", ops: "d1:ops" };
// The deployment-wide keys outlive the day (pruneBudgets): the creation cap
// (src/capacity.ts) reads a week of the upload pool.
const UPLOAD_POOL_KEY = SCOPE_KEYS.upload;

// What settling writes per key, once the day's row exists: the row, no index
// entry (`used` is not indexed). test/capacity.test.js checks it against D1.
const SETTLE_ROWS_PER_KEY = 1;

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Seconds until the daily budgets reset (00:00 UTC). */
export const secondsUntilUtcMidnight = (now = Date.now()): number =>
  Math.max(1, Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));

interface Meter {
  db: D1Database;
  scope: BudgetScope;
  keys: string[];
  day: string;
  // Rows the metered binding saw written so far, the reservations included.
  written: number;
  reserved: number;
}

const meters = new WeakMap<Context, Meter>();

/**
 * Runs `next` with `c.env.DB` metered, then settles today's `scope` budget to
 * the rows written (the workspace's share and the deployment's). Nothing is
 * refused here: `spendRows` reserves, where the action knows its size. Only
 * writes through `c.env` are seen: run nothing in `next` that kept the
 * binding from before.
 */
export async function metered<E extends AppEnv>(
  c: Context<E>,
  scope: BudgetScope,
  next: () => Promise<void>,
  // The workspace charged: the caller's current one unless given.
  organizationId: string | null = c.get("viewer")?.organization_id ?? null
): Promise<void> {
  const db = c.env.DB;
  const base = SCOPE_KEYS[scope];
  const meter: Meter = { db, scope, keys: organizationId ? [`${base}:${organizationId}`, base] : [base], day: utcDay(), written: 0, reserved: 0 };
  meters.set(c as unknown as Context, meter);
  const env = c.env;
  c.env = { ...env, DB: meterDatabase(db, (rows) => (meter.written += rows)) };
  try {
    await next();
  } finally {
    c.env = env;
    meters.delete(c as unknown as Context);
    // Rows written with nothing reserved (a refusal, an early answer) count too.
    if (meter.written || meter.reserved) {
      const delta = meter.written + SETTLE_ROWS_PER_KEY * meter.keys.length - meter.reserved;
      const settle = db.prepare(
        `INSERT INTO daily_budget (day, scope, used) VALUES (?1, ?2, MAX(0, ?3))
         ON CONFLICT (day, scope) DO UPDATE SET used = MAX(0, used + ?3)`
      );
      await db
        .batch(meter.keys.map((key) => settle.bind(meter.day, key, delta)))
        .catch((error: unknown) => console.error("budget settle failed:", error instanceof Error ? error.message : error));
    }
  }
}

/**
 * Reserves `rows` of the metered scope's budgets for what comes next (the
 * workspace's share first). Returns why they don't fit, with nothing kept
 * reserved, or null.
 */
export async function spendRows<E extends AppEnv>(c: Context<E>, rows: number, budget: ScopeBudget, what: string): Promise<string | null> {
  const meter = meters.get(c as unknown as Context);
  if (!meter) throw new Error("spendRows outside metered()");
  const limits = meter.keys.map((key) => ({ key, limit: key === SCOPE_KEYS[meter.scope] ? budget.perDay : budget.perWorkspaceDay }));
  // Every share at once, or none: a refusal writes nothing, so requests
  // refused all day cost no rows.
  const result = await reserveStatement(meter.db, meter.day, rows, limits).run();
  meter.written += result.meta.rows_written ?? 0;
  if (result.meta.changes) {
    meter.reserved += rows;
    return null;
  }
  const { results } = await meter.db
    .prepare(`SELECT scope, used FROM daily_budget WHERE day = ? AND scope IN (${limits.map(() => "?").join(", ")})`)
    .bind(meter.day, ...meter.keys)
    .all<{ scope: string; used: number }>();
  const used = new Map(results.map((row) => [row.scope, row.used]));
  const over = limits.find(({ key, limit }) => (used.get(key) ?? 0) + rows > limit) ?? limits.at(-1)!;
  return over.key === SCOPE_KEYS[meter.scope]
    ? `This htmlartifact deployment has reached today's ${what} limit.`
    : `This workspace has reached today's ${what} limit.`;
}

// Takes `count` of each key's budget for `day` if every one stays within its limit.
function reserveStatement(db: D1Database, day: string, count: number, limits: { key: string; limit: number }[]): D1PreparedStatement {
  const scopes = limits.map((_, i) => `SELECT ?${3 + 2 * i} AS scope`).join(" UNION ALL ");
  const fits = limits
    .map((_, i) => `COALESCE((SELECT used FROM daily_budget WHERE day = ?1 AND scope = ?${3 + 2 * i}), 0) + ?2 <= ?${4 + 2 * i}`)
    .join(" AND ");
  return db
    .prepare(
      `INSERT INTO daily_budget (day, scope, used) SELECT ?1, k.scope, ?2 FROM (${scopes}) AS k WHERE ${fits}
       ON CONFLICT (day, scope) DO UPDATE SET used = used + excluded.used`
    )
    .bind(day, count, ...limits.flatMap(({ key, limit }) => [key, limit]));
}

/** Today's use of the upload pool, and of the days before, newest first. */
export async function uploadPoolDays(db: D1Database, days: number): Promise<{ day: string; used: number }[]> {
  const { results } = await db
    .prepare("SELECT day, used FROM daily_budget WHERE scope = ? AND day >= ? ORDER BY day DESC")
    .bind(UPLOAD_POOL_KEY, utcDay(Date.now() - (days - 1) * 86_400_000))
    .all<{ day: string; used: number }>();
  return results;
}

/**
 * Drops budgets older than yesterday (the ops cron); the deployment's upload
 * pool keeps a week, for the creation cap.
 */
export async function pruneBudgets(db: D1Database, now = Date.now()): Promise<number> {
  await db.prepare(DAILY_BUDGET_SCHEMA).run();
  const result = await db
    .prepare("DELETE FROM daily_budget WHERE day < ? AND (scope <> ? OR day < ?)")
    .bind(utcDay(now - 86_400_000), UPLOAD_POOL_KEY, utcDay(now - 7 * 86_400_000))
    .run();
  return result.meta.changes ?? 0;
}

// A D1 binding that reports every write's meta.rows_written to `count`.
// first() runs as all() (D1's first() returns no meta), so writes with
// RETURNING are counted too. Statements keep working in batch().
function meterDatabase(db: D1Database, count: (rows: number) => void): D1Database {
  const real = new WeakMap<object, D1PreparedStatement>();
  const add = <T extends D1Result>(result: T): T => {
    count(result.meta?.rows_written ?? 0);
    return result;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      run: async () => add(await statement.run()),
      all: async () => add(await statement.all()),
      first: async (column?: string) => {
        const row = add(await statement.all<Record<string, unknown>>()).results[0] ?? null;
        return column === undefined || row === null ? row : (row[column] ?? null);
      },
      raw: (options?: { columnNames?: boolean }) => statement.raw(options as { columnNames: true })
    } as unknown as D1PreparedStatement;
    real.set(wrapped, statement);
    return wrapped;
  };
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") return (query: string) => wrap(target.prepare(query));
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements.map((statement) => real.get(statement) ?? statement));
          for (const result of results) add(result);
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
