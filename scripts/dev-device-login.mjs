// Local development only (bun run dev:local). The WorkOS emulator approves
// every CLI (device) sign-in at once, as its first seeded user, so a second
// person testing locally silently becomes Alice. This sits in front of the
// emulator (the Worker's WORKOS_API_URL) and passes everything through, except
// that a CLI sign-in waits until someone opens its link, picks who they are
// and confirms the code, as with real WorkOS.
import http from "node:http";
import { getWorkOSStore } from "@workos/emulate/workos";

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title>
<style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:.4rem 0}input[type=text]{font:inherit;letter-spacing:.1em}button{font:inherit;margin-top:1rem}</style>
</head><body><h1>${escape(title)}</h1>${body}</body></html>`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Starts the proxy; `url` replaces the emulator's URL for the Worker.
export async function deviceLoginPicker(emulator, { port = 0, hostname = "127.0.0.1" } = {}) {
  const ws = getWorkOSStore(emulator.store);
  let url = "";

  const pendingCode = (userCode) => {
    const auth = ws.deviceAuthorizations.findOneBy("user_code", String(userCode || "").trim().toUpperCase());
    return auth && !auth.user_id && new Date(auth.expires_at).getTime() > Date.now() ? auth : null;
  };

  const choose = (userCode, error = "") => {
    const users = ws.users.all().filter((u) => u.email);
    const options = users
      .map(
        (u) =>
          `<label><input type="radio" name="email" value="${escape(u.email)}" required> ${escape(u.email)}${u.first_name ? ` (${escape(u.first_name)})` : ""}</label>`
      )
      .join("");
    return page(
      "Sign in the htmlartifact CLI",
      `${error ? `<p role="alert"><strong>${escape(error)}</strong></p>` : ""}
<form method="post" action="/device">
<label>Code shown in your terminal <input type="text" name="user_code" value="${escape(userCode || "")}" required autocomplete="off"></label>
<p>Sign the CLI in as:</p>${options || "<p>No users yet: create one on the web sign-in page first.</p>"}
<button type="submit">Approve</button>
</form>
<p><small>Local WorkOS emulator: anyone here can approve as anyone.</small></p>`
    );
  };

  const server = http.createServer(async (req, res) => {
    const send = (status, html) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    };
    try {
      const { pathname, searchParams } = new URL(req.url, "http://localhost");
      if (req.method === "GET" && (pathname === "/device" || pathname === "/user_management/authorize/device/verify")) {
        return send(200, choose(searchParams.get("user_code")));
      }
      if (req.method === "POST" && pathname === "/device") {
        const form = new URLSearchParams((await readBody(req)).toString("utf8"));
        const auth = pendingCode(form.get("user_code"));
        if (!auth) return send(400, choose(form.get("user_code"), "That code is not waiting for approval (wrong, used or expired)."));
        const email = String(form.get("email") || "").toLowerCase();
        const user = email ? ws.users.all().find((u) => u.email?.toLowerCase() === email) : undefined;
        if (!user) return send(400, choose(form.get("user_code"), "Pick one of the users below."));
        ws.deviceAuthorizations.update(auth.id, { user_id: user.id });
        return send(200, page("CLI approved", `<p>The CLI signs in as <strong>${escape(user.email)}</strong>. Go back to your terminal.</p>`));
      }

      // Everything else goes to the emulator unchanged.
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers["content-length"];
      const upstream = await fetch(`${emulator.url}${req.url}`, { method: req.method, headers, body, redirect: "manual" });
      let payload = Buffer.from(await upstream.arrayBuffer());
      // A new CLI sign-in: unapprove it, and point its link here.
      if (req.method === "POST" && pathname === "/user_management/authorize/device" && upstream.ok) {
        const device = JSON.parse(payload.toString("utf8"));
        const auth = ws.deviceAuthorizations.findOneBy("device_code", device.device_code);
        if (auth) ws.deviceAuthorizations.update(auth.id, { user_id: null });
        device.verification_uri = `${url}/device`;
        device.verification_uri_complete = `${url}/device?user_code=${encodeURIComponent(device.user_code)}`;
        payload = Buffer.from(JSON.stringify(device));
      }
      const out = {};
      upstream.headers.forEach((value, name) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"].includes(name)) out[name] = value;
      });
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) out["set-cookie"] = cookies;
      res.writeHead(upstream.status, out);
      res.end(payload);
    } catch (error) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "device_login_proxy", message: String(error?.message || error) }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
  url = `http://${hostname}:${server.address().port}`;
  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
