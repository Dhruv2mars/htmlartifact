import { decodeHTML, decodeHTMLAttribute } from "entities/decode";
import {
  checkElementRules,
  createIssueList,
  EVENT_HANDLER_ATTRS,
  htmlResult,
  NO_TITLE_MESSAGE,
  precheckHtml,
  runUploadAsync,
  SANDBOX_APIS,
  titleText,
  uploadSteps,
  type Attribute,
  type HtmlValidation,
  type Issue,
  type PageInput,
  type RuleSink,
  type UploadLimits,
  type UploadValidation
} from "./html-policy-rules.ts";

// The server's validator: the policy in src/html-policy-rules.ts applied to
// the token stream of the Workers runtime's native HTMLRewriter (lol-html).
// It only reads: the HTML stored and served is the uploaded string, byte for
// byte; the rewriter's output (with markers, below) is read and dropped.
//
// Why not parse5 here: Workers Free allows 10 ms of CPU per request, and
// parse5 is a large JavaScript parser. In a fresh isolate its first page
// costs 13 ms for 5 KB and 29 ms for 20 KB before V8 has compiled it, so
// uploads failed with error 1102. lol-html is Rust: no warm-up.
//
// Cost model (measured in workerd): tokenizing is cheap (~5 ms for 2 MiB),
// but every JavaScript handler call costs ~5 us, any element handler makes
// lol-html track open elements, and any attribute selector makes it parse
// the attributes of every element. So nothing here watches every element.
// A quick scan of the source text (`scan`) finds which tags and attribute
// names can occur at all, and the rewriter only calls back for elements a
// rule could apply to:
//   - tags with rules (script, link, meta, img, ...), by tag name;
//   - event handler attributes, by name, for the names the page contains;
//   - URL attributes whose raw value could normalize to a blocked scheme, by
//     its first character (j, v, f, &, or whitespace), only when the page
//     contains such a scheme or a character reference that could spell one;
//   - style attributes containing "expression", "behavior", "javascript", or
//     a reference to a letter, only when the page contains one;
//   - srcdoc attributes; <svg>/<math>; context tags (below).
// Each callback runs the full element check (checkElementRules) on the
// attributes as parse5 sees them (first duplicate wins, references decoded,
// foreign names localized), so findings match parse5's. Script and title
// text is read from the output between markers, not with text handlers
// (lol-html splits text at every "<"); a page that starts plainly has its
// title read straight from the source (`leadingTitle`).
//
// Where a token stream can differ from parse5's tree builder, this validator
// is stricter, never looser (test/html-policy-server.test.js checks it
// against parse5 on generated pages):
//   1. <noscript>. parse5 runs with scripting off and reads <noscript>
//      content as markup; lol-html (like a browser with scripting on, which
//      the sandbox always has) reads it as raw text. A page with <noscript>
//      is read twice: as is, and with every <noscript> tag renamed so its
//      content is markup. Findings are combined; it has scripts if either
//      reading finds them. (A script split by a "</noscript>" inside it may
//      miss a sandbox warning parse5 gives; such a page has scripts anyway.)
//   2. Ignored text tags. The tree builder ignores some start tags (inside
//      <select>, after <frameset>, and after <col> as the first tag in a
//      <template>), so the tokenizer never switches to raw text for them; a
//      token stream would, and could hide markup parse5 reads (a <script>
//      inside an ignored <style>), or misread an ignored <svg> as foreign
//      content (CDATA hiding markup). lol-html refuses some of these itself;
//      the rest are refused here: a text tag (style, title, xmp, iframe,
//      noembed, noframes, noscript, plaintext; also script and textarea after
//      <frameset> or <col>), <svg>, <math>, or <template> in one of those
//      contexts is an "ambiguous-markup" error, and so is a <select> closed
//      by another element's end tag.
//   3. SVG and MathML. lol-html's model of foreign content is simpler than
//      the tree builder's, and a wrong namespace changes how text tags and
//      CDATA are tokenized. Each outermost <svg>/<math> is re-read with the
//      tree builder's rules (foreignRegionProblem) and must be plain enough
//      that both agree, or the page is "ambiguous-markup": no HTML tags
//      breaking out of SVG, HTML only inside <foreignObject>/<desc>/<title>
//      (MathML: <mi>, <mo>, <mn>, <ms>, <mtext>), balanced tags, no MathML
//      <annotation-xml>, <mglyph>, or <malignmark>, nothing self-closed but
//      plain SVG/MathML elements.
//   4. <template> content. parse5 skips inert template content; here it is
//      checked like the rest of the page (it may add codes and set
//      hasScripts). Titles inside templates still never name the page.
//   5. Elements the tree builder drops, re-parents, or merges (a second
//      <body>'s attributes, foster-parented table content): every start tag
//      is checked where it appears, so nothing parse5 checks is skipped.
//      Counts can differ (parse5 also counts reconstructed formatting
//      elements), the first <title> is the first in source order, and the
//      text of a <title> holding markup inside SVG is approximated.
//   6. A refused page (ambiguous-markup, too-deep, parse-failed) counts as
//      having scripts, and may miss findings after the point of refusal.
//   7. Limits. parse5's depth (512) and attribute (1000) limits protect its
//      quadratic paths; lol-html keeps no tree and reads attributes once, so
//      neither applies here. lol-html caps its own stack of unclosed elements
//      (about 10,000); a page over it fails as "too-deep".
//   8. Positions. Issues carry no line or column; `htmlartifact upload`
//      checks locally with parse5 first, so authors see positions there.

