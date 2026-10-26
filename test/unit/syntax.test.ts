import { test } from "node:test";
import assert from "node:assert/strict";
import { fenceFont, parseDoc, parseInline, parseOptions, serializeOptions, withFenceFont, type Token } from "../../src/shared/syntax.ts";
import { noteTitle, stripInline, visibleText } from "../../src/shared/text.ts";

function shape(tokens: Token[], s: string): unknown[] {
  return tokens.map((t) => {
    const base: Record<string, unknown> = { type: t.type, text: s.slice(t.contentFrom, t.contentTo) };
    if (t.opts) base.opts = serializeOptions(t.opts);
    if (t.url) base.url = t.url;
    if (t.children?.length) base.children = shape(t.children, s);
    return base;
  });
}

const inline = (s: string) => shape(parseInline(s), s);

test("highlights: options, bold, underline", () => {
  assert.deepEqual(inline("=={green}wrist exercises=="), [{ type: "hl", text: "wrist exercises", opts: "green" }]);
  assert.deepEqual(inline("=={amber-deep}yells=="), [{ type: "hl", text: "yells", opts: "amber-deep" }]);
  assert.deepEqual(inline("=={b}together=="), [{ type: "hl", text: "together", opts: "b" }]);
  assert.deepEqual(inline("=={u}duplicates=="), [{ type: "hl", text: "duplicates", opts: "u" }]);
  assert.deepEqual(inline("=={lime+b+u}yearbook=="), [{ type: "hl", text: "yearbook", opts: "lime+b+u" }]);
  // Any order is accepted; Margin writes color, b, u.
  assert.deepEqual(inline("=={u+lime}x=="), [{ type: "hl", text: "x", opts: "lime+u" }]);
  assert.equal(parseInline("=={u+lime}x==")[0].optsText, "u+lime");
});

test("highlights that stay literal", () => {
  for (const s of [
    "=={lime+lime}x==", // repeated option
    "=={b+b}x==",
    "=={red+blue}x==", // two colors
    "=={purple}x==", // unknown color
    "=={}x==",
    "=={green}==", // empty
    "=={green}x", // no closing ==
    "== stray",
    "=={+}x==",
  ]) {
    const tokens = parseInline(s).filter((t) => t.type === "hl");
    assert.equal(tokens.length, 0, s);
  }
});

test("the §6.2 worked examples", () => {
  assert.deepEqual(inline("=={green}=={b}abc=="), [{ type: "hl", text: "abc", opts: "b" }]);
  assert.deepEqual(inline("=={green}a`==`b=="), [
    { type: "hl", text: "a`==`b", opts: "green", children: [{ type: "code", text: "==" }] },
  ]);
  assert.deepEqual(inline("=={green}https://x.com?q=a==b=="), [
    { type: "hl", text: "https://x.com?q=a", opts: "green", children: [{ type: "url", text: "https://x.com?q=a", url: "https://x.com?q=a" }] },
  ]);
});

test("inline code is literal and needs content", () => {
  assert.deepEqual(inline("a `code` b"), [{ type: "code", text: "code" }]);
  assert.deepEqual(inline("`=={green}x==`"), [{ type: "code", text: "=={green}x==" }]);
  assert.deepEqual(inline("``"), []);
  assert.deepEqual(inline("` alone"), []);
  assert.deepEqual(inline("`a``b`"), [
    { type: "code", text: "a" },
    { type: "code", text: "b" },
  ]);
});

test("links and bare URLs", () => {
  assert.deepEqual(inline("see https://example.com."), [{ type: "url", text: "https://example.com", url: "https://example.com" }]);
  assert.deepEqual(inline("[the docs](https://example.com/docs)"), [
    { type: "link", text: "the docs", url: "https://example.com/docs" },
  ]);
  // Not directly after a letter, digit or slash.
  assert.deepEqual(inline("xhttps://example.com"), []);
  assert.deepEqual(inline("/https://example.com"), []);
  // Parentheses end a URL.
  assert.deepEqual(inline("(https://example.com)"), [{ type: "url", text: "https://example.com", url: "https://example.com" }]);
  // Trailing punctuation isn't part of it.
  assert.deepEqual(inline("https://a.com/x!?;"), [{ type: "url", text: "https://a.com/x", url: "https://a.com/x" }]);
  // Link text can't contain ] and URLs inside code aren't links.
  assert.deepEqual(inline("`https://a.com`"), [{ type: "code", text: "https://a.com" }]);
  assert.deepEqual(inline("[](https://a.com)"), [{ type: "url", text: "https://a.com", url: "https://a.com" }]);
  assert.deepEqual(inline("[a](ftp://a.com)"), []);
  assert.deepEqual(inline("https://"), []);
});

