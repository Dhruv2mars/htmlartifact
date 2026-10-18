import express from "express";
import { config } from "./config.js";
import { clientIp } from "./client-ip.js";
import { createRateLimiter } from "./rate-limit.js";

// CLI sign-in is the WorkOS device authorization grant, relayed through this
// server: the CLI never holds WorkOS credentials or needs WorkOS URLs, and the
// tokens it receives are ordinary WorkOS access/refresh tokens for the user.
//
//   POST /api/cli/device  → { device_code, user_code, verification_uri(_complete), interval, expires_in }
//   POST /api/cli/token   ← { device_code } | { refresh_token, organization_id? }
//                           | { pending_authentication_token, organization_id }
//                         → WorkOS authenticate response, relayed as-is
export function registerCliAuthRoutes(app) {
  const limit = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.CLI_AUTH_RATE_LIMIT_MAX || 60),
    keyPrefix: "cli-auth",
    key: (req) => clientIp(req) || "anonymous"
  });
  const json = express.json({ limit: "16kb" });

  app.post("/api/cli/device", limit, async (req, res, next) => {
    try {
      const result = await callWorkos("/user_management/authorize/device", {
        client_id: config.workos.clientId
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/cli/token", limit, json, async (req, res, next) => {
    try {
      const body = req.body || {};
      let grant;
      if (typeof body.device_code === "string") {
        grant = { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: body.device_code };
      } else if (typeof body.refresh_token === "string") {
        grant = { grant_type: "refresh_token", refresh_token: body.refresh_token };
      } else if (typeof body.pending_authentication_token === "string") {
        grant = {
          grant_type: "urn:workos:oauth:grant-type:organization-selection",
          pending_authentication_token: body.pending_authentication_token
        };
      } else {
        return res.status(400).json({ error: "invalid_request" });
      }
      if (typeof body.organization_id === "string") grant.organization_id = body.organization_id;

      const result = await callWorkos("/user_management/authenticate", {
        ...grant,
        client_id: config.workos.clientId,
        client_secret: config.workos.apiKey
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  });
}

async function callWorkos(pathname, body) {
  const response = await fetch(`${config.workos.apiUrl}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.workos.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  return { status: response.status, body: await response.json().catch(() => ({ error: "bad_gateway" })) };
}
