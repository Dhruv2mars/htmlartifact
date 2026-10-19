import { renderToReadableStream } from "react-dom/server";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";

// Always render the whole page before responding: pages are small, and the
// same input must give byte-identical output (the isolation tests compare a
// forbidden page with a missing one).
export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  routerContext: EntryContext
): Promise<Response> {
  let failed = false;
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      failed = true;
      console.error(error);
    }
  });
  await body.allReady;
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers, status: failed ? 500 : status });
}

// The Worker sets the page through this exact context object (src/frontend.ts
// reaches it as build.entry.module.pageContext).
export { originContext, pageContext } from "./context";
