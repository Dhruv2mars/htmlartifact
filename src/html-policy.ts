import {
  ErrorCodes,
  html as spec,
  Parser,
  Tokenizer,
  type ParserOptions,
  type Token,
  type TreeAdapter,
  type TreeAdapterTypeMap
} from "parse5";
import {
  checkAttributeRules,
  checkElementRules,
  createIssueList,
  htmlResult,
  NO_TITLE_MESSAGE,
  parseFailed,
  precheckHtml,
  runUpload,
  SANDBOX_APIS,
  titleText,
  uploadSteps,
  type HtmlValidation,
  type Location,
  type PageInput,
  type Position,
  type RuleSink,
  type UploadLimits,
  type UploadValidation
} from "./html-policy-rules.ts";

// The parse5 validator: the CLI's local check, and the reference the
// server's HTMLRewriter validator (src/html-policy-server.ts) is tested
// against. It applies the policy in src/html-policy-rules.ts to the tree
// parse5's tree builder builds, so every issue carries its line and column.
export {
  formatBytes,
  formatIssue,
  type HtmlValidation,
  type Issue,
  type IssueLevel,
  type PageInput,
  type UploadLimits,
  type UploadValidation,
  type ValidatedPage
} from "./html-policy-rules.ts";

// One node as the validator sees it while parse5 builds the document. Nodes
// point at their parent (the tree builder asks for it when foster-parenting)
// but never at their children, so an element is garbage as soon as the parser
// closes it: memory follows nesting depth, not page size.
interface WalkNode {
  tagName: string; // "" for the document, fragments, and comments
  namespaceURI: spec.NS;
  attrs: Token.Attribute[];
  parent: WalkNode | null;
  host: WalkNode | null; // a template content fragment's <template>
  depth: number; // the document is 0
  seq: number; // order of first placement
  index: number; // position among its siblings (see attach)
  childCount: number;
  insertedBefore: number;
  attached: boolean; // in the document or a template's content
  pending: WalkNode[] | null; // children added before this node was attached
  inert: boolean; // <template> content (not a shadow root): inert, never checked
  shadow: boolean; // in a declarative shadow root, outside the document tree
  visited: boolean;
  location: Token.ElementLocation | null;
  sinks: TextSink[] | null; // <script>/<title> ancestors collecting their text
  content: WalkNode | null; // a <template>'s content fragment
  attrNames: Set<string> | null; // names in attrs, once attributes are merged in
  mode: spec.DOCUMENT_MODE;
}

interface TextSink {
  text: string;
  title?: WalkNode; // set on a <title>'s sink
}

type WalkMap = TreeAdapterTypeMap<
  WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode, WalkNode
>;

// Far above any real document (browsers themselves flatten around 512), but
// well below where a recursive parse5 serializer would overflow the call
// stack (~2000+ levels).
const MAX_DEPTH = 512;

// Far above any real element. Bounds the tokenizer's duplicate-attribute
// checks and the attribute merging of repeated <html>/<body> tags.
const MAX_ATTRIBUTES = 1000;

// Thrown to stop parsing a page that already fails: parse5 keeps every open
// element and its scope checks walk that stack, so a page nested thousands
// deep costs quadratic CPU and memory if parsing went on.
class TooDeep extends Error {}
class TooManyAttributes extends Error {
  at: Position | null;
  constructor(at: Position | null) {
    super("too many attributes");
    this.at = at;
  }
}

// parse5's tokenizer drops duplicate attributes with a linear scan of the
// tag's attributes per attribute, quadratic in attributes per tag. This keeps
// a set of the names per tag instead and caps their number. It overrides a
// protected method of parse5's tokenizer, so package.json pins parse5's exact
// version and the tests fail loudly if the override stops taking effect.
class LimitedTokenizer extends Tokenizer {
  private namesOf: Token.TagToken | null = null;
  private names = new Set<string>();

