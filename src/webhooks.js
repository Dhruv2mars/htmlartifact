import { bumpMembershipEpoch, setRevoked, setRevokedAtEpoch } from "./db.js";
import { workos } from "./workos.js";

// WorkOS webhooks close the gap between "removed in WorkOS" and "token
// expired": a removed member, deleted user, revoked session or deleted API
// key is denied on the next request. Point a WorkOS webhook endpoint at
// /webhooks/workos and set WORKOS_WEBHOOK_SECRET.
export function registerWebhooks(app) {
  app.post("/webhooks/workos", async (c) => {
    const config = c.get("config");
    if (!config.workos.webhookSecret) return c.body(null, 404);

    let event;
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
// and only the newest re-check may write (membership epochs, src/db.js).
// Revocations of sessions, keys and users are one-way and order-safe.
async function applyEvent(c, { event, data = {} }) {
  const db = c.env.DB;
  const userId = data.userId ?? data.user_id;
  const organizationId = data.organizationId ?? data.organization_id;

  switch (event) {
    case "organization_membership.created":
    case "organization_membership.updated":
    case "organization_membership.deleted": {
      if (!userId || !organizationId) return;
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
    case "user.deleted":
    case "session.revoked":
    case "api_key.revoked":
    case "api_key.deleted":
      await setRevoked(db, data.id, "*", true);
      return;
    default:
  }
}