const HTML_NS = "http://www.w3.org/1999/xhtml";

// Tags whose content lol-html (like browsers) reads as text, not markup.
const TEXT_TAGS = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);

// Tag names the scan looks for. U+212A (Kelvin sign) lowercases to "k", and
// the policy lowercases tag names, so <linK> with a Kelvin sign is a link.
// (Factored by first letter: irregexp scans it faster.)
const TAG_SCAN =
  /<(s(?:cript|ource|vg|elect|tyle)|t(?:itle|rac[k\u212a]|emplate|extarea)|lin[k\u212a]|m(?:eta|ath)|i(?:mg|mage|frame)|video|a(?:udio|pplet)|f(?:orm|rameset)|object|embed|no(?:script|embed|frames)|col|xmp|plaintext)(?=[\t\n\f\r />])/gi;
// Tags with rules, called back whenever the page has them.
const RULE_TAGS = new Set(["script", "title", "link", "meta", "img", "image", "video", "audio", "source", "track", "form", "iframe", "object", "embed", "applet"]);
// Tags that only matter inside <select>, after <frameset>, or after <col> in a <template>.
const CONTEXT_TAGS = new Set(["style", "textarea", "xmp", "noembed", "noframes", "noscript", "plaintext"]);

// An attribute name starts after whitespace, "/", or a closing quote.
// Handler names are letters only, so a name with anything else in it is not one.
const HANDLER_SCAN = /[\t\n\f\r /"'][oO][nN][a-zA-Z\u212a]+/g;

// A value that could normalize to a blocked scheme: after "=" or a quote,
// any characters trim() or the scheme check skips (or references), then
// the scheme with ASCII whitespace or control characters anywhere in it.
const SCHEME_SCAN = new RegExp(
  "[=\"'](?:[\\u0000-\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]|&[a-zA-Z0-9#]+;?)*(?:" +
    ["javascript:", "vbscript:", "file:"].map((scheme) => [...scheme].join("[\\u0000-\\u0020]*")).join("|") +
    ")",
  "i"
);
// Characters a value may start with that trim() removes but that no
// selector below matches: such pages get every URL attribute called back.
const ODD_LEADING = /[\u0001-\u0008\u000b\u000e-\u001f\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
// Named references that decode to scheme characters or whitespace the scheme
// check strips (the only ones among HTML's 2,125 that decode to ASCII letters,
// ":", "(", or control characters).
const SCHEME_NAMED_REFS = ["&tab;", "&newline;", "&colon;", "&fjlig;"];
const NUMERIC_REF = /&#(?:[xX]0*([0-9a-fA-F]{1,6})|0*([0-9]{1,7}))/g;
// URL attributes other than href and src, looked for by name.
const URL_NAME_SCAN = /formaction|action|poster|srcdoc|xlin[k\u212a]:href/gi;
// First characters of a raw value that could normalize to a blocked scheme.
const URL_PREFIXES = ['^=j i', '^=v i', '^=f i', '^="&"', '^=" "', '^="\\9 "', '^="\\a "', '^="\\c "', '^="\\d "', '^="\\a0 "', '^="\\feff "'];
const CSS_WORDS = ["expression", "behavior", "javascript", "&fjlig"];

interface Scan {
  tags: Set<string>; // ASCII-lowercased, Kelvin sign kept
  handlers: Set<string>; // handler attribute names as lol-html reports them
  srcdoc: boolean;
  urls: boolean; // some URL attribute could be unsafe
  urlNames: Set<string>; // URL attribute names the page contains (as lol-html reports them)
  oddLeading: boolean;
  css: boolean; // some style attribute could be unsafe
  letterRefs: boolean; // numeric references to ASCII letters
}

const asciiLower = (value: string) => value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

// Finds, in the source text, every tag and attribute name a rule could apply
// to. A superset: matches in text, comments, or scripts only cost a callback.
function scan(html: string): Scan {
  const tags = new Set<string>();
  for (const match of html.matchAll(TAG_SCAN)) tags.add(asciiLower(match[1]!));
  const handlers = new Set<string>();
  for (const match of html.matchAll(HANDLER_SCAN)) {
    const name = asciiLower(match[0].slice(1));
    if (EVENT_HANDLER_ATTRS.has(name.toLowerCase())) handlers.add(name);
  }
  // Substring tests on a lowercased copy are much cheaper than
  // case-insensitive regular expressions. (Lowercasing keeps every ASCII
  // match; it only ever turns other characters into ASCII ones.)
  const lower = html.toLowerCase();
  let letterRefs = false;
  let schemeRefs = SCHEME_NAMED_REFS.some((ref) => lower.includes(ref));
  if (html.includes("&#")) {
    for (const match of html.matchAll(NUMERIC_REF)) {
      const code = match[1] ? parseInt(match[1], 16) : Number(match[2]);
      const letter = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
      if (letter) letterRefs = true;
      if (letter || code <= 0x20 || code === 0x3a) schemeRefs = true;
      if (letterRefs) break;
    }
  }
  const urls = schemeRefs || SCHEME_SCAN.test(html);
  const urlNames = new Set(["href", "src"]);
  if (urls) for (const match of html.matchAll(URL_NAME_SCAN)) urlNames.add(asciiLower(match[0]));
  return {
    tags,
    handlers,
    srcdoc: lower.includes("srcdoc"),
    urls,
    urlNames,
    oddLeading: ODD_LEADING.test(html),
    css: letterRefs || CSS_WORDS.some((word) => lower.includes(word)),
    letterRefs
  };
}

// A name in a CSS selector: lol-html matches attribute names exactly.
const cssName = (name: string) => name.replace(/:/g, "\\:").replace(/\u212a/g, "\\212a ");

// Tags a <select> makes ambiguous (lol-html refuses most of them itself).
const SELECT_AMBIGUOUS = ["style", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext", "svg", "math", "template"];

function selectorsFor(found: Scan, titleKnown: boolean): string[] {
  const selectors: string[] = [];
  const { tags } = found;
  // After <frameset>, or after <col> in a <template>, every text tag is
  // checked; inside <select>, only those lol-html places in one.
  const contexts = tags.has("frameset") || (tags.has("col") && tags.has("template"));
  if (tags.has("select") && !contexts) {
    for (const tag of SELECT_AMBIGUOUS) if (tags.has(tag)) selectors.push(`select ${tag}`);
  }
  for (const tag of tags) {
    const base = tag.replace(/\u212a/g, "k");
    if (tag === "title" && titleKnown && !contexts) continue;
    if (
      RULE_TAGS.has(base) ||
      tag === "template" ||
      tag === "select" ||
      tag === "frameset" ||
      (tag === "col" && tags.has("template")) ||
      tag === "svg" ||
      tag === "math" ||
      (CONTEXT_TAGS.has(tag) && contexts)
    ) {
      selectors.push(cssName(tag));
    }
  }
  for (const name of found.handlers) selectors.push(`[${cssName(name)}]`);
  if (found.srcdoc) selectors.push("[srcdoc]");
  if (found.urls) {
    for (const name of found.urlNames) {
      if (found.oddLeading) selectors.push(`[${cssName(name)}]`);
      else for (const prefix of URL_PREFIXES) selectors.push(`[${cssName(name)}${prefix}]`);
    }
  }
  if (found.css) {
    selectors.push("[style*=expression i]", "[style*=behavior i]", "[style*=javascript i]", '[style*="&fjlig" i]');
    if (found.letterRefs) selectors.push('[style*="&#"]');
  }
  return selectors;
}

// parse5 renames foreign attributes (SVG and MathML) to their local names.
const FOREIGN_ATTRIBUTES = new Map([
  ["xlink:actuate", "actuate"],
  ["xlink:arcrole", "arcrole"],
  ["xlink:href", "href"],
  ["xlink:role", "role"],
  ["xlink:show", "show"],
  ["xlink:title", "title"],
  ["xlink:type", "type"],
  ["xml:lang", "lang"],
  ["xml:space", "space"],
  ["xmlns:xlink", "xlink"]
]);

// The input stream's newline normalization, and the tokenizer's NUL
// replacement, which lol-html leaves to its consumers.
const normalizeSource = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "\ufffd");

// An element's attributes as parse5's tokenizer and tree builder see them:
// the first of duplicate names wins, values have character references
// decoded, and foreign elements' xlink:/xml: names are localized.
function attributesOf(element: Element): Attribute[] {
  const foreign = element.namespaceURI !== HTML_NS;
  const seen = new Set<string>();
  const attributes: Attribute[] = [];
  // lol-html lowercases ASCII in names already.
  for (const [name, raw] of element.attributes as IterableIterator<[string, string]>) {
    if (seen.has(name)) continue;
    seen.add(name);
    let value = raw;
    if (/[\r\u0000]/.test(value)) value = normalizeSource(value);
    if (value.includes("&")) value = decodeHTMLAttribute(value);
    attributes.push({ name: foreign ? (FOREIGN_ATTRIBUTES.get(name) ?? name) : name, value });
  }
  return attributes;
}

// A script's or title's source text, as read between markers around it. Foreign (SVG/MathML) content is markup, so tags are dropped
// and references decoded; CDATA sections are kept as written.
function sourceText(raw: string, foreign: boolean, decode: boolean): string {
  let text = normalizeSource(raw);
  if (foreign) {
    return text
      .split(/(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))/)
      .map((part, i) =>
        i % 2
          ? part.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "")
          : // Comments first (a ">" inside one is not a tag end), then bogus
            // comments (<!x>, <?x>), then tags: only text remains, as parse5 reads it.
            decodeHTML(
              part
                .replace(/<!--(?:>|->|[\s\S]*?(?:--!?>|$))/g, "")
                .replace(/<[!?][^>]*>?/g, "")
                .replace(/<\/?[A-Za-z][^>]*>?/g, "")
            )
      )
      .join("");
  }
  if (decode) text = decodeHTML(text);
  return text;
}