  protected override _leaveAttrName(): void {
    const token = this.currentToken as Token.TagToken;
    if (token !== this.namesOf) {
      this.namesOf = token;
      this.names = new Set(token.attrs.map((attr) => attr.name));
    }
    const name = this.currentAttr.name;
    if (this.names.has(name)) {
      this._err(ErrorCodes.duplicateAttribute);
      return;
    }
    if (token.attrs.length >= MAX_ATTRIBUTES) throw new TooManyAttributes(token.location);
    this.names.add(name);
    token.attrs.push(this.currentAttr);
    if (token.location && this.currentLocation) {
      (token.location.attrs ??= Object.create(null) as Record<string, Token.Location>)[name] = this.currentLocation;
      this._leaveAttrValue();
    }
  }
}
if (typeof (Tokenizer.prototype as unknown as Record<string, unknown>)._leaveAttrName !== "function") {
  throw new Error("parse5's Tokenizer no longer has _leaveAttrName; update LimitedTokenizer.");
}

class LimitedParser extends Parser<WalkMap> {
  constructor(options: ParserOptions<WalkMap>) {
    super(options);
    this.tokenizer = new LimitedTokenizer(this.options, this);
  }
}

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
  // Source locations only matter for reporting issues, and tracking them costs
  // CPU (Workers Free allows 10 ms per request). Clean pages, the common case,
  // pass without them; a page with anything to report is parsed again with
  // them, so every issue still carries its line and column.
  const quick = validateHtmlPass(html, options, false);
  return quick.issues.length === 0 ? quick : validateHtmlPass(html, options, true);
}

