import { createHash } from "node:crypto";

// The upload policy itself: which elements and attributes a page may use,
// the issue codes and messages, and the upload-wide checks (paths, sizes,
// page counts). Two validators apply it, and must agree:
//   src/html-policy.ts         parse5's tree builder (CLI, local checks:
//                              exact line and column for every issue)
//   src/html-policy-server.ts  the Workers runtime's native HTMLRewriter
//                              (the server: fits Workers Free CPU limits)
// Nothing here parses HTML, so the Worker bundle stays free of parse5.

export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  fix?: string;
  line?: number;
  column?: number;
  count: number;
  path?: string;
}

export interface HtmlValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  issues: Issue[];
  title: string | null;
  hasScripts: boolean;
  bytes: number;
  stats: { hasInlineScript: boolean; externalImageHosts: string[] };
}

export interface PageInput {
  path?: unknown;
  html?: unknown;
}

interface ValidatedPage extends HtmlValidation {
  path: string;
  html: string;
}

export interface UploadValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  issues: Issue[];
  pages: ValidatedPage[];
  totalBytes: number;
  hasScripts: boolean;
  title: string | null;
  contentHash: string | null;
}

export interface UploadLimits {
  maxBytes?: number;
  maxPages?: number;
}

// An attribute as the validators see it: ASCII-lowercased name (foreign
// attributes such as xlink:href adjusted to their local name, as parse5 does),
// value with character references decoded.
export interface Attribute {
  name: string;
  value: string;
}

export interface IssueOptions<N> {
  node?: N;
  at?: Position | null; // a location for issues without a node
  attr?: string;
  fix?: string;
}

export interface Position {
  startLine: number;
  startCol: number;
}

export interface Location extends Position {
  attrs?: Record<string, Position>;
}

const EMBED_FIX = "Link to the page instead of embedding it.";
const BLOCKED_TAGS = new Map<string, string>([
  ["form", "Forms cannot submit on htmlartifact. Use inputs without a <form> wrapper."],
  ["iframe", EMBED_FIX],
  ["object", EMBED_FIX],
  ["embed", EMBED_FIX],
  ["applet", EMBED_FIX]
]);

const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "srcdoc", "xlink:href"]);

const BLOCKED_PROTOCOLS = ["javascript:", "vbscript:", "file:"];

// Scripts the browser runs. Inline only: the CSP never allows a script URL.
const EXECUTABLE_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
// Inert data blocks. The browser never runs these, so they need no sign-in.
const DATA_SCRIPT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "text/plain",
  "text/template",
  "text/html",
  "text/markdown",
  "text/csv"
]);

// Every token of a <link rel> must be one of these. The serving CSP bounds
// what they can load (https stylesheets, fonts, and icons).
const ALLOWED_LINK_RELS = new Set([
  "stylesheet",
  "alternate",
  "icon",
  "shortcut",
  "apple-touch-icon",
  "preconnect",
  "dns-prefetch"
]);

// Event handler content attributes browsers run (HTML, CSS, pointer, touch,
// and SVG animation events). Other on* attributes, such as one="x", are inert.
// A handler missing here still cannot run on a page without scripts: its
// CSP sets script-src-attr 'none'.
export const EVENT_HANDLER_ATTRS = new Set(
  `abort afterprint animationcancel animationend animationiteration animationstart
  auxclick beforecopy beforecut beforeinput beforematch beforepaste beforeprint
  beforetoggle beforeunload beforexrselect begin blur cancel canplay
  canplaythrough change click close command contentvisibilityautostatechange
  contextlost contextmenu contextrestored copy cuechange cut dblclick devicemotion
  deviceorientation deviceorientationabsolute drag dragend dragenter dragexit
  dragleave dragover dragstart drop durationchange emptied encrypted end ended
  error focus focusin focusout formdata freeze fullscreenchange fullscreenerror
  gesturechange gestureend gesturestart gotpointercapture hashchange input
  invalid keydown keypress keyup languagechange load loadeddata loadedmetadata
  loadstart lostpointercapture message messageerror mousedown mouseenter
  mouseleave mousemove mouseout mouseover mouseup mousewheel offline online
  orientationchange pagehide pagereveal pageshow pageswap paste pause play
  playing pointercancel pointerdown pointerenter pointerleave pointermove
  pointerout pointerover pointerrawupdate pointerup popstate prerenderingchange
  progress ratechange readystatechange rejectionhandled repeat reset resize
  resume scroll scrollend scrollsnapchange scrollsnapchanging search
  securitypolicyviolation seeked seeking select selectionchange selectstart
  slotchange stalled storage submit suspend timeupdate toggle touchcancel
  touchend touchmove touchstart transitioncancel transitionend transitionrun
  transitionstart unhandledrejection unload visibilitychange volumechange waiting
  waitingforkey webkitanimationend webkitanimationiteration webkitanimationstart
  webkitfullscreenchange webkitfullscreenerror webkittransitionend wheel zoom`
    .split(/\s+/)
    .map((event) => `on${event}`)
);

