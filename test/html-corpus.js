// Generated HTML for the differential test (test/html-policy-server.test.js):
// realistic reports, hostile markup, and random token soup. Deterministic for
// a given seed.

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (list) => list[int(list.length)];
  const chance = (p) => next() < p;
  return { next, int, pick, chance };
}

const WORDS = "revenue growth quarter region north south east west total margin users online active churn cohort retention funnel signup trial paid enterprise team plan score latency p95 errors deploys incidents behavior profile file: expression javascript summary".split(" ");

const TITLE_TEXTS = [
  "Q3 revenue report",
  "Latency &amp; errors &mdash; week 42",
  "Team&#39;s OKRs",
  "  Cohort retention  ",
  "R&D &lt;draft&gt;",
  "Caf&eacute; metrics",
  "A\r\nmultiline title",
  "x".repeat(200)
];

const SANDBOX_SNIPPETS = [
  "localStorage.setItem('k', 1);",
  "const c = document.cookie;",
  "fetch('/api/data').then(r => r.json());",
  "new XMLHttpRequest();",
  "alert('done');",
  "if (confirm('ok?')) {}",
  "const w = new Worker('w.js');",
  "new SharedWorker('s.js');",
  "sessionStorage.clear();",
  "const ws = new WebSocket('wss://x');"
];

function words(r, n) {
  return Array.from({ length: n }, () => r.pick(WORDS)).join(" ");
}

function svgChart(r) {
  const bars = Array.from({ length: 2 + r.int(8) }, (_, i) => {
    const h = 10 + r.int(90);
    const tip = r.chance(0.7) ? `<title>${r.pick(WORDS)} ${h}</title>` : "";
    return r.chance(0.5)
      ? `<rect x="${i * 20}" y="${100 - h}" width="15" height="${h}" fill="#4a90d9">${tip}</rect>`
      : `<circle cx="${i * 20}" cy="${h}" r="4"/>`;
  });
  const extras = [
    r.chance(0.2) ? `<a xlink:href="${r.pick(["#top", "https://example.com", "javascript:void(0)"])}"><text x="0" y="10">link</text></a>` : "",
    r.chance(0.2) ? `<foreignObject width="100" height="20"><div style="color:red">note</div></foreignObject>` : "",
    r.chance(0.1) ? `<script>${r.pick(SANDBOX_SNIPPETS)}</script>` : "",
    r.chance(0.1) ? `<style>.bar{fill:#333}</style>` : "",
    r.chance(0.1) ? `<image href="${r.pick(["chart.png", "https://cdn.example.com/c.png"])}" width="10" height="10"/>` : ""
  ];
  return `<svg viewBox="0 0 200 100" width="400" height="200" role="img">${r.chance(0.5) ? `<title>${words(r, 3)}</title>` : ""}${bars.join("")}${extras.join("")}</svg>`;
}

function table(r) {
  const rows = 1 + r.int(12);
  const close = r.chance(0.8);
  const head = `<thead><tr><th>Name</th><th>Value</th><th>Change</th></tr></thead>`;
  const body = Array.from({ length: rows }, (_, i) => {
    const cell = (v) => (close ? `<td>${v}</td>` : `<td>${v}`);
    const link = r.chance(0.3) ? `<a href="${r.pick(["https://example.com/p/" + i, "#row" + i, "details.html", "&#106;avascript:x()", " javascript:x()", "java\tscript:x()", "JAVASCRIPT:x", "vbscript:msgbox", "file:///etc/passwd", "&#x6A;ava&#x73;cript&colon;x", "&Tab;javascript:x", "mailto:a@b.c"])}">${r.pick(WORDS)}</a>` : r.pick(WORDS);
    return `<tr${r.chance(0.2) ? ` onclick="${r.pick(["select(" + i + ")", r.pick(SANDBOX_SNIPPETS)])}"` : ""}>${cell(link)}${cell(r.int(10000))}${cell((r.next() * 20 - 10).toFixed(1) + "%")}${close ? "</tr>" : ""}`;
  }).join("\n");
  return `<table class="data">${head}${r.chance(0.5) ? `<tbody>${body}</tbody>` : body}</table>`;
}

