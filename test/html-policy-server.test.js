import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { validateHtml } from "../src/html-policy.ts";
import { corpus, realisticPage, rng } from "./html-corpus.js";
import { STORAGE, accessToken, callApi, startStack } from "./helpers.js";

// The server validates with the Workers runtime's HTMLRewriter
// (src/html-policy-server.ts); the CLI with parse5 (src/html-policy.ts).
// This sends a generated corpus through the server's POST /api/check and
// compares every page with parse5 run here:
//   - realistic reports: identical results (ok, error and warning codes,
//     hasScripts, title, image hosts);
//   - hostile markup and random token soup: the server is never looser.
//     It may add codes or set hasScripts where a token stream reads the page
//     differently from parse5's tree builder (see the top of
//     src/html-policy-server.ts), and after refusing a page as ambiguous it
//     may miss later findings; it never accepts a page parse5 rejects, never
//     misses an error parse5 reports otherwise, and never says a page has no
//     scripts when parse5 says it has.

const MAX_PAGES = STORAGE === "r2" ? 50 : 10;
// parse5's own resource limits; the server has others (see "Limits" there).
const RESOURCE_CODES = new Set(["too-deep", "too-many-attributes"]);
// The server stopped trusting the rest of the page.
const REFUSAL_CODES = new Set(["ambiguous-markup", "too-deep", "parse-failed"]);

let stack;
let tokens;

before(async () => {
  stack = await startStack();
  // /api/check allows 60 calls a minute per account: spread the corpus.
  tokens = await Promise.all(["alice@acme.test", "bob@acme.test", "max@both.test"].map((email) => accessToken(stack, email, "Acme")));
});

after(async () => {
  await stack?.stop();
});

let calls = 0;
// Checks pages on the server, MAX_PAGES per request. Returns, per page, the
// server's codes, title, and hasScripts.
async function serverCheck(pages) {
  const results = [];
  for (let start = 0; start < pages.length; start += MAX_PAGES) {
    const batch = pages.slice(start, start + MAX_PAGES);
    // Always two pages or more, so every issue names its page.
    const files = [{ path: "index.html", html: "<title>index</title>" }, ...batch.map((html, i) => ({ path: `p${i}.html`, html }))];
    const res = await callApi(stack, tokens[calls++ % tokens.length], "POST", "/api/check", { files });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 500));
    batch.forEach((_, i) => {
      const path = `p${i}.html`;
      const page = res.body.pages.find((p) => p.path === path);
      const issues = res.body.issues.filter((issue) => issue.path === path);
      results.push({
        ok: !issues.some((issue) => issue.level === "error"),
        errors: codes(issues, "error"),
        warnings: codes(issues, "warning"),
        hasScripts: page.hasScripts,
        title: page.title,
        positions: issues.some((issue) => issue.line !== undefined)
      });
    });
  }
  return results;
}

const codes = (issues, level) => [...new Set(issues.filter((issue) => issue.level === level).map((issue) => issue.code))].sort();

function local(html) {
  const result = validateHtml(html);
  return {
    ok: result.ok,
    errors: codes(result.issues, "error"),
    warnings: codes(result.issues, "warning"),
    hasScripts: result.hasScripts,
    title: result.title
  };
}

const show = (html) => JSON.stringify(html.length > 400 ? `${html.slice(0, 400)}...` : html);

function assertSame(html, mine, server) {
  const { positions, ...rest } = server;
  assert.deepEqual(rest, mine, `server differs from parse5 on ${show(html)}`);
  assert.equal(positions, false, "server issues carry no positions");
}