// Tags whose src must already be hosted somewhere: htmlartifact only hosts HTML.
const EMBED_SRC_TAGS = new Set(["img", "video", "audio", "source", "track"]);

// Browser APIs that fail inside the scripted-draft sandbox (opaque origin,
// connect-src 'none', no allow-modals). Reported as warnings so agents learn
// before a reader finds a broken page.
export const SANDBOX_APIS: { code: string; pattern: RegExp; message: string; fix: string }[] = [
  {
    code: "sandbox-storage",
    pattern: /\b(localStorage|sessionStorage|indexedDB)\b/,
    message: "Scripts use browser storage, which throws in the htmlartifact sandbox.",
    fix: "Keep state in memory or in location.hash."
  },
  {
    code: "sandbox-cookie",
    pattern: /\bdocument\.cookie\b/,
    message: "Scripts use document.cookie, which throws in the htmlartifact sandbox.",
    fix: "Keep state in memory or in location.hash."
  },
  {
    code: "sandbox-network",
    pattern: /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/,
    message: "Scripts make network requests, which the htmlartifact sandbox blocks.",
    fix: 'Inline the data in the page, for example in a <script type="application/json"> block.'
  },
  {
    code: "sandbox-dialog",
    pattern: /\b(alert|confirm|prompt)\s*\(/,
    message: "Scripts use alert/confirm/prompt, which do nothing in the htmlartifact sandbox.",
    fix: "Show messages in the page instead."
  },
  {
    code: "sandbox-worker",
    pattern: /\bnew\s+(Shared)?Worker\b/,
    message: "Scripts start workers, which the htmlartifact sandbox blocks.",
    fix: "Run the code on the main thread."
  }
];

export const NO_TITLE_MESSAGE = "No <title> found; htmlartifact will use a generic title.";

// Multi-page uploads map each page path to a URL on the draft's host. These
// first segments are taken by the /v/<n> and /raw aliases and by service
// routes. Express matches routes case-insensitively, so the check does too.
const PAGE_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const RESERVED_PAGE_ROOTS = new Set([
  "v",
  "raw",
  "api",
  "healthz",
  "favicon.ico",
  "favicon.png",
  "favicon.svg"
]);
const MAX_PAGE_PATH_LENGTH = 200;
const MAX_PAGE_PATH_SEGMENTS = 6;

// What a validator does with an element's findings. Both validators call
// checkElementRules for every element they check, so codes, messages, and
// fixes come from one place.
export interface RuleSink {
  error(code: string, message: string, options?: { attr?: string; fix?: string }): void;
  warning(code: string, message: string, options?: { attr?: string; fix?: string }): void;
  // The element is a <script> the browser runs; its text needs the sandbox checks.
  executableScript(): void;
  // An event handler attribute (value trimmed): the page runs code.
  handler(attr: string, value: string): void;
  // The element is a <title>.
  title(): void;
  imageHost(host: string): void;
}

export function checkElementRules(rawTagName: string, attrs: readonly Attribute[], sink: RuleSink): void {
  const tagName = rawTagName.toLowerCase();
  const attributes = new Map(attrs.map((attr) => [attr.name.toLowerCase(), String(attr.value || "").trim()]));

  if (BLOCKED_TAGS.has(tagName)) {
    sink.error("blocked-tag", `Blocked <${tagName}> tag.`, { fix: BLOCKED_TAGS.get(tagName)! });
  }

  if (tagName === "script") {
    if (attributes.has("src")) {
      sink.error("external-script", "External script sources are not allowed.", {
        fix: "Inline the code in a <script> block."
      });
    }

    const scriptType = (attributes.get("type") || "").toLowerCase();
    if (EXECUTABLE_SCRIPT_TYPES.has(scriptType)) {
      sink.executableScript();
    } else if (!DATA_SCRIPT_TYPES.has(scriptType)) {
      sink.error("script-type", `Unsupported script type "${scriptType}".`, {
        fix: 'Use a classic or type="module" inline script, or type="application/json" for data.'
      });
    }
  }

  if (tagName === "link") {
    const rels = (attributes.get("rel") || "").toLowerCase().split(/\s+/).filter(Boolean);
    const blockedRel = rels.find((rel) => !ALLOWED_LINK_RELS.has(rel));
    if (!rels.length || blockedRel) {
      sink.error("link-rel", `<link rel="${blockedRel || ""}"> is not allowed.`, {
        fix: "Only stylesheet, icon, and preconnect links are allowed."
      });
    } else if (!/^https:\/\//i.test(attributes.get("href") || "")) {
      sink.error("link-href", "Linked stylesheets and icons must use https URLs.", {
        fix: "Inline the CSS in a <style> block, or host the file (for example with file-upload) and use its https URL."
      });
    }
  }

  if (EMBED_SRC_TAGS.has(tagName)) {
    // srcset candidates are "url descriptor" pairs separated by ", ". Data
    // URLs contain a comma with no space after it, so they stay whole.
    const references: [string, string | undefined][] = [
      ...["src", "poster"].map((name): [string, string | undefined] => [name, attributes.get(name)]),
      ...(attributes.get("srcset") || "")
        .split(/,\s+/)
        .map((candidate): [string, string | undefined] => ["srcset", candidate.trim().split(/\s+/)[0]])
    ];
    for (const [name, value] of references) {
      if (value && isLocalReference(value)) {
        sink.warning("relative-asset", `"${value}" will not load. htmlartifact only hosts HTML pages.`, {
          attr: name,
          fix: "Upload the file (for example with file-upload) and use its https URL, or inline it as a data: URL."
        });
      }
    }
  }

  checkAttributeRules(attrs, sink);

  if (tagName === "meta" && (attributes.get("http-equiv") || "").toLowerCase() === "refresh") {
    sink.error("meta-refresh", "Blocked meta refresh tag.", { fix: "Use a normal link." });
  }

  // Record which hosts a draft pulls images from, for later review.
  if (tagName === "img") {
    const host = externalHost(attributes.get("src"));
    if (host) sink.imageHost(host);
  }

  if (tagName === "title") sink.title();
}

// Attribute checks, separate so parse5's validator can check attributes a
// later <html> or <body> tag merges into the first one.
export function checkAttributeRules(attrs: readonly Attribute[], sink: RuleSink): void {
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    const value = String(attr.value || "").trim();

    // Inline handlers run under the same sandbox as inline scripts, so
    // they are allowed exactly when scripts are.
    if (EVENT_HANDLER_ATTRS.has(name)) sink.handler(attr.name, value);

    if (name === "srcdoc") {
      sink.error("srcdoc", 'Blocked "srcdoc" attribute.', { attr: attr.name, fix: EMBED_FIX });
    }

    if (URL_ATTRS.has(name) && isUnsafeUrl(value)) {
      sink.error("unsafe-url", `Blocked unsafe URL in "${name}" attribute.`, {
        attr: attr.name,
        fix: "Use an https link, or an event listener added from a <script> block."
      });
    }

    if (name === "style" && UNSAFE_CSS.test(value)) {
      sink.error("unsafe-css", "Blocked unsafe inline CSS.", { attr: attr.name });
    }
  }
}

