import express from "express";
import { config } from "./config.js";
import { forgetMembership, setRevoked } from "./db.js";
import { workos } from "./workos.js";

// WorkOS webhooks close the gap between "removed in WorkOS" and "access token
// expired": a removed member, deleted user, revoked session or deleted API
// key is denied on the next request. Point a WorkOS webhook endpoint at
// /webhooks/workos and set WORKOS_WEBHOOK_SECRET.
export function registerWebhookRoutes(app) {
  app.post("/webhooks/workos", express.text({ type: "*/*", limit: "1mb" }), async (req, res) => {
    if (!config.workos.webhookSecret) return res.status(404).end();

    let event;
    try {
      event = await workos().webhooks.constructEvent({
        payload: req.body,
        sigHeader: req.get("workos-signature") || "",
        secret: config.workos.webhookSecret
      });
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid signature." });
    }

    try {
      await applyEvent(event);
      res.json({ ok: true });
    } catch (error) {
      console.error(`webhook ${event.event} failed:`, error);
      res.status(500).json({ ok: false });
    }
  });
}

// WorkOS does not guarantee delivery order, so membership events are never
// applied from the payload: they trigger a re-check of the current state in
// WorkOS. Revocations of sessions, keys and users are one-way and safe in
// any order.
export async function applyEvent({ event, data = {} }) {
  const userId = data.userId ?? data.user_id;
  const organizationId = data.organizationId ?? data.organization_id;

  switch (event) {
    case "organization_membership.created":
    case "organization_membership.updated":
    case "organization_membership.deleted": {
      if (!userId || !organizationId) return undefined;
      // Fail safe: forget the cached membership first, so if WorkOS cannot be
      // reached below, the next request re-checks live instead of trusting it.
      await forgetMembership(userId, organizationId);
      const page = await workos().userManagement.listOrganizationMemberships({
        userId,
        organizationId,
        statuses: ["active"],
        limit: 1
      });
      const active = page.data.some((m) => m.organizationId === organizationId);
      return setRevoked(userId, organizationId, !active);
    }
    case "user.deleted":
      return setRevoked(data.id, "*", true);
    case "session.revoked":
      return setRevoked(data.id, "*", true);
    case "api_key.revoked":
    case "api_key.deleted":
      return setRevoked(data.id, "*", true);
    default:
      return undefined;
  }
}
