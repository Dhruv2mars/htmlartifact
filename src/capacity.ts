import type { Context, MiddlewareHandler } from "hono";
import { uploadPoolDays } from "./budget.ts";
import { databaseUsage } from "./db.ts";
import type { AppEnv } from "./types.ts";

// The beta gate on new workspaces (product plan G0c). The free tier carries a
// few dozen active teams: past that, a new team would push every existing one
// into the limits. So creating a workspace closes, on the API and the web,
// while the database holds more than 60% of its cap (src/config.ts:
// databaseBytes), or once the deployment's upload budget was 80% spent on 3
// of the last 7 days (src/budget.ts). Joining with an invite stays open.

const STORAGE_SHARE = 0.6;
const BUSY_SHARE = 0.8;
const BUSY_DAYS = 3;
const WINDOW_DAYS = 7;

const CREATION_CLOSED_MESSAGE = "htmlartifact is full for new teams right now. Join a team with its invite link.";

type CreationState = { open: true } | { open: false; reason: "storage" | "uploads"; message: string };

/**
 * Whether a new workspace may be created now. For src/web.ts, to render the
 * create form's closed state.
 * @public
 */
export async function creationOpen<E extends AppEnv>(c: Context<E>): Promise<CreationState> {
  const { databaseBytes, budgets } = c.get("config").limits;
  const usage = await databaseUsage(c.env.DB);
  // D1 reports the database's size with each query; counted HTML bytes stand in if it doesn't.
  if ((usage.size ?? usage.countedBytes) > STORAGE_SHARE * databaseBytes) {
    return { open: false, reason: "storage", message: CREATION_CLOSED_MESSAGE };
  }
  const days = await uploadPoolDays(c.env.DB, WINDOW_DAYS);
  if (days.filter((day) => day.used >= BUSY_SHARE * budgets.upload.perDay).length >= BUSY_DAYS) {
    return { open: false, reason: "uploads", message: CREATION_CLOSED_MESSAGE };
  }
  return { open: true };
}

/** Refuses workspace creation while creationOpen says closed: 507, code "creation_closed". */
export const creationGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const state = await creationOpen(c);
  if (state.open) return next();
  return c.req.path.startsWith("/api/")
    ? c.json({ ok: false, code: "creation_closed", reason: state.reason, error: state.message }, 507)
    : c.text(`${state.message}\n`, 507);
};