const UNSAFE_CSS = /expression\s*\(|behavior\s*:|url\s*\(\s*javascript:/i;

// `value` is trimmed. Browsers skip ASCII whitespace and control characters
// inside a URL's scheme, so they are stripped before comparing.
function isUnsafeUrl(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return BLOCKED_PROTOCOLS.some((protocol) => normalized.startsWith(protocol));
}

// Collects issues, merging repeats of the same problem into one entry with a
// count and the first location, so 500 identical findings stay readable.
// `order` compares nodes in document order (parse5's validator places
// issues by node); without nodes, issues keep the order they were added.
export function createIssueList<N>(order?: (a: N, b: N) => number, locate?: (node: N) => Location | null) {
  let byKey = new Map<string, { issue: Issue; node?: N | undefined }>();
  function add(level: IssueLevel, code: string, message: string, { node, at, attr, fix }: IssueOptions<N> = {}) {
    const key = `${level}\0${code}\0${message}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.issue.count += 1;
      if (!order || node === undefined || existing.node === undefined || order(node, existing.node) >= 0) return;
    }
    const location: Location | null | undefined = node !== undefined && locate ? locate(node) : at;
    const start = (attr && location?.attrs?.[attr]) || location;
    const issue: Issue = {
      level,
      code,
      message,
      ...(fix ? { fix } : {}),
      ...(start ? { line: start.startLine, column: start.startCol } : {}),
      count: existing ? existing.issue.count : 1
    };
    if (existing) {
      existing.issue = issue;
      existing.node = node;
    } else {
      byKey.set(key, { issue, node });
    }
  }
  return {
    error: (code: string, message: string, options?: IssueOptions<N>) => add("error", code, message, options),
    warning: (code: string, message: string, options?: IssueOptions<N>) => add("warning", code, message, options),
    // Called once the walk ends, when every issue so far has a node.
    sortByDocumentOrder: () => {
      if (!order) return;
      byKey = new Map(
        [...byKey].sort(([, a], [, b]) => (a.node !== undefined && b.node !== undefined ? order(a.node, b.node) : 0))
      );
    },
    // Adds an issue found elsewhere (for example by another pass over the
    // same page) unless the list already has it; then keeps the larger count.
    merge: (issue: Issue) => {
      const key = `${issue.level}\0${issue.code}\0${issue.message}`;
      const existing = byKey.get(key);
      if (existing) existing.issue.count = Math.max(existing.issue.count, issue.count);
      else byKey.set(key, { issue: { ...issue } });
    },
    list: () => [...byKey.values()].map(({ issue }) => issue)
  };
}

export function htmlResult({
  issues,
  title,
  hasScripts,
  bytes,
  externalImageHosts
}: {
  issues: { list(): Issue[] };
  title: string | null;
  hasScripts: boolean;
  bytes: number;
  externalImageHosts: string[];
}): HtmlValidation {
  const list = issues.list();
  return {
    ok: !list.some((issue) => issue.level === "error"),
    errors: list.filter((issue) => issue.level === "error").map(formatIssue),
    warnings: list.filter((issue) => issue.level === "warning").map(formatIssue),
    issues: list,
    title,
    hasScripts,
    bytes,
    stats: { hasInlineScript: hasScripts, externalImageHosts }
  };
}

// The checks before any parsing: an empty page, or one over the size limit.
// Returns null when the page should be parsed.
export function precheckHtml(html: unknown, maxBytes: number): HtmlValidation | null {
  if (typeof html !== "string" || html.trim() === "") {
    const issues = createIssueList();
    issues.error("empty", "HTML document is empty.");
    return htmlResult({ issues, title: null, hasScripts: false, bytes: 0, externalImageHosts: [] });
  }
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > maxBytes) {
    const issues = createIssueList();
    issues.error("too-large", sizeMessage(bytes, maxBytes));
    return htmlResult({ issues, title: null, hasScripts: false, bytes, externalImageHosts: [] });
  }
  return null;
}

export function parseFailed(bytes: number): HtmlValidation {
  const failed = createIssueList();
  failed.error("parse-failed", "HTML document could not be parsed.");
  return htmlResult({ issues: failed, title: null, hasScripts: false, bytes, externalImageHosts: [] });
}

// The document title from the text of a <title>: trimmed, at most 140 characters.
export function titleText(text: string): string | null {
  return text.trim().slice(0, 140) || null;
}

// A page of an oversized upload, sized but never parsed: the upload-wide
// too-large issue already rejects it.
function unparsedPage(bytes: number): HtmlValidation {
  return { ...htmlResult({ issues: createIssueList(), title: null, hasScripts: false, bytes, externalImageHosts: [] }), ok: false };
}

// Validates a whole upload: one page, or a folder of pages that link to each
// other by relative path. Enforces the caller's limits and capabilities, so
// /api/uploads and the /api/check preflight always agree. The page validator
// is parse5's (CLI) or HTMLRewriter's (server); the latter is asynchronous,
// so this is a generator the caller drives (see runUpload, runUploadAsync).
export function* uploadSteps(
  pages: PageInput[] | unknown,
  { maxBytes = Infinity, maxPages = Infinity }: UploadLimits = {}
): Generator<unknown, UploadValidation, HtmlValidation> {
  const issues: Issue[] = [];
  const results: ValidatedPage[] = [];
  const multiPage = Array.isArray(pages) && pages.length > 1;

  if (!Array.isArray(pages) || pages.length === 0) {
    issues.push(uploadIssue("empty", "Upload has no HTML pages."));
    return uploadResult({ issues, pages: results, totalBytes: 0, hasScripts: false });
  }

  if (pages.length > maxPages) {
    issues.push(uploadIssue("too-many-pages", `Upload has ${pages.length} pages; the limit is ${maxPages}.`));
  }

  // Size the upload before parsing anything: an oversized upload is rejected
  // without spending CPU and memory on pages that cannot be published.
  const entries: ({ pathIssue: Issue } | { path: string; html: unknown; bytes: number })[] = [];
  const seen = new Set<string>();
  for (const page of pages as PageInput[]) {
    const path = page?.path;
    const pathProblem = pagePathProblem(path);
    if (pathProblem || typeof path !== "string") {
      entries.push({ pathIssue: uploadIssue("page-path", pathProblem ?? "Page path is missing.") });
      continue;
    }
    if (seen.has(path)) {
      entries.push({ pathIssue: uploadIssue("page-path", `Page path "${path}" appears twice.`) });
      continue;
    }
    seen.add(path);
    const html = page.html;
    entries.push({ path, html, bytes: typeof html === "string" && html.trim() !== "" ? Buffer.byteLength(html, "utf8") : 0 });
  }
  const totalBytes = entries.reduce((sum, entry) => sum + ("bytes" in entry ? entry.bytes : 0), 0);
  const tooLarge = totalBytes > maxBytes;

  for (const entry of entries) {
    if ("pathIssue" in entry) {
      issues.push(entry.pathIssue);
      continue;
    }
    const { path, html, bytes } = entry;
    const validation: HtmlValidation = tooLarge && bytes > 0 ? unparsedPage(bytes) : yield html;
    results.push({ path, html: html as string, ...validation });
    issues.push(...validation.issues.map((issue) => (multiPage ? { path, ...issue } : issue)));
  }

  if (!seen.has("index.html")) {
    issues.push(uploadIssue("missing-index", "Uploads need an index.html page."));
  }

  if (tooLarge) {
    issues.push(
      uploadIssue("too-large", sizeMessage(totalBytes, maxBytes), {
        fix: "The limit is for the whole upload, every page counted. Publish it as several artifacts that link to each other, or move large inline images or data out to https URLs. Do not drop requested content."
      })
    );
  }

  const hasScripts = results.some((page) => page.hasScripts);

  return uploadResult({ issues, pages: results, totalBytes, hasScripts });
}

export function runUpload(
  steps: Generator<unknown, UploadValidation, HtmlValidation>,
  validatePage: (html: unknown) => HtmlValidation
): UploadValidation {
  let step = steps.next(undefined as unknown as HtmlValidation);
  while (!step.done) step = steps.next(validatePage(step.value));
  return step.value;
}

export async function runUploadAsync(
  steps: Generator<unknown, UploadValidation, HtmlValidation>,
  validatePage: (html: unknown) => Promise<HtmlValidation>
): Promise<UploadValidation> {
  let step = steps.next(undefined as unknown as HtmlValidation);
  while (!step.done) step = steps.next(await validatePage(step.value));
  return step.value;
}

// The single-line form of an issue, used for human output and for the
// `errors`/`warnings` string arrays older CLIs print.
export function formatIssue(issue: Issue): string {
  const location = issue.line ? `line ${issue.line}:${issue.column}` : null;
  const where = [issue.path, location].filter(Boolean).join(" ");
  const count = issue.count > 1 ? ` (${issue.count} places)` : "";
  const fix = issue.fix ? ` Fix: ${issue.fix}` : "";
  return `${where ? `${where}: ` : ""}${issue.message}${count}${fix}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${+(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${+(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

function pagePathProblem(path: unknown): string | null {
  if (typeof path !== "string" || !path) return "Page path is missing.";
  const segments = path.split("/");
  if (path.length > MAX_PAGE_PATH_LENGTH || segments.length > MAX_PAGE_PATH_SEGMENTS) {
    return `Page path "${path}" is too long.`;
  }
  if (!path.endsWith(".html") || !segments.every((segment) => PAGE_SEGMENT_PATTERN.test(segment))) {
    return `Page path "${path}" must be a relative .html path of letters, numbers, ".", "_", and "-".`;
  }
  const root = segments[0]!.replace(/\.html$/, "");
  if (RESERVED_PAGE_ROOTS.has(root.toLowerCase())) {
    return `Page path "${path}" uses the reserved name "${root}".`;
  }
  return null;
}

function sizeMessage(bytes: number, maxBytes: number): string {
  return `HTML is ${bytes} bytes, ${bytes - maxBytes} ${bytes - maxBytes === 1 ? "byte" : "bytes"} over the ${formatBytes(maxBytes)} (${maxBytes}-byte) limit for this upload.`;
}

function uploadIssue(code: string, message: string, { fix }: { fix?: string } = {}): Issue {
  return { level: "error", code, message, ...(fix ? { fix } : {}), count: 1 };
}

function uploadResult({
  issues,
  pages,
  totalBytes,
  hasScripts
}: {
  issues: Issue[];
  pages: ValidatedPage[];
  totalBytes: number;
  hasScripts: boolean;
}): UploadValidation {
  const index = pages.find((page) => page.path === "index.html") || pages[0];
  const ok = !issues.some((issue) => issue.level === "error");
  return {
    ok,
    errors: issues.filter((issue) => issue.level === "error").map(formatIssue),
    warnings: issues.filter((issue) => issue.level === "warning").map(formatIssue),
    issues,
    pages,
    totalBytes,
    hasScripts,
    title: index?.title ?? null,
    // Only valid uploads are stored, and invalid pages may have no HTML to hash.
    contentHash: ok ? uploadContentHash(pages) : null
  };
}

// One page hashes its bytes, so the value matches versions stored before
// multi-page uploads. A folder hashes its sorted path/hash manifest.
function uploadContentHash(pages: ValidatedPage[]): string {
  if (pages.length === 1) return sha256(pages[0]!.html);
  const manifest = pages
    .map((page) => `${page.path}\0${sha256(page.html)}`)
    .sort()
    .join("\n");
  return sha256(manifest);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// True for paths that point at the author's machine or the draft's own host,
// where htmlartifact serves nothing but HTML pages.
function isLocalReference(value: unknown): boolean {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw.startsWith("#")) return false;
  return !/^(https?:|data:|blob:|\/\/)/.test(raw);
}

// Returns the lowercased host of an absolute http(s) (or protocol-relative) URL,
// or null for relative paths, data: URIs, and anything unparseable.
function externalHost(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname.toLowerCase();
    }
  } catch {
    // relative path, data: URI, etc. — not an external host
  }
  return null;
}
