// Daily budgets that keep usage inside free tiers which bill (R2) or lock the
// whole deployment out until 00:00 UTC (D1 rows written). One row per UTC day
// and scope; running totals that never reset (R2 stored bytes) use the day
// TOTAL. README: Storage and the free-tier budget.

export const DAILY_BUDGET_SCHEMA = `CREATE TABLE IF NOT EXISTS daily_budget (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (day, scope)
)`;

export const TOTAL = "total";

/** Seconds until the daily budgets reset (00:00 UTC). */
export const secondsUntilUtcMidnight = (now = Date.now()): number =>
  Math.max(1, Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));

/**
 * Takes `count` units of `scope` from today's budget of `perDay` (or from the
 * running total `day`). False, and nothing taken, when they don't fit. One
 * conditional upsert, so concurrent requests cannot overdraw it.
 */
export async function reserveBudget(
  db: D1Database,
  scope: string,
  count: number,
  perDay: number,
  day = new Date().toISOString().slice(0, 10)
): Promise<boolean> {
  if (count <= 0) return true;
  const result = await db
    .prepare(
      `INSERT INTO daily_budget (day, scope, used) SELECT ?1, ?2, ?3 WHERE ?3 <= ?4
       ON CONFLICT (day, scope) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ?4`
    )
    .bind(day, scope, count, perDay)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Gives `count` units of a running total back. */
export async function releaseBudget(db: D1Database, scope: string, count: number, day: string): Promise<void> {
  if (count <= 0) return;
  await db.prepare("UPDATE daily_budget SET used = MAX(0, used - ?) WHERE day = ? AND scope = ?").bind(count, day, scope).run();
}
