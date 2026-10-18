import { Effect } from "effect";

import { USER_AGENT } from "./env.ts";
import { CliError, NetworkError, reason } from "./errors.ts";
import type { Json } from "./state.ts";

export interface JsonResult {
  ok: boolean;
  status: number;
  body: Json;
}

export interface RequestOptions {
  apiKey?: string | undefined;
  body?: unknown;
  method?: string | undefined;
  timeoutMs?: number | undefined;
}

const originOf = (url: string) => new URL(url).origin;

// POSTs `body` as JSON (GET when absent) and returns { ok, status, body }.
// Unreachable servers fail with NetworkError, so callers can tell "could not
// reach the server" apart from "the server rejected this".
export const requestJson = (url: string, options: RequestOptions = {}): Effect.Effect<JsonResult, NetworkError> =>
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
    try {
      return { ok: response.ok, status: response.status, body: JSON.parse(text) as Json };
    } catch {
      return {
        ok: false,
        status: response.status,
        body: { error: `htmlartifact returned HTTP ${response.status}: ${text.slice(0, 200)}` }
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
    return { ok: response.ok, status: response.status, body: json };
  });

export function serverErrorMessage(body: Json): string {
  const details = body.errors?.length ? `\n- ${body.errors.join("\n- ")}` : "";
  return `${body.error || "HTML failed htmlartifact validation."}${details}`;
}

// Calls the API and returns the JSON body, or fails with the server's error.
export const api = (
  apiUrl: string,
  pathname: string,
  options: Omit<RequestOptions, "timeoutMs"> = {}
): Effect.Effect<Json, CliError | NetworkError> =>
  requestJson(`${apiUrl}${pathname}`, options).pipe(
    Effect.flatMap((result) =>
      result.ok ? Effect.succeed(result.body) : Effect.fail(new CliError({ message: serverErrorMessage(result.body) }))
    )
  );
