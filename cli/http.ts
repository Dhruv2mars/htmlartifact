import { Console, Duration, Effect } from "effect";

import { envToken, USER_AGENT } from "./env.ts";
import { CliError, kindForStatus, NetworkError, reason } from "./errors.ts";
import type { Json } from "./state.ts";

export interface JsonResult {
  ok: boolean;
  status: number;
  body: Json;
  // Seconds from a Retry-After header (429, 503), when the server sent one.
  retryAfter?: number | undefined;
}

export interface RequestOptions {
  apiKey?: string | undefined;
  body?: unknown;
  method?: string | undefined;
  timeoutMs?: number | undefined;
}

const originOf = (url: string) => new URL(url).origin;

// The longest Retry-After a rate-limited request waits out before its one retry.
const MAX_RATE_LIMIT_WAIT_SECONDS = 60;

// POSTs `body` as JSON (GET when absent) and returns { ok, status, body }.
// Unreachable servers fail with NetworkError, so callers can tell "could not
// reach the server" apart from "the server rejected this". A 429 was not acted
// on, so it is retried once after its Retry-After (1s when absent).
export const requestJson = (url: string, options: RequestOptions = {}): Effect.Effect<JsonResult, NetworkError> =>
  Effect.gen(function* () {
    const result = yield* requestOnce(url, options);
    const wait = result.retryAfter ?? 1;
    if (result.status !== 429 || wait > MAX_RATE_LIMIT_WAIT_SECONDS) return result;
    yield* Console.error(`Rate-limited by htmlartifact (HTTP 429). Retrying in ${wait}s...`);
    yield* Effect.sleep(Duration.seconds(wait));
    return yield* requestOnce(url, options);
  });

const requestOnce = (url: string, options: RequestOptions): Effect.Effect<JsonResult, NetworkError> =>
  Effect.gen(function* () {
    const { apiKey, body, method } = options;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const headers: Record<string, string> = { "User-Agent": USER_AGENT };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: method || (body === undefined ? "GET" : "POST"),
          headers,
          body: body === undefined ? null : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        }),
      catch: (error) =>
        new NetworkError({
          message: `Could not reach ${originOf(url)}: ${
            (error as { name?: unknown })?.name === "TimeoutError" ? `timed out after ${timeoutMs / 1000}s` : reason(error)
          }`
        })
    });

    // The connection can also drop or time out while the body streams in.
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new NetworkError({ message: `Lost the connection to ${originOf(url)}: ${reason(error)}` })
    });
    const retryAfter = retryAfterSeconds(response);
    try {
      return { ok: response.ok, status: response.status, body: JSON.parse(text) as Json, retryAfter };
    } catch {
      return {
        ok: false,
        status: response.status,
        body: { error: `htmlartifact returned HTTP ${response.status}: ${text.slice(0, 200)}` },
        retryAfter
      };
    }
  });

// The unauthenticated sign-in endpoints. An unreadable body counts as {}.
export const postJson = (url: string, body: unknown): Effect.Effect<JsonResult, NetworkError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000)
        }),
      catch: (error) => new NetworkError({ message: `Could not reach ${originOf(url)}: ${reason(error)}` })
    });
    const json = yield* Effect.promise(() => response.json().then((value) => value as Json, () => ({}) as Json));
    return { ok: response.ok, status: response.status, body: json, retryAfter: retryAfterSeconds(response) };
  });

// Retry-After in seconds (delta-seconds or an HTTP date), or undefined.
function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function serverErrorMessage(body: Json): string {
  const details = body.errors?.length ? `\n- ${body.errors.join("\n- ")}` : "";
  return `${body.error || "HTML failed htmlartifact validation."}${details}`;
}

// HTMLARTIFACT_TOKEN wins over a saved sign-in, so say it was the one refused.
export const rejectedEnvToken = () =>
  new CliError({
    kind: "auth",
    message:
      "HTMLARTIFACT_TOKEN was rejected (HTTP 401). Set it to a valid WorkOS organization API key, or unset it to use your own sign-in (htmlartifact login)."
  });

// The error for a refused request: the server's message, with an exit code
// for its status. `prefix` says what was refused.
export function httpError(result: JsonResult, prefix = ""): CliError {
  if (result.status === 401 && envToken()) return rejectedEnvToken();
  const retry = result.status === 429 && result.retryAfter ? ` Try again in ${result.retryAfter}s.` : "";
  return new CliError({ message: `${prefix}${serverErrorMessage(result.body)}${retry}`, kind: kindForStatus(result.status) });
}

// Calls the API and returns the JSON body, or fails with the server's error.
export const api = (
  apiUrl: string,
  pathname: string,
  options: Omit<RequestOptions, "timeoutMs"> = {}
): Effect.Effect<Json, CliError | NetworkError> =>
  requestJson(`${apiUrl}${pathname}`, options).pipe(
    Effect.flatMap((result) =>
      result.ok ? Effect.succeed(result.body) : Effect.fail(httpError(result))
    )
  );
