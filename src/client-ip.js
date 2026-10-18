// The client IP for rate limits and audit rows. Behind a proxy that sets a
// trustworthy single-value header (nginx X-Real-IP, Cloudflare
// CF-Connecting-IP, Railway X-Real-IP), name it in HTMLARTIFACT_CLIENT_IP_HEADER.
// Otherwise Express's req.ip applies, which honours X-Forwarded-For only from
// the proxies listed in HTMLARTIFACT_TRUST_PROXY.
const header = process.env.HTMLARTIFACT_CLIENT_IP_HEADER?.trim().toLowerCase();

export function clientIp(req) {
  if (header) {
    const value = req.get?.(header);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return req.ip || null;
}