// SVG and MathML: lol-html's model of foreign content is simpler than the
// tree builder's (it misses breakouts from nested <svg>, keeps a self-closed
// <svg/> open, and pops elements on end tags the tree builder ignores), and
// a wrong namespace changes how text tags and CDATA are tokenized. So every
// outermost <svg>/<math> region, as lol-html delimits it, is re-read here
// with the tree builder's foreign-content rules, and must be plain enough
// that both readings agree: balanced tags, no HTML tags breaking out of
// SVG/MathML, HTML only inside integration points (<foreignObject>, <desc>,
// <title>, <mi>, ...), and the region closed by its own end tag. Anything
// else is "ambiguous-markup". Returns the offending tag, or null.
const BREAKOUT = new Set(
  "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var".split(" ")
);
const HTML_VOID = new Set("area base basefont bgsound br col embed frame hr image img input keygen link meta param source track wbr".split(" "));
// Raw text (or RCDATA) in HTML: skipped to its end tag.
const HTML_RAW = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "title", "textarea"]);
// HTML tags whose handling depends on more of the tree builder than this models.
const HTML_REFUSED = new Set(["noscript", "select", "template", "frameset", "frame", "body", "html", "head", "plaintext"]);
const MATHML_TEXT_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);
const FOREIGN_REFUSED = new Set(["annotation-xml", "mglyph", "malignmark"]);
const TAG = /<(\/?)([a-zA-Z][^\t\n\f\r />]*)/y;
const ATTRIBUTE =
  /[\t\n\f\r ]*(?:(\/>)|(>)|(\/)|([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?)/y;

interface Frame {
  name: string;
  ns: "svg" | "math" | "html";
  html: boolean; // its content follows HTML rules (an integration point, or an HTML element)
}

function foreignRegionProblem(text: string, closedBy: string | null): string | null {
  const lower = (value: string) => (/[A-Z]/.test(value) ? value.replace(/[A-Z]+/g, (s) => s.toLowerCase()) : value);
  const stack: Frame[] = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;
    i = lt;
    const top = stack[stack.length - 1];
    if (text.startsWith("<!--", i)) {
      if (text.startsWith("<!-->", i)) i += 5;
      else if (text.startsWith("<!--->", i)) i += 6;
      else {
        const end = /--!?>/g;
        end.lastIndex = i + 4;
        i = end.exec(text) ? end.lastIndex : text.length;
      }
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      if (!top || top.html) return "![CDATA[";
      const end = text.indexOf("]]>", i + 9);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text[i + 1] === "!" || text[i + 1] === "?" || (text[i + 1] === "/" && !/[a-zA-Z]/.test(text[i + 2] ?? ""))) {
      if (text.startsWith("</>", i)) {
        i += 3;
        continue;
      }
      const end = text.indexOf(">", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    TAG.lastIndex = i;
    const tag = TAG.exec(text);
    if (!tag) {
      i++;
      continue;
    }
    const isEnd = tag[1] === "/";
    const name = lower(tag[2]!);
    let at = TAG.lastIndex;
    let selfClosing = false;
    let complete = false;
    // Only <font> has attributes that matter here.
    const attributes = name === "font" ? new Map<string, string>() : null;
    while (at < text.length) {
      ATTRIBUTE.lastIndex = at;
      const part = ATTRIBUTE.exec(text);
      if (!part || ATTRIBUTE.lastIndex === at) break; // an unterminated quote: the tag never ends
      at = ATTRIBUTE.lastIndex;
      if (part[1]) {
        selfClosing = complete = true;
        break;
      }
      if (part[2]) {
        complete = true;
        break;
      }
      if (attributes && part[4]) {
        const attr = lower(part[4]);
        if (!attributes.has(attr)) attributes.set(attr, part[5] ?? part[6] ?? part[7] ?? "");
      }
    }
    if (!complete) break; // a tag cut off by the end of the document emits nothing
    i = at;

    if (!top) {
      // The region starts at its root.
      if (isEnd || (name !== "svg" && name !== "math")) return name;
      if (selfClosing) return `${name}/`;
      stack.push({ name, ns: name as "svg" | "math", html: false });
      continue;
    }

    if (isEnd) {
      if (!closeElement(stack, name)) return `/${name}`;
      // The tree builder closed the root before lol-html did.
      if (!stack.length) return `/${name}`;
      continue;
    }

    if (!top.html) {
      // Foreign content.
      if (BREAKOUT.has(name) || (name === "font" && (attributes!.has("color") || attributes!.has("face") || attributes!.has("size")))) {
        return name;
      }
      // An <svg> or <math> in the other namespace is an ordinary element
      // there; MathML's <annotation-xml>, <mglyph>, and <malignmark> have
      // special cases lol-html does not share.
      if (((name === "svg" || name === "math") && name !== top.ns) || FOREIGN_REFUSED.has(name)) return name;
      const ns = top.ns;
      const integration =
        (ns === "svg" && (name === "foreignobject" || name === "desc" || name === "title")) ||
        (ns === "math" && MATHML_TEXT_POINTS.has(name));
      if (selfClosing) {
        // lol-html keeps a self-closed <svg/>, <math/>, or integration point
        // open in its namespace stack; the tree builder closes it.
        if (name === "svg" || name === "math" || integration) return `${name}/`;
        continue;
      }
      stack.push({ name, ns, html: integration });
      continue;
    }

    // HTML content inside an integration point.
    if (name === "svg" || name === "math") {
      if (selfClosing) return `${name}/`;
      stack.push({ name, ns: name, html: false });
      continue;
    }
    if (HTML_REFUSED.has(name) || FOREIGN_REFUSED.has(name)) return name;
    if (HTML_VOID.has(name)) continue;
    if (HTML_RAW.has(name)) {
      const end = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "ig");
      end.lastIndex = i;
      const found = end.exec(text);
      if (name === "script" && text.slice(i, found ? found.index : undefined).includes("<!--")) return name;
      if (!found) break;
      i = found.index;
    }
    stack.push({ name, ns: "html", html: true });
  }
  if (closedBy === null) return null; // runs to the end of the page: nothing follows it
  // The end tag lol-html closed the region with must close the root here too.
  if (!closeElement(stack, closedBy) || stack.length) return `/${closedBy}`;
  return null;
}

// An end tag, by the tree builder's rules: inside HTML content it must close
// the current element (anything subtler is refused); in foreign content it
// closes the nearest open element of that name, popping those above it, as
// long as no HTML element is in between. False when that does not hold.
function closeElement(stack: Frame[], name: string): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  if (top.ns === "html") {
    if (top.name !== name) return false;
    stack.pop();
    return true;
  }
  // </p> and </br> break out of foreign content.
  if (name === "p" || name === "br") return false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    if (frame.ns === "html") return false;
    if (frame.name === name) {
      stack.length = i;
      return true;
    }
  }
  return false;
}

