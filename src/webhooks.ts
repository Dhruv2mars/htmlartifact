import type { Event } from "@workos-inc/node";
import type { Context, Hono } from "hono";
import { bumpMembershipEpoch, setRevoked, setRevokedAtEpoch } from "./db.ts";
import { deleteWorkspaceStatements, isWorkspaceDeleted, runWorkspaceDeletions, scrubUserStatements } from "./purge.ts";
import type { AppEnv } from "./types.ts";
import { workos } from "./workos.ts";

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
      const active = page.data.some((m) => m.organizationId === organizationId);
      await setRevokedAtEpoch(db, userId, organizationId, !active, epoch);
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
    case "dsync.user.created":
    case "dsync.user.updated":
    case "dsync.user.deleted": {
      // SCIM deprovisioning. With AuthKit Directory Provisioning on, WorkOS also
      // removes the membership itself; without it, only these events arrive.
      const directoryUserId = field(data, "id");
      if (!directoryUserId || !organizationId) return;
      await syncDirectoryUser(c, directoryUserId, organizationId, [
        field(data, "email"),
        field(Reflect.get(data, "previousAttributes") ?? {}, "email")
      ]);
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

// Every address a directory user has had is remembered, so a rename before
// deactivation cannot hide the account that signed in with the old one.
// Events may be stale or out of order, so the payload's state is never
// trusted: the directory user's current state decides. Anyone no longer
// active (or gone) loses their membership in the directory's workspace only.
async function syncDirectoryUser(
  c: Context<AppEnv>,
  directoryUserId: string,
  eventOrganizationId: string,
  eventEmails: (string | undefined)[]
): Promise<void> {
  const db = c.env.DB;
  const { directorySync, userManagement } = workos(c.get("config")).client;
  const current = await directorySync.getUser(directoryUserId).catch((error: unknown) => {
    if (Reflect.get(Object(error), "status") === 404) return null;
    throw error;
  });
  const organizationId = current?.organizationId ?? eventOrganizationId;
  if (await isWorkspaceDeleted(db, organizationId)) return;

  const seen = [...eventEmails, current?.email].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase());
  if (seen.length) {
    await db.batch(
      seen.map((email) =>
        db
          .prepare("INSERT INTO directory_user_emails (organization_id, directory_user_id, email) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(organizationId, directoryUserId, email)
      )
    );
  }
  if (current?.state === "active") return;

  const { results } = await db
    .prepare("SELECT email FROM directory_user_emails WHERE organization_id = ? AND directory_user_id = ?")
    .bind(organizationId, directoryUserId)
    .all<{ email: string }>();
  for (const { email } of results) {
    const users = await userManagement.listUsers({ email, limit: 10 });
    for (const user of users.data.filter((u) => u.email.toLowerCase() === email)) {
      const epoch = await bumpMembershipEpoch(db, user.id, organizationId);
      const page = await userManagement.listOrganizationMemberships({ userId: user.id, organizationId, limit: 10 });
      for (const membership of page.data.filter((m) => m.organizationId === organizationId)) {
        await userManagement.deleteOrganizationMembership(membership.id);
      }
      await setRevokedAtEpoch(db, user.id, organizationId, true, epoch);
    }
  }
  // Done with them: the history only bridges renames until deprovisioning.
  await db
    .prepare("DELETE FROM directory_user_emails WHERE organization_id = ? AND directory_user_id = ?")
    .bind(organizationId, directoryUserId)
    .run();
}
