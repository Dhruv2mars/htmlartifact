import { Data, Effect } from "effect";

// Every failure the CLI reports. Each prints its message and exits 1.

// The user or the server said no: bad input, not signed in, HTTP errors.
export class CliError extends Data.TaggedError("CliError")<{ readonly message: string }> {}

// htmlartifact could not be reached at all: DNS, TLS, timeouts, refused sockets.
export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly message: string }> {}

// Local state (~/.htmlartifact, files being published or written) failed.
export class FileError extends Data.TaggedError("FileError")<{ readonly message: string }> {}

export type HtmlArtifactError = CliError | NetworkError | FileError;

export const isHtmlArtifactError = (error: unknown): error is HtmlArtifactError =>
  error instanceof CliError || error instanceof NetworkError || error instanceof FileError;

export const cliError = (message: string) => new CliError({ message });

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