interface PassResult {
  issues: Issue[];
  hasScripts: boolean;
  sandbox: Set<string>; // SANDBOX_APIS codes some script or handler matched
  title: string | null;
  hosts: Set<string>;
  noscript: boolean; // the page may contain <noscript> elements
}

const TITLES_MARKED = 16;

// Start tags that may come before the first <title> for leadingTitle to
// trust it: they hold no text and change nothing about how it is read.
const BEFORE_TITLE = new Set(["html", "head", "meta", "link", "base", "body"]);

// The page title, when the page starts plainly: a doctype, then only the
// tags above, then <title>. Then that <title> is the first in document order
// and its text runs to "</title" (RCDATA). Returns undefined when the page
// does not start that way, or the title has no text (a later one may).
function leadingTitle(html: string): string | undefined {
  let i = 0;
  for (;;) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return undefined;
    i = lt;
    if (/^<!doctype[\t\n\f\r >]/i.test(html.slice(i, i + 10))) {
      const end = html.indexOf(">", i);
      if (end === -1) return undefined;
      i = end + 1;
      continue;
    }
    TAG.lastIndex = i;
    const tag = TAG.exec(html);
    if (!tag) return undefined;
    const name = asciiLower(tag[2]!);
    if (tag[1] === "/" || (name !== "title" && !BEFORE_TITLE.has(name))) return undefined;
    // Find the end of the start tag, attribute by attribute.
    let at = TAG.lastIndex;
    let complete = false;
    while (at < html.length) {
      ATTRIBUTE.lastIndex = at;
      const part = ATTRIBUTE.exec(html);
      if (!part || ATTRIBUTE.lastIndex === at) return undefined;
      at = ATTRIBUTE.lastIndex;
      if (part[1] || part[2]) {
        complete = true;
        break;
      }
    }
    if (!complete) return undefined;
    i = at;
    if (name === "title") {
      const end = /<\/title[\t\n\f\r />]/gi;
      end.lastIndex = i;
      const found = end.exec(html);
      const text = sourceText(html.slice(i, found ? found.index : undefined), false, true);
      return /\S/.test(text) ? (titleText(text) ?? undefined) : undefined;
    }
  }
}

