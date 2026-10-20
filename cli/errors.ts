import { Data, Effect } from "effect";

// Every failure the CLI reports. Each prints its message (JSON under --json)
// and exits with the code for its kind, so scripts can tell them apart.
export const EXIT_CODES = {
  failure: 1, // anything else: server errors, conflicts, local files
  usage: 2, // bad arguments or flags
  auth: 3, // not signed in, sign-in expired or rejected, not allowed
  notFound: 4, // no such artifact, workspace or member
  validation: 5, // the HTML (or another input) was refused
  network: 6, // htmlartifact could not be reached
  rateLimit: 7 // still rate-limited after a retry
} as const;

export type ErrorKind = keyof typeof EXIT_CODES;

// The user or the server said no: bad input, not signed in, HTTP errors.
// `details` are extra fields for the --json error object.
export class CliError extends Data.TaggedError("CliError")<{
  readonly message: string;
  readonly kind?: ErrorKind | undefined;
  readonly details?: Record<string, unknown> | undefined;
}> {}

// htmlartifact could not be reached at all: DNS, TLS, timeouts, refused sockets.
export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly message: string }> {}

// Local state (~/.htmlartifact, files being published or written) failed.
export class FileError extends Data.TaggedError("FileError")<{ readonly message: string }> {}

export type HtmlArtifactError = CliError | NetworkError | FileError;

export const isHtmlArtifactError = (error: unknown): error is HtmlArtifactError =>
  error instanceof CliError || error instanceof NetworkError || error instanceof FileError;

export const cliError = (message: string, kind?: ErrorKind) => new CliError({ message, kind });

export function errorKind(error: HtmlArtifactError): ErrorKind {
  if (error instanceof NetworkError) return "network";
  if (error instanceof CliError) return error.kind ?? "failure";
  return "failure";
}

// The kind of failure an HTTP status means.
export function kindForStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "notFound";
  if (status === 400 || status === 413 || status === 422) return "validation";
  if (status === 429) return "rateLimit";
  return "failure";
}

// The reason a thrown value carries: fetch hides the real one in `cause`.
export function reason(error: unknown): string {
  if (error && typeof error === "object") {
    const { cause, message } = error as { cause?: { message?: unknown }; message?: unknown };
    if (typeof cause?.message === "string" && cause.message) return cause.message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

// Runs synchronous Node code. A CliError thrown inside passes through as is;
// anything else (fs errors) becomes a FileError with the same message.
export const attempt = <A>(run: () => A): Effect.Effect<A, CliError | FileError> =>
  Effect.try({
    try: run,
    catch: (error) => (error instanceof CliError ? error : new FileError({ message: reason(error) }))
  });
