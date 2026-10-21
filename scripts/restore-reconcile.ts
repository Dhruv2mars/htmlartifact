// After a D1 Time Travel restore (SECURITY.md: Backups and restore): the SQL
// that re-applies what happened after the bookmark and must stay done.
//   bun scripts/restore-reconcile.ts <before.sql> <restored.sql> > reconcile.sql
// <before.sql> is the export taken just before restoring; <restored.sql> one
// taken just after. Either may also be a SQLite file. The output:
//   - workspaces deleted before the restore are deleted again;
//   - artifacts deleted before the restore (or missing from it) are deleted
//     again, and so are versions pruned from the rest;
//   - CI keys and invite codes revoked (or gone) before the restore are revoked,
//     and invite uses are never handed back;
//   - session revocations, membership epochs, undone joins, queued deletions
//     and today's D1 budgets are carried over;
//   - deleted users' cached names and emails are scrubbed again;
//   - the 5-minute membership cache is dropped, so access is re-checked live.
// It only removes access and data; review it, then apply it with
// `wrangler d1 execute <database> --remote --file=reconcile.sql`.
import { DAILY_BUDGET_SCHEMA } from "../src/budget.ts";
import { PENDING_DELETIONS_SCHEMA, deleteDraftStatements, deleteVersionStatements, deleteWorkspaceStatements, scrubUserStatements } from "../src/purge.ts";

type Row = Record<string, unknown>;
/** Runs a read-only query against one snapshot. */
export type Query = (sql: string) => Row[];

interface Recorded {
  sql: string;
  args: unknown[];
}

// A stand-in for D1 that records the statements the purge builders make.
const recorder = {
  prepare: (sql: string) => ({ sql, args: [] as unknown[], bind: (...args: unknown[]) => ({ sql, args }) })
} as unknown as D1Database;

const literal = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
};

// Inlines the bound values (`?` and `?N`); the builders' SQL has no '?' in strings.
function toSql({ sql, args }: Recorded): string {
  let next = 0;
  const inlined = sql.replace(/\?(\d+)?/g, (_, n?: string) => literal(args[n ? Number(n) - 1 : next++]));
  return `${inlined.replace(/\s+/g, " ").trim()};`;
}

const ids = (query: Query, sql: string, column = "id") => new Set(query(sql).map((row) => String(row[column])));

