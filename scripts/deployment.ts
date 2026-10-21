// A deployment's names and URLs, read from deploy/*/wrangler.toml, so a
// self-hosted copy changes them in one place (README: Deploying).
//   production: the top-level settings; staging: [env.preview] (Pages) and [env.staging] (ops).
const root = new URL("..", import.meta.url).pathname;

type Toml = { name?: string; vars?: Record<string, string>; env?: Record<string, Toml> };
const read = async (project: string) => Bun.TOML.parse(await Bun.file(`${root}deploy/${project}/wrangler.toml`).text()) as Toml;

export async function deployment(staging: boolean) {
  const [app, usercontent, ops] = await Promise.all([read("app"), read("usercontent"), read("ops")]);
  const vars = (staging ? app.env?.preview?.vars : app.vars) || {};
  const appUrl = vars.HTMLARTIFACT_PUBLIC_BASE_URL;
  const sandboxUrl = vars.HTMLARTIFACT_SANDBOX_ORIGIN;
  const opsWorker = staging ? ops.env?.staging?.name : ops.name;
  if (!appUrl || !sandboxUrl || !app.name || !usercontent.name || !opsWorker) {
    throw new Error(
      `deploy/*/wrangler.toml must set name, ${staging ? "[env.preview.vars]" : "[vars]"} HTMLARTIFACT_PUBLIC_BASE_URL and HTMLARTIFACT_SANDBOX_ORIGIN${staging ? ", and [env.staging] name for ops" : ""}`
    );
  }
  const trim = (url: string) => url.replace(/\/+$/, "");
  return { appUrl: trim(appUrl), sandboxUrl: trim(sandboxUrl), appProject: app.name, sandboxProject: usercontent.name, opsWorker };
}
