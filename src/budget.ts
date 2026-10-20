// Daily budgets that keep usage inside free tiers which bill (R2) or lock the
// whole deployment out until 00:00 UTC (D1 rows written). One row per UTC day
// and scope; README: Storage and the free-tier budget.

export const DAILY_BUDGET_SCHEMA = `CREATE TABLE IF NOT EXISTS daily_budget (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (day, scope)
)`;

/** Seconds until the daily budgets reset (00:00 UTC). */
export const secondsUntilUtcMidnight = (now = Date.now()): number =>
  Math.max(1, Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));

/**
 * Takes `count` units of `scope` from today's budget of `perDay`. False, and
 * nothing taken, when they don't fit. One conditional upsert, so concurrent
 * requests cannot overdraw it.
 */
export async function reserveBudget(db: D1Database, scope: string, count: number, perDay: number): Promise<boolean> {
  if (count <= 0) return true;
  const day = new Date().toISOString().slice(0, 10);
  const result = await db
    .prepare(
      `INSERT INTO daily_budget (day, scope, used) SELECT ?1, ?2, ?3 WHERE ?3 <= ?4
       ON CONFLICT (day, scope) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ?4`
    )
    .bind(day, scope, count, perDay)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
