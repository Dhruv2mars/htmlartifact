import type { Event } from "@workos-inc/node";
import type { Context, Hono } from "hono";
import { bumpMembershipEpoch, setRemovedAtEpoch, setRevoked, setRevokedAtEpoch } from "./db.ts";
import { deleteWorkspaceStatements, isWorkspaceDeleted, runWorkspaceDeletions, scrubUserStatements } from "./purge.ts";
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
async function applyEvent(c: Context<AppEnv>, { event, data = {} }: { event: string; data?: object }): Promise<void> {
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
      // Fail safe: bump the epoch and drop the cache first, so if WorkOS
      // cannot be reached below, the next request re-checks live; and a slower
      // handler that started earlier can no longer write its stale answer.
      const epoch = await bumpMembershipEpoch(db, userId, organizationId);
      const page = await workos(c.get("config")).client.userManagement.listOrganizationMemberships({
        userId,
        organizationId,
        statuses: ["active"],
        limit: 1
      });
      const membership = page.data.find((m) => m.organizationId === organizationId);
      const active = Boolean(membership);
      await setRevokedAtEpoch(db, userId, organizationId, !active, epoch);
      // Removed or deactivated (including a deleted pending membership): an
      // old invite must not bring them back. Active again (the directory
      // reactivated them): the block lifts.
      if (active || event !== "organization_membership.created") {
        await setRemovedAtEpoch(db, userId, organizationId, !active, epoch);
      }
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
