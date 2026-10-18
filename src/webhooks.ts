import type { Event } from "@workos-inc/node";
import type { Context, Hono } from "hono";
import { bumpMembershipEpoch, now, revokeInvitesUpTo, setRevoked, setRevokedAtEpoch } from "./db.ts";
import { deleteWorkspaceStatements, isWorkspaceDeleted, membershipBeingUndone, runWorkspaceDeletions, scrubUserStatements, undoJoin } from "./purge.ts";
import type { AppEnv } from "./types.ts";
import { revokePortalLinks, workos } from "./workos.ts";

// WorkOS webhooks close the gap between "removed in WorkOS" and "token
// expired": a removed member, deleted user, revoked session or deleted API
// key is denied on the next request. Point a WorkOS webhook endpoint at
// /webhooks/workos and set WORKOS_WEBHOOK_SECRET.
export function registerWebhooks(app: Hono<AppEnv>): void {
  app.post("/webhooks/workos", async (c) => {
    const config = c.get("config");
    if (!config.workos.webhookSecret) return c.body(null, 404);

    let event: Event;
    try {
      event = await workos(config).client.webhooks.constructEvent({
        payload: await c.req.text(),
        sigHeader: c.req.header("workos-signature") || "",
        secret: config.workos.webhookSecret
      });
    } catch {
      return c.json({ ok: false, error: "Invalid signature." }, 400);
    }

    try {
      await applyEvent(c, event);
      return c.json({ ok: true });
    } catch (error) {
      console.error(`webhook ${event.event} failed:`, error);
      return c.json({ ok: false }, 500);
    }
  });
}

// WorkOS does not guarantee delivery order, so membership events are never
// applied from the payload: they trigger a re-check of the current state,
// and only the newest re-check may write (membership epochs, src/db.ts).
// Revocations of sessions, keys and users are one-way and order-safe.
async function applyEvent(
  c: Context<AppEnv>,
  { event, data = {}, createdAt }: { event: string; data?: object; createdAt?: string }
): Promise<void> {
  const db = c.env.DB;
  const userId = field(data, "userId") ?? field(data, "user_id");
  const organizationId = field(data, "organizationId") ?? field(data, "organization_id");

  switch (event) {
    case "organization_membership.created":
    case "organization_membership.updated":
    case "organization_membership.deleted": {
      if (!userId || !organizationId) return;
      // Deleting a workspace deletes its WorkOS organization, which fires
      // these for every member. Nothing is left to update: ignore them.
      if (await isWorkspaceDeleted(db, organizationId)) return;
      // A deleted membership: they may hold an invite code, so the codes
      // issued up to this event stop working. Unconditional and first (no
      // lookup can fail before it; one-way and time-keyed, so late or repeated
      // events only revoke codes already due). Deactivated memberships need
      // no revocation: joinWithCode refuses them.
      if (event === "organization_membership.deleted") {
        const removedId = field(data, "id");
        const at = eventTime(createdAt);
        // Our own undo of a join (its code was revoked mid-join): that code is
        // already revoked, and revoking more would hit codes issued since.
        const undone = removedId
          ? await db.prepare("SELECT 1 FROM joins WHERE membership_id = ? AND undone = 1").bind(removedId).first()
          : null;
        if (!undone) {
          await revokeInvitesUpTo(db, organizationId, at);
          // Removed outside our app and back in before this event arrived,
          // through a code that was due for revocation at the removal: undo it.
          const { results } = await db
            .prepare(
              `SELECT membership_id FROM joins WHERE user_id = ? AND organization_id = ? AND membership_id != ?
                 AND undone = 0 AND code_created_at <= ?`
            )
            .bind(userId, organizationId, removedId ?? "", at)
            .all<{ membership_id: string }>();
          for (const { membership_id } of results) await undoJoin(c.env, membership_id);
        }
      }
      // Fail safe: bump the epoch and drop the cache first, so if WorkOS
      // cannot be reached below, the next request re-checks live; and a slower
      // handler that started earlier can no longer write its stale answer.
      const epoch = await bumpMembershipEpoch(db, userId, organizationId);
      // A deleted user's memberships can 404: that is "no membership".
      const page = await workos(c.get("config"))
        .client.userManagement.listOrganizationMemberships({ userId, organizationId, statuses: ["active"], limit: 1 })
        .catch((error: unknown) => {
          if (Reflect.get(Object(error), "status") === 404) return { data: [] };
          throw error;
        });
      const found = page.data.find((m) => m.organizationId === organizationId);
      const membership = found && !(await membershipBeingUndone(db, found.id)) ? found : undefined;
      const active = Boolean(membership);
      await setRevokedAtEpoch(db, userId, organizationId, !active, epoch);
      // No longer an active admin: end any Admin Portal session they opened.
      // A failure returns 500, so WorkOS retries; access already ended above.
      if (membership?.role?.slug !== "admin") await revokePortalLinks(c.get("config"), organizationId, userId);
      return;
    }
    case "organization.deleted": {
      // Deleted in WorkOS directly (e.g. the dashboard): delete the workspace
      // here too. Ours already deleted (by DELETE /api/workspaces/current): no-op.
      const id = field(data, "id");
      if (!id) throw new Error(`${event} has no id.`);
      if (await isWorkspaceDeleted(db, id)) return;
      await db.batch(deleteWorkspaceStatements(db, id));
      // R2 can take a while; the cron retries anything left queued.
      c.executionCtx.waitUntil(runWorkspaceDeletions(c.env, id));
      return;
    }
    case "user.deleted": {
      // Revoke everywhere and drop cached PII. Their artifacts stay.
      const id = field(data, "id");
      if (!id) throw new Error(`${event} has no id.`);
      await setRevoked(db, id, "*", true);
      // They may hold invite codes to any workspace they were in.
      const { results } = await db
        // Workspaces we last saw them active in, or joined through a code
        // (not ones they left long ago).
        .prepare(
          `SELECT organization_id FROM memberships WHERE user_id = ?1
           UNION SELECT organization_id FROM joins WHERE user_id = ?1 AND undone = 0`
        )
        .bind(id)
        .all<{ organization_id: string }>();
      for (const { organization_id } of results) await revokeInvitesUpTo(db, organization_id, eventTime(createdAt));
      await db.batch(scrubUserStatements(db, id));
      return;
    }
    case "session.revoked":
    case "api_key.revoked":
    case "api_key.deleted": {
      const id = field(data, "id");
      if (!id) throw new Error(`${event} has no id.`);
      await setRevoked(db, id, "*", true);
      return;
    }
    default:
  }
}

// A string field of an event payload; payload shapes vary by event.
function field(data: object, key: string): string | undefined {
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value : undefined;
}

// An event's time in unix seconds (now, if the payload has none).
function eventTime(createdAt: string | undefined): number {
  const at = createdAt ? Math.floor(Date.parse(createdAt) / 1000) : NaN;
  return Number.isFinite(at) ? at : now();
}