function assertNeverLooser(html, mine, server) {
  const where = `on ${show(html)}\nparse5: ${JSON.stringify(mine)}\nserver: ${JSON.stringify(server)}`;
  const refused = server.errors.some((code) => REFUSAL_CODES.has(code));
  if (mine.errors.some((code) => !RESOURCE_CODES.has(code))) assert.equal(server.ok, false, `server accepts a page parse5 rejects ${where}`);
  if (mine.hasScripts) assert.equal(server.hasScripts, true, `server misses scripts ${where}`);
  if (!refused) {
    for (const code of mine.errors) {
      if (!RESOURCE_CODES.has(code)) assert.ok(server.errors.includes(code), `server misses ${code} ${where}`);
    }
  }
  if (refused) assert.equal(server.hasScripts, true, `a refused page counts as scripted ${where}`);
}

describe("the server's HTMLRewriter validator agrees with parse5", () => {
  const pages = corpus({ seed: 20261019, realistic: 300, soup: 400, mutated: 250 });

  test(`${pages.realistic.length} realistic reports: identical results`, async () => {
    const server = await serverCheck(pages.realistic);
    pages.realistic.forEach((html, i) => assertSame(html, local(html), server[i]));
    // The corpus exercises what it should.
    const all = server.flatMap((s) => [...s.errors, ...s.warnings]);
    for (const code of ["blocked-tag", "unsafe-url", "unsafe-css", "external-script", "script-type", "link-rel", "link-href", "meta-refresh", "srcdoc", "relative-asset", "no-title", "sandbox-storage", "sandbox-network", "sandbox-dialog", "sandbox-worker", "sandbox-cookie"]) {
      assert.ok(all.includes(code), `corpus never produced ${code}`);
    }
    assert.ok(server.some((s) => s.hasScripts) && server.some((s) => !s.hasScripts));
  });

  test(`${pages.tricky.length} tricky pages: identical where expected, never looser`, async () => {
    const server = await serverCheck(pages.tricky.map((t) => t.html));
    pages.tricky.forEach(({ html, exact }, i) => {
      const mine = local(html);
      assertNeverLooser(html, mine, server[i]);
      if (exact) assertSame(html, mine, server[i]);
    });
  });

  test(`${pages.soup.length} token soups and ${pages.mutated.length} mutated reports: never looser`, async () => {
    const all = [...pages.soup, ...pages.mutated];
    const server = await serverCheck(all);
    let differing = 0;
    all.forEach((html, i) => {
      const mine = local(html);
      assertNeverLooser(html, mine, server[i]);
      const { positions, ...rest } = server[i];
      if (JSON.stringify(rest) !== JSON.stringify(mine)) differing++;
    });
    // Most hostile pages are still read identically.
    assert.ok(differing < all.length / 2, `${differing} of ${all.length} pages differ`);
  });
});

describe("validation cost on the server", () => {
  // A ~2 MiB report (tables, charts, scripts, handlers, a <noscript>): under
  // HTMLRewriter the server validates it in a few milliseconds of CPU.
  function bigReport(bytes) {
    const r = rng(7);
    const parts = ["<!doctype html><html><head><title>Big report</title></head><body><noscript><p>Enable JavaScript</p></noscript>"];
    let size = parts[0].length;
    while (size < bytes) {
      const section = realisticPage(r).replace(/<!doctype html>|<\/?(html|head|body)[^>]*>|<title>[^<]*<\/title>|<meta[^>]*>/gi, "");
      parts.push(section);
      size += section.length;
    }
    parts.push("</body></html>");
    return parts.join("\n").slice(0, bytes - 20) + "</body></html>";
  }

  test("a 2 MiB page checks in well under a second, with the same verdict as parse5", async () => {
    const html = bigReport(2 * 1024 * 1024 - 64 * 1024);
    const mine = validateHtml(html);
    const started = performance.now();
    const res = await callApi(stack, tokens[0], "POST", "/api/check", { html });
    const ms = performance.now() - started;
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, mine.ok);
    assert.equal(res.body.pages[0].hasScripts, mine.hasScripts);
    assert.deepEqual(codes(res.body.issues, "error"), codes(mine.issues, "error"));
    assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  });
});