// The first <title> with text, when the first TITLES_MARKED had none: every
// title is read, outside templates (a rare second pass).
async function laterTitle(html: string): Promise<string | null> {
  const texts: string[] = [];
  let open = -1;
  let templates = 0;
  let templateLost = false;
  await new HTMLRewriter()
    .on("template", {
      element(element) {
        try {
          element.onEndTag((end) => {
            if (end.name === "template") templates--;
            else templateLost = true;
          });
          templates++;
        } catch {
          // A self-closed <template/> (in SVG/MathML) has no end tag and holds nothing.
        }
      }
    })
    .on("title", {
      element(element) {
        open = templates > 0 || templateLost ? -1 : texts.push("") - 1;
      },
      text(chunk) {
        if (open >= 0) texts[open] += chunk.text;
      }
    })
    .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .arrayBuffer();
  // Text chunks hold no markup, foreign or not: decode references only.
  for (const raw of texts) {
    const text = sourceText(raw, false, true);
    if (/\S/.test(text)) return titleText(text);
  }
  return null;
}

const AMBIGUOUS_FIX = "Close the <select> before it, and keep it out of <frameset> pages and <template> column groups.";
const ambiguous = (tag: string) => `Blocked <${tag}> where browsers can read the markup after it in two ways.`;
const FOREIGN_FIX = "Keep SVG and MathML well-formed: close every element, and put HTML only inside <foreignObject>.";
const ambiguousForeign = (tag: string, root: string) =>
  `Blocked <${tag}> in <${root}>, where browsers can read the markup after it in two ways.`;