export function reconcileStatements(before: Query, restored: Query): { sql: string[]; summary: Record<string, number> } {
  // Tables made on first use may postdate the bookmark.
  const statements: Recorded[] = [PENDING_DELETIONS_SCHEMA, DAILY_BUDGET_SCHEMA].map((sql) => ({ sql, args: [] }));
  const add = (built: unknown[]) => statements.push(...(built as Recorded[]));

  // Workspaces: tombstoned before, not now.
  const tombstoned = ids(before, "SELECT organization_id FROM deleted_workspaces", "organization_id");
  const restoredTombstones = ids(restored, "SELECT organization_id FROM deleted_workspaces", "organization_id");
  const workspaces = [...tombstoned].filter((id) => !restoredTombstones.has(id));
  for (const id of workspaces) add(deleteWorkspaceStatements(recorder, id));
  const gone = new Set([...tombstoned]);

  // Artifacts: live now, but deleted or absent before (in a live workspace).
  const liveBefore = ids(before, "SELECT id FROM drafts WHERE deleted_at IS NULL");
  const drafts = restored("SELECT id, organization_id FROM drafts").filter(
    (row) => !liveBefore.has(String(row.id)) && !gone.has(String(row.organization_id))
  );
  for (const row of drafts) add(deleteDraftStatements(recorder, String(row.organization_id), String(row.id)));

  // Versions pruned (or gone) before the restore, of artifacts that stay.
  const versionsBefore = ids(before, "SELECT id FROM draft_versions");
  const doomedDrafts = new Set(drafts.map((row) => String(row.id)));
  const pruned = new Map<string, { organizationId: string; ids: string[] }>();
  for (const row of restored("SELECT v.id, v.draft_id, d.organization_id FROM draft_versions v JOIN drafts d ON d.id = v.draft_id")) {
    const draftId = String(row.draft_id);
    if (versionsBefore.has(String(row.id)) || doomedDrafts.has(draftId) || gone.has(String(row.organization_id))) continue;
    const entry = pruned.get(draftId) ?? { organizationId: String(row.organization_id), ids: [] };
    entry.ids.push(String(row.id));
    pruned.set(draftId, entry);
  }
  for (const [draftId, { organizationId, ids: versionIds }] of pruned) add(deleteVersionStatements(recorder, organizationId, draftId, versionIds));
  const versions = [...pruned.values()].reduce((sum, entry) => sum + entry.ids.length, 0);

  // Credentials: active now, but revoked or absent before.
  const revoke = (table: "ci_keys" | "invites", key: "id" | "code") => {
    const activeBefore = ids(before, `SELECT ${key} FROM ${table} WHERE revoked_at IS NULL`, key);
    const stale = restored(`SELECT ${key}, organization_id FROM ${table} WHERE revoked_at IS NULL`).filter(
      (row) => !activeBefore.has(String(row[key])) && !gone.has(String(row.organization_id))
    );
    for (const row of stale) {
      statements.push({ sql: `UPDATE ${table} SET revoked_at = unixepoch() WHERE ${key} = ? AND revoked_at IS NULL`, args: [row[key]] });
    }
    return stale.length;
  };
  const ciKeys = revoke("ci_keys", "id");
  const invites = revoke("invites", "code");
  for (const row of before("SELECT code, uses FROM invites WHERE uses > 0")) {
    statements.push({ sql: "UPDATE invites SET uses = MAX(uses, ?) WHERE code = ?", args: [row.uses, row.code] });
  }

  // Session revocations and membership fences (epochs, undone joins) only grow.
  const revocations = before("SELECT subject, organization_id, created_at FROM revocations").filter((row) => !gone.has(String(row.organization_id)));
  for (const row of revocations) {
    statements.push({
      sql: "INSERT INTO revocations (subject, organization_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      args: [row.subject, row.organization_id, row.created_at]
    });
  }
  const epochs = before("SELECT user_id, organization_id, epoch FROM membership_epochs").filter((row) => !gone.has(String(row.organization_id)));
  for (const row of epochs) {
    statements.push({
      sql: `INSERT INTO membership_epochs (user_id, organization_id, epoch) VALUES (?, ?, ?)
            ON CONFLICT (user_id, organization_id) DO UPDATE SET epoch = MAX(epoch, excluded.epoch)`,
      args: [row.user_id, row.organization_id, row.epoch]
    });
  }
  const undone = before("SELECT membership_id FROM joins WHERE undone = 1");
  for (const row of undone) statements.push({ sql: "UPDATE joins SET undone = 1 WHERE membership_id = ?", args: [row.membership_id] });
  // Still-queued deletions (an undone join's WorkOS membership is denied
  // while its delete is queued) and today's budgets (Cloudflare's daily
  // usage is not restored).
  const hasTable = (name: string) => before(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${name}'`).length > 0;
  const queued = hasTable("pending_deletions") ? before("SELECT kind, target FROM pending_deletions") : [];
  for (const row of queued) {
    statements.push({ sql: "INSERT INTO pending_deletions (kind, target) VALUES (?, ?) ON CONFLICT (kind, target) DO NOTHING", args: [row.kind, row.target] });
  }
  const budgets = hasTable("daily_budget") ? before("SELECT day, scope, used FROM daily_budget") : [];
  for (const row of budgets) {
    statements.push({
      sql: "INSERT INTO daily_budget (day, scope, used) VALUES (?, ?, ?) ON CONFLICT (day, scope) DO UPDATE SET used = MAX(used, excluded.used)",
      args: [row.day, row.scope, row.used]
    });
  }

  // Users deleted before the restore.
  const scrubbed = before("SELECT id FROM accounts WHERE name = 'Deleted user' AND email IS NULL");
  for (const row of scrubbed) add(scrubUserStatements(recorder, String(row.id)));

  statements.push({ sql: "DELETE FROM memberships", args: [] });
  return {
    sql: statements.map(toSql),
    summary: {
      workspaces: workspaces.length,
      artifacts: drafts.length,
      versions,
      ciKeys,
      invites,
      revocations: revocations.length,
      epochs: epochs.length,
      undoneJoins: undone.length,
      queuedDeletions: queued.length,
      budgets: budgets.length,
      scrubbedUsers: scrubbed.length
    }
  };
}

if (import.meta.main) {
  const { Database } = await import("bun:sqlite");
  const open = async (file: string): Promise<Query> => {
    if (!file) throw new Error("usage: bun scripts/restore-reconcile.ts <before.sql> <restored.sql> > reconcile.sql");
    let db;
    if (file.endsWith(".sql")) {
      db = new Database(":memory:");
      db.exec(await Bun.file(file).text());
    } else db = new Database(file, { readonly: true });
    return (sql) => db.query(sql).all() as Row[];
  };
  const [beforeFile = "", restoredFile = ""] = process.argv.slice(2);
  const { sql, summary } = reconcileStatements(await open(beforeFile), await open(restoredFile));
  console.log(sql.join("\n"));
  console.error(`reconcile: ${JSON.stringify(summary)}`);
}