test("a whole link can sit inside a highlight", () => {
  assert.deepEqual(inline("=={b}[docs](https://a.com)=="), [
    { type: "hl", text: "[docs](https://a.com)", opts: "b", children: [{ type: "link", text: "docs", url: "https://a.com" }] },
  ]);
  // == inside link URL is skipped while looking for the closing ==.
  assert.deepEqual(inline("=={b}[x](https://a.com/?a==b)=="), [
    { type: "hl", text: "[x](https://a.com/?a==b)", opts: "b", children: [{ type: "link", text: "x", url: "https://a.com/?a==b" }] },
  ]);
});

test("options round trip", () => {
  assert.deepEqual(parseOptions("lime+b+u"), { color: "lime", b: true, u: true, font: null });
  assert.equal(parseOptions("b+lime+b"), null);
  assert.equal(serializeOptions({ color: "red-deep", b: false, u: true, font: null }), "red-deep+u");
});

test("parseDoc: code blocks, headings, screenshots, sections", () => {
  const doc = parseDoc(
    [
      "Title",
      "## {green-deep} Notes",
      "```js",
      "## {red} not a heading",
      "![](a7p2xq9d.png)",
      "```  ",
      "![](a7p2xq9d.png)",
      "## {blue} Next",
      "end",
    ].join("\n"),
  );
  assert.deepEqual(
    doc.lines.map((l) => l.kind),
    ["text", "heading", "fence-open", "code", "code", "fence-close", "image", "heading", "text"],
  );
  assert.deepEqual(doc.blocks, [{ open: 2, close: 5, font: null }]);
  assert.deepEqual(doc.sections, [
    { heading: 1, end: 6, color: "green-deep" },
    { heading: 7, end: 8, color: "blue" },
  ]);
  assert.equal(doc.lines[1].prefixLen, "## {green-deep} ".length);
  assert.equal(doc.lines[6].image, "a7p2xq9d.png");
  assert.equal(doc.lines[0].section, undefined);
});

test("parseDoc: unclosed fences stay plain, openers start with ```", () => {
  assert.deepEqual(
    parseDoc("```\nnot code\n## {red} heading").lines.map((l) => l.kind),
    ["text", "text", "heading"],
  );
  assert.deepEqual(parseDoc("````\nx\n```").lines.map((l) => l.kind), ["fence-open", "code", "fence-close"]);
  assert.deepEqual(parseDoc("```a`b\nx\n```").lines.map((l) => l.kind), ["fence-open", "code", "fence-close"]);
  // A closing line is exactly ``` plus trailing spaces.
  assert.deepEqual(parseDoc("```\nx\n``` y").lines.map((l) => l.kind), ["text", "text", "text"]);
});

test("headings that stay literal", () => {
  for (const s of ["##  {red} x", "## {red}x", "## {red} ", "## {purple} x", "### {red} x", " ## {red} x", "## {red}  x"]) {
    assert.equal(parseDoc(s).lines[0].kind, "text", s);
  }
});

test("screenshots need the whole line", () => {
  for (const s of ["![](a7p2xq9d.png) ", "x ![](a7p2xq9d.png)", "![](A7P2XQ9D.png)", "![](a7p2xq9.png)", "![x](a7p2xq9d.png)"]) {
    assert.equal(parseDoc(s).lines[0].kind, "text", s);
  }
});

test("CRLF is normalized", () => {
  const doc = parseDoc("## {red} A\r\nb\rc");
  assert.deepEqual(doc.lines.map((l) => l.text), ["## {red} A", "b", "c"]);
  assert.equal(doc.lines[0].kind, "heading");
});

test("visible text, titles", () => {
  assert.equal(stripInline("=={green}wrist== and `code` and [docs](https://a.com)"), "wrist and code and docs");
  assert.equal(visibleText("## {red} =={b}Head==\n```\ncode =={x}\n```\n![](a7p2xq9d.png)\nhttps://a.com"), "Head\n\ncode =={x}\n\n\nhttps://a.com");
  assert.equal(noteTitle("## {green-deep} =={b}Notes App==\nbody"), "Notes App");
  assert.equal(noteTitle("\nbody"), "");
  assert.equal(noteTitle("```js\ncode\n```"), "");
  assert.equal(noteTitle("```js\nnever closed"), "```js");
  assert.equal(noteTitle("![](a7p2xq9d.png)"), "");
  assert.equal(noteTitle("  spaced  "), "spaced");
});

