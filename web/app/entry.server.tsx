import { prerender } from "react-dom/static";
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";

// Always render the whole page before responding: pages are small, and the
// same input must give byte-identical output (the isolation tests compare a
// forbidden page with a missing one). `prerender` waits for every lazy page
// chunk before writing anything, so the HTML arrives complete and visible,
// with no hidden boundaries for a script to reveal (it reads without JS).
// React outlines any boundary over `progressiveChunkSize` (12.8 KB by
// default) even when it is complete; every page is one boundary, so lift it.
export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  routerContext: EntryContext
): Promise<Response> {
  let failed = false;
  const { prelude } = await prerender(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    progressiveChunkSize: Number.MAX_SAFE_INTEGER,
    onError(error: unknown) {
      failed = true;
      console.error(error);
    }
  });
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(prelude, { headers, status: failed ? 500 : status });
}

// The Worker sets the page through this exact context object (src/frontend.ts
// reaches it as build.entry.module.pageContext).
export { originContext, pageContext } from "./context";