// One reading of the page.
async function readPage(html: string): Promise<PassResult> {
  const found = scan(html);
  const issues = createIssueList<never>();
  const sandbox = new Set<string>();
  const hosts = new Set<string>();
  let hasScripts = false;
  // Usually the title is the first thing in the page: read it from the
  // source and spare a callback for every <title> tooltip in a chart.
  const leading = leadingTitle(html);
  const selectors = selectorsFor(found, Boolean(leading));
  const noscript = found.tags.has("noscript");
  if (!selectors.length) {
    return { issues: issues.list(), hasScripts, sandbox, title: leading ?? null, hosts, noscript };
  }

  // Scripts' and titles' text is read from the output, between markers:
  // a text handler would be called for every "<" in a script.
  let nonce = "";
  do nonce = `\u0001${crypto.randomUUID().replaceAll("-", "")}`;
  while (html.includes(nonce));
  let marked = 0;
  const scripts: { id: number; foreign: boolean }[] = [];
  const titles: { id: number; foreign: boolean }[] = [];
  const regions: { id: number; root: string; closedBy: string | null }[] = [];
  const mark = (element: Element) => {
    const id = marked++;
    element.prepend(`${nonce}S${id}Z`, { html: true });
    element.append(`${nonce}E${id}Z`, { html: true });
    return id;
  };
  // Only the first title with text names the page; charts can have hundreds
  // of <title> tooltips. Past this many, titles are read in a second pass
  // only if none of these had text.
  let titlesSeen = 0;

  // Context, as conservative as the comments at the top describe.
  let templates = 0;
  let templateLost = false; // a <template> closed by something else
  let selects = 0;
  let selectLost = false; // a <select> closed by something other than </select>, or with a <template> inside
  let frameset = false;
  let columnGroup = false;
  let foreignDepth = 0;
  const inTemplate = () => templates > 0 || templateLost;
  const onEnd = (element: Element, name: string, closed: () => void, lost: () => void) => {
    try {
      element.onEndTag((end) => (end.name === name ? closed() : lost()));
    } catch {
      // A self-closing foreign element: no end tag, nothing left open.
      closed();
    }
  };

  const handler = {
    element(element: Element) {
      const tag = element.tagName;
      const isHtml = element.namespaceURI === HTML_NS;
      const lower = tag.toLowerCase();

      if (TEXT_TAGS.has(lower) || lower === "svg" || lower === "math" || lower === "template") {
        const inSelect = selects > 0 || selectLost;
        if (
          ((frameset || columnGroup) && lower !== "template") ||
          (inSelect && lower !== "script" && lower !== "textarea")
        ) {
          issues.error("ambiguous-markup", ambiguous(lower), { fix: AMBIGUOUS_FIX });
          // What follows may be read differently: assume it has scripts.
          hasScripts = true;
        }
      }
      if (lower === "template") {
        templates++;
        onEnd(element, "template", () => templates--, () => (templateLost = true));
      } else if (lower === "select") {
        selects++;
        // Closed by another element's end tag (misnested): the tree builder
        // may still be in the <select>, so it counts as open to the end, and
        // anything it makes ambiguous is refused right away.
        onEnd(element, "select", () => selects--, () => {
          selectLost = true;
          issues.error("ambiguous-markup", ambiguous("select"), { fix: AMBIGUOUS_FIX });
          hasScripts = true;
        });
      } else if (lower === "frameset") {
        frameset = true;
      } else if (lower === "col") {
        if (inTemplate()) columnGroup = true;
      } else if (lower === "svg" || lower === "math") {
        // An outermost SVG/MathML region is re-read after the pass (see
        // foreignRegionProblem), between markers before its start tag and
        // before the end tag lol-html closes it with.
        const region = foreignDepth === 0 ? { id: marked++, root: lower, closedBy: null as string | null } : null;
        if (region) {
          regions.push(region);
          element.before(`${nonce}S${region.id}Z`, { html: true });
        }
        foreignDepth++;
        try {
          element.onEndTag((end) => {
            foreignDepth--;
            if (region) {
              region.closedBy = end.name.toLowerCase();
              end.before(`${nonce}E${region.id}Z`, { html: true });
            }
          });
        } catch {
          foreignDepth--; // no end tag (self-closing): the region check refuses it
        }
      }

      current = element;
      currentIsHtml = isHtml;
      // parse5 turns <image> into <img> outside foreign content.
      checkElementRules(lower === "image" && isHtml ? "img" : tag, attributesOf(element), sink);
    }
  };
  let current: Element;
  let currentIsHtml = true;
  const sink: RuleSink = {
    error: (code, message, options) => issues.error(code, message, { fix: options?.fix }),
    warning: (code, message, options) => issues.warning(code, message, { fix: options?.fix }),
    executableScript: () => {
      hasScripts = true;
      scripts.push({ id: mark(current), foreign: !currentIsHtml });
    },
    handler: (_attr, value) => {
      hasScripts = true;
      for (const api of SANDBOX_APIS) if (api.pattern.test(value)) sandbox.add(api.code);
    },
    title: () => {
      if (inTemplate()) return;
      if (++titlesSeen <= TITLES_MARKED) titles.push({ id: mark(current), foreign: foreignDepth > 0 });
    },
    imageHost: (host) => hosts.add(host)
  };

  let output = "";
  try {
    const transformed = new HTMLRewriter()
      .on(selectors.join(", "), handler)
      .transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
    const bytes = await transformed.arrayBuffer();
    if (marked) output = new TextDecoder().decode(bytes);
  } catch (error) {
    // The rest of the page went unread: assume it has scripts. (The page
    // fails anyway; this keeps hasScripts never below parse5's.)
    hasScripts = true;
    const message = String((error as Error)?.message ?? error);
    if (/ambiguous/i.test(message)) {
      const tag = /`<([^>`]+)>`/.exec(message)?.[1] ?? "?";
      issues.error("ambiguous-markup", ambiguous(tag.toLowerCase()), { fix: AMBIGUOUS_FIX });
    } else if (/memory limit/i.test(message)) {
      issues.error("too-deep", "HTML has too many unclosed elements to check (about 10,000 open at once).", {
        fix: "Close elements such as <p>, <li>, and <div>."
      });
    } else {
      issues.error("parse-failed", "HTML document could not be parsed.");
    }
  }

  // Where each marker landed in the output, in one pass.
  const starts: number[] = [];
  const ends: number[] = [];
  const markers = new RegExp(`${nonce}([SE])(\\d+)Z`, "g");
  if (output) {
    for (const match of output.matchAll(markers)) {
      (match[1] === "S" ? starts : ends)[Number(match[2])] = match.index;
    }
  }
  const markerLength = (id: number) => nonce.length + String(id).length + 2;
  const between = (id: number, foreign: boolean, decode: boolean) => {
    const from = starts[id];
    if (from === undefined) return "";
    const to = ends[id];
    const text = output.slice(from + markerLength(id), to).replace(markers, "");
    return sourceText(text, foreign, decode);
  };
  for (const script of output ? scripts : []) {
    const text = between(script.id, script.foreign, false);
    for (const api of SANDBOX_APIS) if (api.pattern.test(text)) sandbox.add(api.code);
  }
  if (output && regions.length) {
    for (const region of regions) {
      const from = starts[region.id];
      const to = ends[region.id];
      if (from === undefined) continue;
      const text = output.slice(from, to).replace(markers, "");
      const problem = foreignRegionProblem(text, to === undefined ? null : region.closedBy);
      if (problem) {
        issues.error("ambiguous-markup", ambiguousForeign(problem, region.root), { fix: FOREIGN_FIX });
        hasScripts = true;
      }
    }
  }
  let title: string | null = leading ?? null;
  for (const candidate of output && !title ? titles : []) {
    const text = between(candidate.id, candidate.foreign, true);
    if (/\S/.test(text)) {
      title = titleText(text);
      break;
    }
  }
  if (output && !title && titlesSeen > TITLES_MARKED) {
    try {
      title = await laterTitle(html);
    } catch {
      // Fail closed: a page the second pass cannot read is refused.
      issues.error("parse-failed", "HTML document could not be parsed.");
      hasScripts = true;
    }
  }
  return { issues: issues.list(), hasScripts, sandbox, title, hosts, noscript };
}

const NOSCRIPT_TAG = /<(\/?)(noscript)(?=[\t\n\f\r />])/gi;

// Validates one HTML document with HTMLRewriter. Same result shape, codes,
// and messages as parse5's validateHtml (src/html-policy.ts), without
// source positions.
async function validateHtml(html: unknown, options: { maxBytes?: number } = {}): Promise<HtmlValidation> {
  const early = precheckHtml(html, options.maxBytes ?? Infinity);
  if (early) return early;
  const source = html as string;
  const bytes = Buffer.byteLength(source, "utf8");

  const first = await readPage(source);
  const issues = createIssueList<never>();
  for (const issue of first.issues) issues.merge(issue);
  let { hasScripts, title } = first;
  const sandbox = first.sandbox;
  const hosts = first.hosts;

  // parse5's reading of <noscript>: its content as markup. Every <noscript>
  // tag gets a prefix no tag in the page has, so it is an ordinary element.
  if (first.noscript) {
    let prefix = "";
    do prefix = `ha${crypto.randomUUID().slice(0, 8)}`;
    while (source.toLowerCase().includes(`${prefix}noscript`));
    const second = await readPage(source.replace(NOSCRIPT_TAG, `<$1${prefix}$2`));
    for (const issue of second.issues) issues.merge(issue);
    hasScripts ||= second.hasScripts;
    for (const code of second.sandbox) sandbox.add(code);
    for (const host of second.hosts) hosts.add(host);
    const renamed = new RegExp(`<(\\/?)${prefix}(noscript)`, "gi");
    title = second.title?.replace(renamed, "<$1$2") ?? title;
  }

  for (const api of SANDBOX_APIS) {
    if (sandbox.has(api.code)) issues.warning(api.code, api.message, { fix: api.fix });
  }
  if (!title) issues.warning("no-title", NO_TITLE_MESSAGE);

  return htmlResult({ issues, title, hasScripts, bytes, externalImageHosts: [...hosts].sort() });
}

// validateUpload (src/html-policy-rules.ts) with the HTMLRewriter validator.
export function validateUpload(pages: PageInput[] | unknown, limits: UploadLimits = {}): Promise<UploadValidation> {
  return runUploadAsync(uploadSteps(pages, limits), (html) => validateHtml(html));
}

// Warm-up at startup: the first page an isolate checks would otherwise pay
// for compiling this module's functions and regular expressions, and Workers
// count that against the request's CPU time, not the isolate's startup.
{
  const sample =
    '<!doctype html><title>t &amp; u</title><a href="https://x.test/" onclick="go()" style="color:red">x</a>' +
    '<img src="https://x.test/i.png" srcset="a.png 1x"><script>fetch(1)</script><link rel="stylesheet" href="https://x.test/a.css">' +
    '<svg viewBox="0 0 1 1"><rect x="0"><title>bar</title></rect><foreignObject><div>x</div></foreignObject><![CDATA[x]]></svg>';
  const found = scan(sample);
  selectorsFor(found, Boolean(leadingTitle(sample)));
  foreignRegionProblem(sample.slice(sample.indexOf("<svg"), sample.lastIndexOf("</svg>")), "svg");
  const ignore = () => {};
  const sink: RuleSink = { error: ignore, warning: ignore, executableScript: ignore, handler: ignore, title: ignore, imageHost: ignore };
  for (const [tag, attrs] of [
    ["a", [{ name: "href", value: "javascript:x" }, { name: "onclick", value: "fetch(1)" }, { name: "style", value: "x:expression(1)" }]],
    ["img", [{ name: "src", value: "a.png" }, { name: "srcset", value: "a.png 1x, b.png 2x" }]],
    ["script", [{ name: "type", value: "module" }]],
    ["link", [{ name: "rel", value: "stylesheet" }, { name: "href", value: "https://x.test/" }]],
    ["meta", [{ name: "http-equiv", value: "refresh" }]]
  ] as const) {
    checkElementRules(tag, attrs, sink);
  }
  for (const api of SANDBOX_APIS) api.pattern.test(sample);
  sourceText(decodeHTMLAttribute("a&amp;b&#106;") + "\r\n", false, true);
}
