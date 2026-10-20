// Worker "htmlartifact-ops" (deploy/ops): the jobs Cloudflare Pages cannot run.
//   - scheduled(): retry queued deletions (stored HTML, WorkOS orgs) and erase
//     upload request metadata past the retention window. Every 15 minutes.
//   - Ops.limit(): the Workers rate-limit binding, called by Pages over RPC.
import { WorkerEntrypoint } from "cloudflare:workers";
import { drainPendingDeletions, eraseExpiredRequestMetadata, PENDING_DELETIONS_SCHEMA, type PurgeEnv } from "./purge.ts";
import { R2_OPS_SCHEMA } from "./storage.ts";
import type { LimitKind, OpsService } from "./types.ts";

export interface OpsEnv extends PurgeEnv {
  UPLOAD_LIMITER: RateLimit;
  AUTH_LIMITER: RateLimit;
  AUTH_IP_LIMITER: RateLimit;
  API_KEY_LIMITER: RateLimit;
}

const LIMITERS = {
  upload: "UPLOAD_LIMITER",
  auth: "AUTH_LIMITER",
  "auth-ip": "AUTH_IP_LIMITER",
  "api-key": "API_KEY_LIMITER"
} as const satisfies Record<LimitKind, keyof OpsEnv>;

// Pages calls this as env.OPS (src/rate-limit.ts); OpsService is that contract.
export class Ops extends WorkerEntrypoint<OpsEnv> implements OpsService {
  /** True when the request identified by `key` is within its limit. */
  async limit(kind: LimitKind, key: string): Promise<boolean> {
    const binding = LIMITERS[kind];
    if (!binding) throw new Error(`Unknown rate limiter: ${String(kind)}`);
    const limiter = this.env[binding];
    const { success } = await limiter.limit({ key });
    return success;
  }
}

export async function runScheduledJobs(env: PurgeEnv) {
  await env.DB.batch([env.DB.prepare(PENDING_DELETIONS_SCHEMA), env.DB.prepare(R2_OPS_SCHEMA)]);
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
