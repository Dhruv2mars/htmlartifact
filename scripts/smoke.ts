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

await expect(`${base}/healthz`, 200, (_, body) => (JSON.parse(body).ok === true ? null : `body ${body}`));
await expect(`${base}/healthz`, 200, (res) => (res.headers.get("x-content-type-options") === "nosniff" ? null : "missing nosniff"));
await expect(`${base}/api/me`, 401);
await expect(`${base}/d/smoke-test-missing`, 302);
await expect(`${sandbox}/healthz`, 200);
await expect(`${sandbox}/d/smoke-test-missing`, 404);
if (failures.length) process.exit(1);