function media(r) {
  return r.pick([
    () => `<img src="${r.pick(["data:image/png;base64,iVBORw0KGgo=", "https://images.example.com/a.png", "//cdn.example.org/b.jpg", "img/local.png", "/abs/path.png", "#frag", "http://plain.example.net/c.gif"])}" alt="x">`,
    () => `<img srcset="${r.pick(["a.png 1x, b.png 2x", "https://x.example/a.png 1x, https://x.example/b.png 2x", "data:image/png;base64,AAA=,BBB 1x"])}" src="https://x.example/a.png">`,
    () => `<video src="${r.pick(["clip.mp4", "https://v.example.com/a.mp4"])}" poster="${r.pick(["poster.jpg", "https://v.example.com/p.jpg"])}" controls></video>`,
    () => `<audio controls><source src="${r.pick(["a.mp3", "https://a.example.com/a.mp3"])}" type="audio/mpeg"><track src="subs.vtt"></audio>`,
    () => `<image src="${r.pick(["legacy.png", "https://legacy.example.com/i.png"])}">`
  ])();
}

function script(r) {
  return r.pick([
    () => `<script type="application/json" id="data">{"rows":[1,2,3],"html":"<b>x</b>"}</script>`,
    () => `<script>\nconst rows = JSON.parse(document.getElementById('data')?.textContent || '[]');\nfor (let i = 0; i < rows.length && i < 10; i++) { if (rows[i] < 3) document.body.insertAdjacentHTML('beforeend', '<div class="r">' + rows[i] + '</div>'); }\n${r.chance(0.4) ? r.pick(SANDBOX_SNIPPETS) : ""}\n</script>`,
    () => `<script type="module">import x from "data:text/javascript,export default 1"; ${r.chance(0.3) ? r.pick(SANDBOX_SNIPPETS) : ""}</script>`,
    () => `<script>document.write("<\\/script><iframe>"); /* </div> */ ${r.chance(0.3) ? r.pick(SANDBOX_SNIPPETS) : ""}</script>`,
    () => `<script type="${r.pick(["text/babel", "text/x-template", "TEXT/JAVASCRIPT", "application/ld+json", "text/plain"])}">var a = 1;</script>`,
    () => `<script src="https://cdn.example.com/lib.js"></script>`,
    () => `<script><!--\nvar legacy = 1 < 2;\n//--></script>`
  ])();
}

function violation(r) {
  return r.pick([
    `<iframe src="https://example.com"></iframe>`,
    `<form action="/submit"><input name="q"></form>`,
    `<object data="x.swf"></object>`,
    `<embed src="x.swf">`,
    `<meta http-equiv="Refresh" content="0;url=https://x">`,
    `<a href="javascript:alert(1)">x</a>`,
    `<div style="width: expression(alert(1))">x</div>`,
    `<div style="background:url( javascript:alert(1))">x</div>`,
    `<div style="behavior: url(x.htc)">x</div>`,
    `<div style="color:red;font-family:&quot;Inter&quot;">ok</div>`,
    `<div style="width:expr&#101;ssion(1)">x</div>`,
    `<p srcdoc="<b>x</b>">x</p>`,
    `<link rel="preload" href="https://x/y.css">`,
    `<link rel="stylesheet" href="http://insecure.example/x.css">`,
    `<link rel="icon" href="https://x.example/favicon.png">`,
    `<button formaction="javascript:x">b</button>`,
    `<a href="&#x6A;avascript&colon;x">entity scheme</a>`,
    `<a href="&nbsp;javascript:x">nbsp</a>`,
    `<a href=" &#9;javascript:x">tab</a>`,
    `<a href="https://ok.example" href="javascript:dup">dup</a>`,
    `<a href="javascript:dup" href="https://ok.example">dup2</a>`,
    `<div OnClick="go()">upper</div>`,
    `<div onclic\u212a="go()">kelvin</div>`,
    `<lin\u212a rel="preload" href="x">`,
    `<div onone="x" one="y">inert</div>`,
    `<applet code="x"></applet>`
  ]);
}

