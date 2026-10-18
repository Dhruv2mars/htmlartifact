import express from "express";
import { config } from "./config.js";
import { setRevoked } from "./db.js";
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

export async function applyEvent({ event, data = {} }) {
  const userId = data.userId ?? data.user_id;
  const organizationId = data.organizationId ?? data.organization_id;

  switch (event) {
    case "organization_membership.created":
      return setRevoked(userId, organizationId, false);
    case "organization_membership.updated":
      return setRevoked(userId, organizationId, data.status !== "active");
    case "organization_membership.deleted":
      return setRevoked(userId, organizationId, true);
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
