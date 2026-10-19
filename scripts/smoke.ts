// Post-deploy smoke test: bun run smoke -- https://htmlartifact.pages.dev
const base = (process.argv[2] ?? "https://htmlartifact.pages.dev").replace(/\/$/, "");
const sandbox = base.replace("htmlartifact.pages.dev", "htmlartifact-usercontent.pages.dev");
const failures: string[] = [];

async function expect(url: string, status: number, check?: (res: Response, body: string) => string | null) {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  const problem = res.status !== status ? `status ${res.status}, want ${status}` : check?.(res, body) ?? null;
  console.log(`${problem ? "FAIL" : "ok  "} ${url}${problem ? ` (${problem})` : ""}`);
  if (problem) failures.push(url);
}

await expect(`${base}/healthz`, 200, (_, body) => (JSON.parse(body).ok === true && JSON.parse(body).checks?.storage === true ? null : `body ${body}`));
await expect(`${base}/healthz`, 200, (res) => (res.headers.get("x-content-type-options") === "nosniff" ? null : "missing nosniff"));
await expect(`${base}/api/me`, 401);
await expect(`${base}/d/smoke-test-missing`, 404);
await expect(`${base}/t/smoke.invalid/`, 404);
// The sandbox origin serves capability URLs only: no app, no API, no sign-in.
await expect(`${sandbox}/healthz`, 200);
await expect(`${sandbox}/d/smoke-test-missing`, 404);
await expect(`${sandbox}/`, 404);
await expect(`${sandbox}/api/me`, 404);
await expect(`${sandbox}/auth/sign-in`, 404);
await expect(`${sandbox}/t/smoke.invalid/`, 404, (res) => (res.headers.get("set-cookie") ? "sets a cookie" : null));
if (failures.length) process.exit(1);