test("screenshot lines may carry a width of 10–100% (owner decision)", async () => {
  const { imageLine, matchImage } = await import("../../src/shared/syntax.ts");
  assert.deepEqual(matchImage("![](a7p2xq9d.png)"), { name: "a7p2xq9d.png", width: null });
  assert.deepEqual(matchImage("![60%](a7p2xq9d.png)"), { name: "a7p2xq9d.png", width: 60 });
  assert.deepEqual(matchImage("![10%](a7p2xq9d.png)"), { name: "a7p2xq9d.png", width: 10 });
  assert.deepEqual(matchImage("![100%](a7p2xq9d.png)"), { name: "a7p2xq9d.png", width: 100 });
  for (const bad of ["![5%](a7p2xq9d.png)", "![101%](a7p2xq9d.png)", "![060%](a7p2xq9d.png)", "![60](a7p2xq9d.png)", "![60 %](a7p2xq9d.png)", "x ![60%](a7p2xq9d.png)"]) {
    assert.equal(matchImage(bad), null, bad);
  }
  assert.equal(imageLine("a7p2xq9d.png", 45), "![45%](a7p2xq9d.png)");
  assert.equal(imageLine("a7p2xq9d.png", null), "![](a7p2xq9d.png)");
  const doc = parseDoc("a\n![45%](a7p2xq9d.png)\n```\n![45%](a7p2xq9d.png)\n```");
  assert.equal(doc.lines[1].kind, "image");
  assert.equal(doc.lines[1].imageWidth, 45);
  assert.equal(doc.lines[3].kind, "code");
  assert.equal(noteTitle("![45%](a7p2xq9d.png)\nNext"), noteTitle("![](a7p2xq9d.png)\nNext"));
  assert.equal(visibleText("![45%](a7p2xq9d.png)"), visibleText("![](a7p2xq9d.png)"));
});

test("imageLine always writes a line the parser reads back (MiniMax resize #5)", async () => {
  const { imageLine, matchImage } = await import("../../src/shared/syntax.ts");
  for (const [w, out] of [[5, 10], [10, 10], [45.6, 46], [100, 100], [101, 100]] as const) {
    assert.equal(imageLine("a7p2xq9d.png", w), `![${out}%](a7p2xq9d.png)`);
    assert.deepEqual(matchImage(imageLine("a7p2xq9d.png", w)), { name: "a7p2xq9d.png", width: out });
  }
});

test("fonts: a highlight option font-<id> (architecture §15, Fonts)", () => {
  assert.deepEqual(parseOptions("font-inter"), { color: null, b: false, u: false, font: "inter" });
  assert.deepEqual(parseOptions("u+font-jetbrains-mono+lime"), { color: "lime", b: false, u: true, font: "jetbrains-mono" });
  assert.equal(serializeOptions({ color: "lime", b: true, u: true, font: "fira-code" }), "lime+b+u+font-fira-code");
  // At most one font; ids are lower-case words joined by single hyphens, at most 48 characters.
  for (const bad of ["font-a+font-b", "font-", "font--a", "font-a-", "font-A", `font-${"a".repeat(49)}`]) {
    assert.equal(parseOptions(bad), null, bad);
  }
  assert.equal(parseOptions(`font-${"a".repeat(48)}`)?.font, "a".repeat(48));
  assert.equal(parseOptions(`font-${"a".repeat(46)}-b`)?.font, `${"a".repeat(46)}-b`);
  // Any well-formed id parses, installed or not; the server doesn't know the font list.
  assert.deepEqual(inline("=={font-nowhere-2}x=="), [{ type: "hl", text: "x", opts: "font-nowhere-2" }]);
});

test("fonts: a code block's font is a word on its opening fence", () => {
  const blockFont = (fence: string) => parseDoc(`${fence}\nx\n\`\`\``).blocks[0]?.font;
  assert.equal(blockFont("```font-fira-code"), "fira-code");
  assert.equal(blockFont("```python font-fira-code"), "fira-code");
  assert.equal(blockFont("```  font-a  font-b "), "a");
  assert.equal(blockFont("```python"), null);
  assert.equal(blockFont("```font-Inter"), null);
  assert.equal(blockFont("```x-font-a"), null);
  assert.equal(blockFont(`\`\`\`font-${"a".repeat(60)}`), null);
  assert.equal(fenceFont("````font-a"), null);
  // Setting replaces every font word; Default removes them; the rest of the line is kept.
  assert.equal(withFenceFont("```", "fira-code"), "```font-fira-code");
  assert.equal(withFenceFont("```python  ", "fira-code"), "```python font-fira-code");
  assert.equal(withFenceFont("```font-a python font-b", "c"), "```python font-c");
  assert.equal(withFenceFont("```font-a python", null), "```python");
  assert.equal(withFenceFont("```python  font-a  x", null), "```python  x");
  assert.equal(withFenceFont("```python font-a", null), "```python");
  assert.equal(withFenceFont("```font-a", null), "```");
  assert.equal(withFenceFont("```font-Inter", null), "```font-Inter");
});