function validateHtmlPass(html: unknown, options: { maxBytes?: number }, locations: boolean): HtmlValidation {
  const maxBytes = options.maxBytes ?? Infinity;
  // Until the tree builder places a node anywhere but the end of the
  // document, insertion order is document order and a counter compares
  // nodes; after that, their positions in the tree do.
  let inOrder = true;
  let placed = 0;
  const order = (a: WalkNode, b: WalkNode) => (inOrder ? a.seq - b.seq : documentOrder(a, b));
  const issues = createIssueList<WalkNode>(order, (node) => node.location as Location | null);

  const early = precheckHtml(html, maxBytes);
  if (early) return early;
  const source = html as string;
  const bytes = Buffer.byteLength(source, "utf8");

  let hasScripts = false;
  let tooDeep = false;
  let tooManyAttributes: TooManyAttributes | null = null;
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

  // The policy's findings for `node`, placed at it.
  function sinkFor(node: WalkNode): RuleSink {
    return {
      error: (code, message, options) => issues.error(code, message, { node, ...options }),
      warning: (code, message, options) => issues.warning(code, message, { node, ...options }),
      executableScript: () => {
        hasScripts = true;
        const sink = { text: "" };
        scripts.push({ node, sink });
        collectInto(node, sink);
      },
      handler: (attr, value) => {
        hasScripts = true;
        for (const api of SANDBOX_APIS) {
          const match = handlerMatches.get(api.code);
          if ((!match || order(node, match.node) < 0) && api.pattern.test(value)) {
            handlerMatches.set(api.code, { node, attr });
          }
        }
      },
      title: () => {
        // A <title> in a shadow root does not name the document.
        if (node.shadow || (firstTitleWithText && order(firstTitleWithText, node) < 0)) return;
        const sink = { text: "", title: node };
        titles.push({ node, sink });
        collectInto(node, sink);
      },
      imageHost: (host) => externalImageHosts.add(host)
    };
  }

  function checkElement(node: WalkNode) {
    checkElementRules(node.tagName, node.attrs, sinkFor(node));
  }

  // Attributes a later <html> or <body> tag merges into the first one.
  function checkAttributes(node: WalkNode, attrs: Token.Attribute[]) {
    checkAttributeRules(attrs, sinkFor(node));
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
      child.shadow = parent.shadow;
      child.sinks = parent.sinks;
    }
    // Depth counts through template content, inert or not: the parser
    // keeps those open elements too.
    child.depth = parent.depth + 1;
    if (child.depth >= MAX_DEPTH) tooDeep = true;
    if (child.depth > MAX_DEPTH) throw new TooDeep();
    // Each element is checked once, where it is first placed.
    if (!child.inert && child.tagName && !child.visited) {
      child.visited = true;
      checkElement(child);
    }
    // A <template shadowrootmode> is a declarative shadow root: browsers
    // render its content, so it is checked like the rest of the page.
    const content = child.content;
    if (content) {
      content.host = child;
      content.depth = child.depth;
      content.inert = child.inert || !isShadowRoot(child);
      content.shadow = child.shadow || !content.inert;
    }
    const pending = child.pending;
    child.pending = null;
    for (const node of pending ?? []) {
      if (node.parent === child) place(node);
    }
  }

  function addText(parent: WalkNode, text: string) {
    if (parent.depth + 1 >= MAX_DEPTH) tooDeep = true;
    if (parent.inert || !parent.sinks) return;
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
    LimitedParser.parse(source, { scriptingEnabled: false, sourceCodeLocationInfo: locations, treeAdapter: adapter });
  } catch (error) {
    // A page past a limit stops parsing at the first element over it. Issues
    // later in the page go unreported; the page fails anyway.
    if (error instanceof TooDeep) tooDeep = true;
    else if (error instanceof TooManyAttributes) tooManyAttributes = error;
    else return parseFailed(bytes);
  }

  // Elements were checked in insertion order; report in document order.
  issues.sortByDocumentOrder();

  if (tooDeep) {
    issues.error("too-deep", `HTML is nested more than ${MAX_DEPTH} levels deep.`);
  }

  if (tooManyAttributes) {
    issues.error("too-many-attributes", `An element has more than ${MAX_ATTRIBUTES} attributes.`, {
      at: tooManyAttributes.at,
      fix: 'Use fewer attributes; put data in a <script type="application/json"> block instead.'
    });
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

  const first = titles.filter(({ sink }) => /\S/.test(sink.text)).sort((a, b) => order(a.node, b.node))[0];
  const title = first ? titleText(first.sink.text) : null;
  if (!title) issues.warning("no-title", NO_TITLE_MESSAGE);

  return htmlResult({
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
    host: null,
    depth: 0,
    seq: 0,
    index: 0,
    childCount: 0,
    insertedBefore: 0,
    attached: root,
    pending: null,
    inert: false,
    shadow: false,
    visited: false,
    location: null,
    sinks: null,
    content: null,
    attrNames: null,
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
      // Settled when the template is placed (see place).
      content.inert = !isShadowRoot(template);
      content.shadow = !content.inert;
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
      // The name set persists, so each repeated <body> tag costs only its own
      // attributes.
      const present = (recipient.attrNames ??= new Set(recipient.attrs.map((attr) => attr.name)));
      const added = attrs.filter((attr) => !present.has(attr.name));
      if (recipient.attrs.length + added.length > MAX_ATTRIBUTES) {
        throw new TooManyAttributes(recipient.location);
      }
      for (const attr of added) present.add(attr.name);
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

export function validateUpload(pages: PageInput[] | unknown, limits: UploadLimits = {}): UploadValidation {
  return runUpload(uploadSteps(pages, limits), (html) => validateHtml(html));
}

// Negative when `a` comes before `b` in document (tree pre-order) order.
function documentOrder(a: WalkNode, b: WalkNode): number {
  if (a === b) return 0;
  const pathA: WalkNode[] = [];
  const pathB: WalkNode[] = [];
  for (let node: WalkNode | null = a; node; node = node.parent ?? node.host) pathA.push(node);
  for (let node: WalkNode | null = b; node; node = node.parent ?? node.host) pathB.push(node);
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

// A <template> with a declarative shadow root attribute. Current browsers
// read shadowrootmode; older Chrome read shadowroot.
function isShadowRoot(template: WalkNode): boolean {
  return template.attrs.some((attr) => attr.name === "shadowrootmode" || attr.name === "shadowroot");
}