// A plausible report page; `p` scales how often each feature appears.
export function realisticPage(r) {
  const parts = [];
  if (r.chance(0.8)) parts.push("<!doctype html>");
  const explicit = r.chance(0.7);
  if (explicit) parts.push(`<html lang="en"><head>`);
  parts.push(`<meta charset="utf-8">`);
  if (r.chance(0.6)) parts.push(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
  if (r.chance(0.9)) parts.push(`<title>${r.pick(TITLE_TEXTS)}</title>`);
  if (r.chance(0.1)) parts.push(`<title>   </title><title>Second title</title>`);
  if (r.chance(0.3)) parts.push(`<link rel="stylesheet" href="https://fonts.example.com/css?family=Inter">`);
  if (r.chance(0.2)) parts.push(`<link rel="preconnect" href="https://fonts.example.com">`);
  if (r.chance(0.8)) parts.push(`<style>body{font:14px/1.4 system-ui} .data td>a{color:#06c} .r::after{content:"\\2192"}</style>`);
  if (explicit) parts.push(`</head><body${r.chance(0.1) ? ' onload="init()"' : ""}>`);
  parts.push(`<header><h1>${words(r, 3)}</h1><p class="lead">${words(r, 12)} &mdash; ${words(r, 5)}</p></header>`);
  const sections = 1 + r.int(5);
  for (let s = 0; s < sections; s++) {
    const kind = r.int(9);
    if (kind === 0) parts.push(table(r));
    else if (kind === 1) parts.push(svgChart(r));
    else if (kind === 2) parts.push(`<ul>${Array.from({ length: 1 + r.int(6) }, () => (r.chance(0.7) ? `<li>${words(r, 4)}</li>` : `<li>${words(r, 4)}`)).join("")}</ul>`);
    else if (kind === 3) parts.push(media(r));
    else if (kind === 4) parts.push(script(r));
    else if (kind === 5) parts.push(`<label>Filter <select id="f" onchange="filter(this.value)"><option value="">All<option value="n">North</option><optgroup label="x"><option>South</optgroup></select></label>`);
    else if (kind === 6) parts.push(`<details><summary>${words(r, 2)}</summary><p>${words(r, 20)}</p><p>${words(r, 8)}<br>${words(r, 8)}</details>`);
    else if (kind === 7) parts.push(`<p>${words(r, 10)} <b>${words(r, 2)}</b> <i>${words(r, 2)}</i> <code>a &lt; b</code> <span style="color:#c00">${words(r, 2)}</span></p>`);
    else parts.push(`<button type="button" onclick="${r.chance(0.5) ? r.pick(SANDBOX_SNIPPETS) : "toggle()"}">Toggle</button><input type="range" oninput="update(this)">`);
    if (r.chance(0.12)) parts.push(violation(r));
  }
  if (r.chance(0.5)) parts.push(script(r));
  parts.push(`<footer><small>Generated ${words(r, 2)}</small></footer>`);
  if (explicit) parts.push("</body></html>");
  return parts.join("\n");
}

// Markup where token streams and tree builders disagree. Each entry is a
// page and whether the two validators must agree exactly on it.
export const TRICKY = [
  // <noscript>: parse5 reads its content as markup (scripting off).
  { html: `<title>t</title><noscript><iframe src="x"></iframe></noscript>`, exact: true },
  { html: `<title>t</title><noscript><script>fetch(1)</script></noscript>`, exact: true },
  { html: `<title>t</title><noscript><p onclick="alert(1)">x</p></noscript>`, exact: true },
  { html: `<title>t</title><noscript><noscript><a href="javascript:x">x</a></noscript></noscript>`, exact: true },
  { html: `<noscript><title>Inside</title></noscript><title>Outside</title>`, exact: true },
  { html: `<title>t</title><noscript><!--</noscript><script>alert(1)</script>--></noscript>`, exact: false },
  { html: `<head><noscript><style>p{}</style><link rel="stylesheet" href="https://x/a.css"></noscript></head><title>t</title>`, exact: true },
  // Ignored text tags: lol-html or the context tracker refuses them.
  { html: `<title>t</title><select><style><script>alert(1)</script></style></select>`, exact: false },
  { html: `<title>t</title><select><svg><![CDATA[</select><script>alert(1)</script>]]></svg></select>`, exact: false },
  { html: `<title>t</title><select><template></select></template><style><script>alert(1)</script></style>`, exact: false },
  { html: `<title>t</title><div><select></div><svg><![CDATA[<script>alert(1)</script>]]></svg>`, exact: false },
  { html: `<title>t</title><template><col><style></template><script>alert(1)</script>`, exact: false },
  { html: `<title>t</title><div><template></div><col><style><iframe></iframe></style>`, exact: false },
  { html: `<frameset><style><frame src="javascript:x"></style></frameset>`, exact: false },
  { html: `<frameset><svg><![CDATA[><frame src="javascript:x">]]></frameset>`, exact: false },
  { html: `<title>t</title><select><option>a</option></select><svg><style>.a{}</style></svg><style>p{}</style>`, exact: true },
  { html: `<title>t</title><select><script>alert(1)</script><textarea><b></textarea>`, exact: true },
  // <template>: parse5 skips inert content; the server checks it.
  { html: `<title>t</title><template><iframe></iframe><script>x</script></template>`, exact: false },
  { html: `<title>t</title><template shadowrootmode="open"><iframe></iframe><title>Shadow</title></template>`, exact: true },
  { html: `<template><title>In template</title></template><title>Real</title>`, exact: true },
  // Foreign content.
  { html: `<title>t</title><svg><style><!--</style><script>alert(1)</script>--></svg>`, exact: true },
  { html: `<title>t</title><math><mi><style><!--</style><script>alert(1)</script>--></mi></math>`, exact: true },
  { html: `<title>t</title><svg><desc><style><b></style></desc><foreignObject><textarea><iframe></textarea></foreignObject></svg>`, exact: true },
  { html: `<title>t</title><svg><font color=red><style><iframe></style>`, exact: false },
  { html: `<title>t</title><svg><font><style><iframe></iframe></style></font></svg>`, exact: true },
  { html: `<title>t</title><svg><p><style><iframe></style>`, exact: false },
  { html: `<title>t</title><math><annotation-xml encoding="text/html"><style><b></style><iframe></iframe></annotation-xml></math>`, exact: false },
  { html: `<title>t</title><svg><![CDATA[<iframe>]]></svg><![CDATA[<iframe>]]>`, exact: true },
  { html: `<title>t</title><svg><script>&#x66;etch(1)</script></svg>`, exact: true },
  { html: `<title>t</title><svg><a xlink:href="javascript:x"><text>x</text></a></svg>`, exact: true },
  // Where lol-html's foreign-content model differs from the tree builder's:
  // refused (each hides a script or a finding from a token stream).
  { html: `<title>t</title><svg><svg><p><style><!--</style><script>alert(1)</script>-->`, exact: false },
  { html: `<title>t</title><math/><textarea><!--</textarea><script>alert(1)</script>-->`, exact: false },
  { html: `<title>t</title><math><math/></math><xmp><![CDATA[</xmp><script>alert(1)</script>]]>`, exact: false },
  { html: `<title>t</title><svg><desc></svg></desc><style><iframe></iframe></style>`, exact: false },
  { html: `<title>t</title><svg><foreignObject><div>x</foreignObject><style><!--</style><script>alert(1)</script>-->`, exact: false },
  { html: `<title>t</title><math><mi><malignmark><title><a href=javascript:x>x</a></title>`, exact: false },
  { html: `<title>t</title><svg><foreignObject/><style><iframe></iframe></style></svg>`, exact: false },
  // ...and the plain SVG and MathML real pages use: read identically.
  {
    html: `<title>t</title><svg><g><foreignObject width="100" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">A &amp; B</span><br></div></foreignObject></g><svg x="10"><circle r="2"/></svg></svg><script>fetch(1)</script>`,
    exact: true
  },
  {
    html: `<title>t</title><math><semantics><mrow><mi>x</mi><mo>=</mo><msup><mi>y</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x=y^2</annotation></semantics></math><style><!--</style><p onclick="alert(1)">-->`,
    exact: true
  },
  { html: `<title>t</title><svg><style><![CDATA[.st0{fill:#fff}]]></style><rect class="st0"/><title>Bar &lt; 3</title></svg><script>if (a < b) localStorage.x = 1</script>`, exact: true },
  // Misnesting, foster parenting, merged tags.
  { html: `<title>t</title><table><tr><td>x</td><iframe></iframe></tr></table>`, exact: true },
  { html: `<title>t</title><table><a href="javascript:x">foster</a><tr><td>y</table>`, exact: true },
  { html: `<title>t</title><b><i><a href="javascript:x"><p>adoption</b></i></a>`, exact: true },
  { html: `<title>t</title><body onclick="go()"><body onload="fetch(1)">`, exact: true },
  { html: `<title>t</title><body onclick="go()"><body onclick="fetch(1)">`, exact: false },
  { html: `<html onclick="x"><title>t</title><html style="behavior:url(x)">`, exact: true },
  { html: `<title>t</title><form><form><iframe></iframe></form></form>`, exact: true },
  { html: `<title>t</title><p>a<p>b<li>c<li>d<dt>e<dd>f`, exact: true },
  { html: `<title>t</title><plaintext><iframe></iframe>`, exact: true },
  { html: `<title>t</title><textarea><iframe></iframe></textarea><xmp><script></xmp><noembed><iframe></noembed>`, exact: true },
  { html: `<title>t</title><iframe><script>alert(1)</script></iframe>`, exact: true },
  { html: `<title>t</title><a title="<script>alert(1)</script>">x</a><!-- <iframe> --><![CDATA[<iframe>]]>`, exact: true },
  { html: `<title>t</title><div title='x'onclick="fetch(1)">y</div><div/onclick="alert(1)">z</div>`, exact: true },
  { html: `<title>t\u0000x</title><a href="java\u0000script:x">nul</a>`, exact: true },
  { html: `<title>t</title><a href="\u000bjavascript:x">vt</a><a href="\u2028javascript:x">ls</a>`, exact: true },
  { html: `\ufeff<title>bom</title><a href="\ufeffjavascript:x">x</a>`, exact: true },
  { html: `<title>t</title><a href="&acutexpression(">x</a><div style="&acutexpression(1)">y</div>`, exact: true },
  { html: `<title>t</title><div style="ex&#x70;ression(1)">y</div><div style="url(&#106;avascript:x)">z</div>`, exact: true },
  { html: `<title>t</title><div style="expression&nbsp;(1)">y</div>`, exact: true },
  { html: `<meta charset="windows-1252"><title>caf\u00e9</title>`, exact: true },
  { html: `<title>t</title><image src="x.png"><svg><image href="y.png"/></svg>`, exact: true },
  { html: `<title>t</title><scr\u0130pt>alert(1)</scr\u0130pt><lin\u212a rel=stylesheet href=http://x>`, exact: true },
  { html: `<title>t</title>` + "<p>x".repeat(12000), exact: false }
];

const SOUP = [
  "<select>", "</select>", "<option>", "<template>", "</template>", '<template shadowrootmode="open">', "<col>", "<colgroup>",
  "<frameset>", "<svg>", "</svg>", "<math>", "</math>", "<mi>", "<foreignObject>", "<desc>", '<annotation-xml encoding="text/html">',
  "<noscript>", "</noscript>", "<style>", "</style>", "<title>", "</title>", "<textarea>", "</textarea>", "<xmp>", "</xmp>",
  "<noembed>", "</noembed>", "<noframes>", "</noframes>", "<script>", "</script>", '<script type="application/json">', "<!--", "-->",
  "<![CDATA[", "]]>", "<table>", "<tr>", "<td>", "</table>", "<p>", "</p>", "<b>", "</b>", "<i>", "<font color=red>", "<font>",
  '<div onclick="fetch(1)">', "</div>", "<iframe>", "</iframe>", '<a href="javascript:x">', "</a>", "<img src=x.png>",
  '"', "'", ">", '<a title="', "text", " ", "\n", '<body onload="alert(1)">', '<html onclick="localStorage">',
  "<image src=y.png>", "<link rel=stylesheet href=http://x>", '<meta http-equiv="refresh" content="0">', "<form>", "<br>",
  '<span style="width:expression(1)">', "<plaintext>", "</body>", "</html>", "<head>", "<frame src=javascript:x>", "<input>",
  "<li>", "<h1>", "</h1>", "<object>", "<svg><title>T</title></svg>", "&amp;", "&lt;", "<?pi?>", "<!doctype html>"
];

export function soupPage(r) {
  const parts = [];
  if (r.chance(0.7)) parts.push("<title>soup</title>");
  const n = 3 + r.int(25);
  for (let i = 0; i < n; i++) parts.push(r.pick(SOUP));
  return parts.join(r.chance(0.3) ? " " : "");
}

// Payloads parse5 always notices when they are read as markup.
const PAYLOADS = [
  "<script>fetch(1)</script>",
  "<iframe></iframe>",
  '<a href="javascript:x">x</a>',
  '<p style="width:expression(1)">x</p>',
  '<b onclick="alert(1)">x</b>',
  '<meta http-equiv="refresh" content="0">',
  "<style><!--</style><script>localStorage</script>-->",
  "<![CDATA[><script>alert(1)</script>]]>"
];

// A realistic page with soup and payloads spliced in at random points
// (inside tags, attribute values, scripts, and SVG included).
export function mutatedPage(r) {
  let html = realisticPage(r);
  const edits = 1 + r.int(4);
  for (let i = 0; i < edits; i++) {
    const at = r.int(html.length + 1);
    const insert = r.chance(0.5) ? r.pick(PAYLOADS) : r.pick(SOUP) + (r.chance(0.5) ? r.pick(PAYLOADS) : "");
    html = html.slice(0, at) + insert + html.slice(at);
  }
  return html;
}

export function corpus({ seed = 1, realistic = 400, soup = 600, mutated = 300 } = {}) {
  const r = rng(seed);
  return {
    realistic: Array.from({ length: realistic }, () => realisticPage(r)),
    tricky: TRICKY,
    soup: Array.from({ length: soup }, () => soupPage(r)),
    mutated: Array.from({ length: mutated }, () => mutatedPage(r))
  };
}
