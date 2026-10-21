// Daily budgets that keep uploads inside D1 Free's rows-written allowance
// (100,000 a day; past it D1 refuses every write, for every workspace, until
// 00:00 UTC). One row per UTC day and scope. README: Free-tier limits.

export const DAILY_BUDGET_SCHEMA = `CREATE TABLE IF NOT EXISTS daily_budget (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (day, scope)
)`;

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Seconds until the daily budgets reset (00:00 UTC). */
export const secondsUntilUtcMidnight = (now = Date.now()): number =>
  Math.max(1, Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));

/**
 * Takes `count` units of `scope` from today's budget of `perDay`. False, and
 * nothing taken, when they don't fit. One conditional upsert, so concurrent
 * requests cannot overdraw it.
 */
export async function reserveBudget(db: D1Database, scope: string, count: number, perDay: number): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO daily_budget (day, scope, used) SELECT ?1, ?2, ?3 WHERE ?3 <= ?4
       ON CONFLICT (day, scope) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ?4`
    )
    .bind(utcDay(), scope, count, perDay)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Drops budgets older than yesterday (the ops cron). */
export async function pruneBudgets(db: D1Database, now = Date.now()): Promise<number> {
  await db.prepare(DAILY_BUDGET_SCHEMA).run();
  const result = await db.prepare("DELETE FROM daily_budget WHERE day < ?").bind(utcDay(now - 86_400_000)).run();
  return result.meta.changes ?? 0;
}
