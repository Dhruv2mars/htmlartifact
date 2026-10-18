import { createHash } from "node:crypto";
import { html as spec, parse, type Token, type TreeAdapter, type TreeAdapterTypeMap } from "parse5";

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

export interface ValidatedPage extends HtmlValidation {
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

// One node as the validator sees it while parse5 builds the document. Nodes
// point at their parent (the tree builder asks for it when foster-parenting)
// but never at their children, so an element is garbage as soon as the parser
// closes it: memory follows nesting depth, not page size.
interface WalkNode {
  tagName: string; // "" for the document, fragments, and comments
  namespaceURI: spec.NS;
  attrs: Token.Attribute[];
  parent: WalkNode | null;
  depth: number; // the document is 0
  seq: number; // order of first placement
  index: number; // position among its siblings (see attach)
  childCount: number;
  insertedBefore: number;
  attached: boolean; // in the document or a template's content
  pending: WalkNode[] | null; // children added before this node was attached
  inert: boolean; // <template> content: inert, and never checked
  visited: boolean;
  location: Token.ElementLocation | null;
  sinks: TextSink[] | null; // <script>/<title> ancestors collecting their text
  content: WalkNode | null; // a <template>'s content fragment
  mode: spec.DOCUMENT_MODE;
}

interface TextSink {
  text: string;
  title?: WalkNode; // set on a <title>'s sink
}

type WalkMap = TreeAdapterTypeMap<
  WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode
>;

interface Position {
  startLine: number;
  startCol: number;
}

interface Location extends Position {
  attrs?: Record<string, Position>;
}

interface IssueOptions {
  node?: WalkNode;
  attr?: string;
  fix?: string;
}

const EMBED_FIX = "Link to the page instead of embedding it.";
const BLOCKED_TAGS = new Map<string, string>([
  ["form", "Forms cannot submit on htmlartifact. Use inputs without a <form> wrapper."],
  ["iframe", EMBED_FIX],
  ["object", EMBED_FIX],
  ["embed", EMBED_FIX],
  ["applet", EMBED_FIX]
]);

const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "srcdoc",
  "xlink:href"
]);

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
const EVENT_HANDLER_ATTRS = new Set(
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
const SANDBOX_APIS: { code: string; pattern: RegExp; message: string; fix: string }[] = [
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

// Far above any real document (browsers themselves flatten around 512), but
// well below where a recursive parse5 serializer would overflow the call
// stack (~2000+ levels).
const MAX_DEPTH = 512;

// Validates one HTML document. Returns string errors/warnings for display and
// structured `issues` ({ level, code, message, fix, line, column, count }) for
// tools. `hasScripts` means the page contains code the browser would run.
//
// Memory stays flat in page size: parse5's tree builder runs with a tree
// adapter that checks each element as it is inserted and keeps no child
// lists, so nothing but the open elements outlives its closing tag. (A full
// parse5 tree costs ~57 MB of heap per MB of dense markup, far past a
// Worker's 128 MB.) The tree builder still decides every placement exactly
// as before: implied, foster-parented, ignored, and merged tags, <template>
// content, and <noscript> with scripting off.
export function validateHtml(html: unknown, options: { maxBytes?: number } = {}): HtmlValidation {
  const maxBytes = options.maxBytes ?? Infinity;
  // Until the tree builder places a node anywhere but the end of the
  // document, insertion order is document order and a counter compares
  // nodes; after that, their positions in the tree do.
  let inOrder = true;
  let placed = 0;
  const order = (a: WalkNode, b: WalkNode) => (inOrder ? a.seq - b.seq : documentOrder(a, b));
  const issues = createIssueList(order);

  if (typeof html !== "string" || html.trim() === "") {
    issues.error("empty", "HTML document is empty.");
    return result({ issues, title: null, hasScripts: false, bytes: 0, externalImageHosts: [] });
  }

  // Too-large pages are rejected before any parsing.
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > maxBytes) {
    issues.error("too-large", sizeMessage(bytes, maxBytes));
    return result({ issues, title: null, hasScripts: false, bytes, externalImageHosts: [] });
  }

  let hasScripts = false;
  let tooDeep = false;
  const externalImageHosts = new Set<string>();
  // The first <title> in document order with text names the page. Titles
  // after one that already has text cannot win, so they are not collected.
  const titles: { node: WalkNode; sink: TextSink }[] = [];
  let firstTitleWithText: WalkNode | null = null;
  // Code the sandbox checks read. Scripts keep a sink their text streams
  // into; handler attributes are complete when seen, so only the first match
  // per API (in document order) is kept.
  const scripts: { node: WalkNode; sink: TextSink }[] = [];
  const handlerMatches = new Map<string, { node: WalkNode; attr: string }>();

  function checkElement(node: WalkNode) {
    const tagName = node.tagName.toLowerCase();
    const attributes = new Map(node.attrs.map((attr) => [attr.name.toLowerCase(), String(attr.value || "").trim()]));

    if (BLOCKED_TAGS.has(tagName)) {
      issues.error("blocked-tag", `Blocked <${tagName}> tag.`, {
        node,
        fix: BLOCKED_TAGS.get(tagName)
      });
    }

    if (tagName === "script") {
      if (attributes.has("src")) {
        issues.error("external-script", "External script sources are not allowed.", {
          node,
          fix: "Inline the code in a <script> block."
        });
      }

      const scriptType = (attributes.get("type") || "").toLowerCase();
      if (EXECUTABLE_SCRIPT_TYPES.has(scriptType)) {
        hasScripts = true;
        const sink = { text: "" };
        scripts.push({ node, sink });
        collectInto(node, sink);
      } else if (!DATA_SCRIPT_TYPES.has(scriptType)) {
        issues.error("script-type", `Unsupported script type "${scriptType}".`, {
          node,
          fix: 'Use a classic or type="module" inline script, or type="application/json" for data.'
        });
      }
    }

    if (tagName === "link") {
      const rels = (attributes.get("rel") || "").toLowerCase().split(/\s+/).filter(Boolean);
      const blockedRel = rels.find((rel) => !ALLOWED_LINK_RELS.has(rel));
      if (!rels.length || blockedRel) {
        issues.error("link-rel", `<link rel="${blockedRel || ""}"> is not allowed.`, {
          node,
          fix: "Only stylesheet, icon, and preconnect links are allowed."
        });
      } else if (!/^https:\/\//i.test(attributes.get("href") || "")) {
        issues.error("link-href", "Linked stylesheets and icons must use https URLs.", {
          node,
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
          issues.warning("relative-asset", `"${value}" will not load. htmlartifact only hosts HTML pages.`, {
            node,
            attr: name,
            fix: "Upload the file (for example with file-upload) and use its https URL, or inline it as a data: URL."
          });
        }
      }
    }

    checkAttributes(node, node.attrs);

    if (tagName === "meta" && (attributes.get("http-equiv") || "").toLowerCase() === "refresh") {
      issues.error("meta-refresh", "Blocked meta refresh tag.", { node, fix: "Use a normal link." });
    }

    // Record which hosts a draft pulls images from, for later review.
    if (tagName === "img") {
      const host = externalHost(attributes.get("src"));
      if (host) externalImageHosts.add(host);
    }

    if (tagName === "title" && !(firstTitleWithText && order(firstTitleWithText, node) < 0)) {
      const sink = { text: "", title: node };
      titles.push({ node, sink });
      collectInto(node, sink);
    }
  }

  // Attribute checks, separate so attributes a later <html> or <body> tag
  // merges into the first one are checked too.
  function checkAttributes(node: WalkNode, attrs: Token.Attribute[]) {
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || "").trim();

      // Inline handlers run under the same sandbox as inline scripts, so
      // they are allowed exactly when scripts are.
      if (EVENT_HANDLER_ATTRS.has(name)) {
        hasScripts = true;
        for (const api of SANDBOX_APIS) {
          const match = handlerMatches.get(api.code);
          if ((!match || order(node, match.node) < 0) && api.pattern.test(value)) {
            handlerMatches.set(api.code, { node, attr: attr.name });
          }
        }
      }

      if (name === "srcdoc") {
        issues.error("srcdoc", 'Blocked "srcdoc" attribute.', { node, attr: attr.name, fix: EMBED_FIX });
      }

      if (URL_ATTRS.has(name)) {
        const normalized = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        if (BLOCKED_PROTOCOLS.some((protocol) => normalized.startsWith(protocol))) {
          issues.error("unsafe-url", `Blocked unsafe URL in "${name}" attribute.`, {
            node,
            attr: attr.name,
            fix: "Use an https link, or an event listener added from a <script> block."
          });
        }
      }

      if (name === "style" && /expression\s*\(|behavior\s*:|url\s*\(\s*javascript:/i.test(value)) {
        issues.error("unsafe-css", "Blocked unsafe inline CSS.", { node, attr: attr.name });
      }
    }
  }

  // Text inside the node, at any depth, also goes to this sink.
  function collectInto(node: WalkNode, sink: TextSink) {
    node.sinks = node.sinks ? [...node.sinks, sink] : [sink];
  }

  function attach(parent: WalkNode, child: WalkNode, before: WalkNode | null) {
    child.parent = parent;
    // Sibling order, for document-order comparisons: appended children count
    // up; children inserted before a sibling (foster parenting) fill the gap
    // below it in insertion order.
    child.index = before ? before.index - 1 / (before.insertedBefore++ + 2) : parent.childCount++;
    // Misnested formatting tags make the tree builder assemble clones off
    // the tree before inserting them; their children wait for them.
    if (before || !parent.attached || child.attached) inOrder = false;
    if (parent.attached) place(child);
    else (parent.pending ??= []).push(child);
  }

  function place(child: WalkNode) {
    const parent = child.parent!;
    // A moved node keeps what it inherited: the tree builder never moves
    // nodes into or out of <template> content or a <script>/<title>.
    if (!child.attached) {
      child.attached = true;
      child.seq = placed++;
      child.inert = parent.inert;
      child.sinks = parent.sinks;
    }
    if (!child.inert) {
      child.depth = parent.depth + 1;
      if (child.depth >= MAX_DEPTH) tooDeep = true;
      // Each element is checked once, where it is first placed. Elements
      // below MAX_DEPTH are not checked: the page already fails as too deep.
      if (child.tagName && !child.visited && child.depth <= MAX_DEPTH) {
        child.visited = true;
        checkElement(child);
      }
    }
    const pending = child.pending;
    child.pending = null;
    for (const node of pending ?? []) {
      if (node.parent === child) place(node);
    }
  }

  function addText(parent: WalkNode, text: string) {
    if (parent.inert) return;
    if (parent.depth + 1 >= MAX_DEPTH) tooDeep = true;
    if (!parent.sinks) return;
    for (const sink of parent.sinks) {
      sink.text += text;
      if (sink.title && /\S/.test(text) && !(firstTitleWithText && order(firstTitleWithText, sink.title) <= 0)) {
        firstTitleWithText = sink.title;
      }
    }
  }

  function adoptAttributes(node: WalkNode, attrs: Token.Attribute[]) {
    inOrder = false;
    checkAttributes(node, attrs);
  }

  const adapter = walkAdapter({ attach, addText, adoptAttributes });
  try {
    // scriptingEnabled: false so <noscript> children parse as real elements:
    // a reader without JavaScript sees them, so the policy must see them too.
    parse(html, { scriptingEnabled: false, sourceCodeLocationInfo: true, treeAdapter: adapter });
  } catch {
    const failed = createIssueList();
    failed.error("parse-failed", "HTML document could not be parsed.");
    return result({ issues: failed, title: null, hasScripts: false, bytes, externalImageHosts: [] });
  }

  // Elements were checked in insertion order; report in document order.
  issues.sortByDocumentOrder();

  if (tooDeep) {
    issues.error("too-deep", `HTML is nested more than ${MAX_DEPTH} levels deep.`);
  }

  for (const api of SANDBOX_APIS) {
    let source: { node: WalkNode; attr?: string } | undefined = handlerMatches.get(api.code);
    for (const script of scripts) {
      // A script ties with a handler on its own element and comes first.
      if (source && order(script.node, source.node) > 0) continue;
      if (api.pattern.test(script.sink.text)) source = { node: script.node };
    }
    if (source) {
      issues.warning(api.code, api.message, { node: source.node, attr: source.attr, fix: api.fix });
    }
  }

  const title =
    titles
      .filter(({ sink }) => /\S/.test(sink.text))
      .sort((a, b) => order(a.node, b.node))[0]
      ?.sink.text.trim()
      .slice(0, 140) || null;
  if (!title) {
    issues.warning("no-title", "No <title> found; htmlartifact will use a generic title.");
  }

  return result({
    issues,
    title,
    hasScripts,
    bytes,
    externalImageHosts: [...externalImageHosts].sort()
  });
}

// A parse5 tree adapter that builds no tree: it reports each insertion to the
// validator and keeps only what the tree builder itself reads back (tag
// names, namespaces, attributes, parents, template content, document mode).
// Child lists stay empty; the builder only reads them to move or annotate
// nodes the validator has already checked.
function walkAdapter(hooks: {
  attach: (parent: WalkNode, child: WalkNode, before: WalkNode | null) => void;
  addText: (parent: WalkNode, text: string) => void;
  adoptAttributes: (node: WalkNode, attrs: Token.Attribute[]) => void;
}): TreeAdapter<WalkMap> {
  const node = (tagName: string, namespaceURI: spec.NS, attrs: Token.Attribute[], root = false): WalkNode => ({
    tagName,
    namespaceURI,
    attrs,
    parent: null,
    depth: 0,
    seq: 0,
    index: 0,
    childCount: 0,
    insertedBefore: 0,
    attached: root,
    pending: null,
    inert: false,
    visited: false,
    location: null,
    sinks: null,
    content: null,
    mode: spec.DOCUMENT_MODE.NO_QUIRKS
  });
  const none: WalkNode[] = [];
  return {
    createDocument: () => node("", spec.NS.HTML, [], true),
    createDocumentFragment: () => node("", spec.NS.HTML, [], true),
    createElement: (tagName, namespaceURI, attrs) => node(tagName, namespaceURI, attrs),
    createCommentNode: () => node("", spec.NS.HTML, []),
    createTextNode: () => node("", spec.NS.HTML, []),
    appendChild: (parent, child) => hooks.attach(parent, child, null),
    insertBefore: (parent, child, before) => hooks.attach(parent, child, before),
    setTemplateContent: (template, content) => {
      content.inert = true;
      template.content = content;
    },
    getTemplateContent: (template) => template.content!,
    setDocumentType: () => {},
    setDocumentMode: (document, mode) => {
      document.mode = mode;
    },
    getDocumentMode: (document) => document.mode,
    detachNode: (child) => {
      child.parent = null;
    },
    insertText: (parent, text) => hooks.addText(parent, text),
    insertTextBefore: (parent, text) => hooks.addText(parent, text),
    adoptAttributes: (recipient, attrs) => {
      const present = new Set(recipient.attrs.map((attr) => attr.name));
      const added = attrs.filter((attr) => !present.has(attr.name));
      recipient.attrs.push(...added);
      if (recipient.visited) hooks.adoptAttributes(recipient, added);
    },
    getFirstChild: () => null,
    getChildNodes: () => none,
    getParentNode: (child) => child.parent,
    getAttrList: (element) => element.attrs,
    getTagName: (element) => element.tagName,
    getNamespaceURI: (element) => element.namespaceURI,
    getTextNodeContent: () => "",
    getCommentNodeContent: () => "",
    getDocumentTypeNodeName: () => "",
    getDocumentTypeNodePublicId: () => "",
    getDocumentTypeNodeSystemId: () => "",
    isTextNode: (value): value is WalkNode => false,
    isCommentNode: (value): value is WalkNode => false,
    isDocumentTypeNode: (value): value is WalkNode => false,
    isElementNode: (value): value is WalkNode => Boolean(value.tagName),
    setNodeSourceCodeLocation: (target, location) => {
      // The builder also annotates text nodes it looks up in the (empty)
      // child list, so `target` can be undefined.
      if (target) target.location = location;
    },
    getNodeSourceCodeLocation: (target) => target?.location ?? undefined,
    // End positions are never reported.
    updateNodeSourceCodeLocation: () => {}
  };
}

// Validates a whole upload: one page, or a folder of pages that link to each
// other by relative path. Enforces the caller's limits and capabilities, so
// /api/uploads and the /api/check preflight always agree.
export function validateUpload(
  pages: PageInput[] | unknown,
  { maxBytes = Infinity, maxPages = Infinity }: UploadLimits = {}
): UploadValidation {
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
    const validation = tooLarge && bytes > 0 ? unparsedPage(bytes) : validateHtml(html);
    results.push({ path, html: html as string, ...validation });
    issues.push(...validation.issues.map((issue) => (multiPage ? { path, ...issue } : issue)));
  }

  if (!seen.has("index.html")) {
    issues.push(uploadIssue("missing-index", "Uploads need an index.html page."));
  }

  if (tooLarge) {
    issues.push(
      uploadIssue("too-large", sizeMessage(totalBytes, maxBytes), {
        fix: "Split the report into linked pages, or ask an admin for the large-uploads flag. Do not drop requested content."
      })
    );
  }

  const hasScripts = results.some((page) => page.hasScripts);

  return uploadResult({ issues, pages: results, totalBytes, hasScripts });
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
  return `HTML is ${bytes} bytes (${formatBytes(bytes)}); the limit for this upload is ${maxBytes} bytes (${formatBytes(maxBytes)}).`;
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

// Collects issues, merging repeats of the same problem into one entry with a
// count and the first location, so 500 identical findings stay readable.
// Elements arrive in the order the parser inserts them, which is document
// order except where the tree builder places content earlier (foster
// parenting) or merges attributes into an earlier tag; the first location in
// document order wins.
function createIssueList(order: (a: WalkNode, b: WalkNode) => number = documentOrder) {
  let byKey = new Map<string, { issue: Issue; node?: WalkNode }>();
  function add(level: IssueLevel, code: string, message: string, { node, attr, fix }: IssueOptions = {}) {
    const key = `${level}\0${code}\0${message}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.issue.count += 1;
      if (!node || !existing.node || order(node, existing.node) >= 0) return;
    }
    const location: Location | null | undefined = node?.location;
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
    error: (code: string, message: string, options?: IssueOptions) => add("error", code, message, options),
    warning: (code: string, message: string, options?: IssueOptions) => add("warning", code, message, options),
    // Called once the walk ends, when every issue so far has a node.
    sortByDocumentOrder: () => {
      byKey = new Map(
        [...byKey].sort(([, a], [, b]) => (a.node && b.node ? order(a.node, b.node) : 0))
      );
    },
    list: () => [...byKey.values()].map(({ issue }) => issue)
  };
}

// Negative when `a` comes before `b` in document (tree pre-order) order.
function documentOrder(a: WalkNode, b: WalkNode): number {
  if (a === b) return 0;
  const pathA: WalkNode[] = [];
  const pathB: WalkNode[] = [];
  for (let node: WalkNode | null = a; node; node = node.parent) pathA.push(node);
  for (let node: WalkNode | null = b; node; node = node.parent) pathB.push(node);
  let i = pathA.length - 1;
  let j = pathB.length - 1;
  while (i >= 0 && j >= 0 && pathA[i] === pathB[j]) {
    i--;
    j--;
  }
  if (i < 0) return -1; // a is an ancestor of b
  if (j < 0) return 1;
  return pathA[i]!.index - pathB[j]!.index;
}

function result({
  issues,
  title,
  hasScripts,
  bytes,
  externalImageHosts
}: {
  issues: ReturnType<typeof createIssueList>;
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

// A page of an oversized upload, sized but never parsed: the upload-wide
// too-large issue already rejects it.
function unparsedPage(bytes: number): HtmlValidation {
  return { ...result({ issues: createIssueList(), title: null, hasScripts: false, bytes, externalImageHosts: [] }), ok: false };
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
