// Worker "htmlartifact-ops" (deploy/ops): the jobs Cloudflare Pages cannot run.
//   - scheduled(): retry queued deletions (R2 prefixes, WorkOS orgs) and erase
//     upload request metadata past the retention window. Every 15 minutes.
//   - Ops.limit(): the Workers rate-limit binding, called by Pages over RPC.
import { WorkerEntrypoint } from "cloudflare:workers";
import { drainPendingDeletions, eraseExpiredRequestMetadata, PENDING_DELETIONS_SCHEMA, type PurgeEnv } from "./purge.ts";

export interface OpsEnv extends PurgeEnv {
  UPLOAD_LIMITER: RateLimit;
  AUTH_LIMITER: RateLimit;
}

export type LimitKind = "upload" | "auth";

export class Ops extends WorkerEntrypoint<OpsEnv> {
  /** True when the request identified by `key` is within its limit. */
  async limit(kind: LimitKind, key: string): Promise<boolean> {
    const limiter = kind === "upload" ? this.env.UPLOAD_LIMITER : this.env.AUTH_LIMITER;
    const { success } = await limiter.limit({ key });
    return success;
  }
}

export async function runScheduledJobs(env: PurgeEnv) {
  await env.DB.prepare(PENDING_DELETIONS_SCHEMA).run();
  const deletions = await drainPendingDeletions(env);
  const erased = await eraseExpiredRequestMetadata(env.DB);
  return { deletions, erased };
}

export default {
  async fetch() {
    return new Response("Not found.", { status: 404 });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runScheduledJobs(env).then((result) => console.log(JSON.stringify({ job: "scheduled", ...result })))
    );
  }
} satisfies ExportedHandler<OpsEnv>;
