import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFormat, formatCtx, formatState, type FormatOp } from "../../src/shared/ops.ts";
import { applyChanges } from "../../src/shared/model.ts";

// «…» marks the selection; ‸ an empty caret (used with the pinned bar).
function sel(s: string) {
  if (s.includes("‸")) {
    const at = s.indexOf("‸");
    return { text: s.replace("‸", ""), from: at, to: at };
  }
  const a = s.indexOf("«");
  const b = s.indexOf("»") - 1;
  return { text: s.replace("«", "").replace("»", ""), from: a, to: b };
}

function fmt(s: string, op: FormatOp, pinned = false): string {
  const { text, from, to } = sel(s);
  const r = applyFormat(formatCtx(text), from, to, op, pinned);
  if (!r.ok) return `refused:${r.reason}`;
  const out = applyChanges(text, r.changes);
  const [a, b] = [Math.min(r.anchor, r.head), Math.max(r.anchor, r.head)];
  return a === b ? out.slice(0, a) + "‸" + out.slice(a) : out.slice(0, a) + "«" + out.slice(a, b) + "»" + out.slice(b);
}

test("bold and underline toggle across the selection", () => {
  assert.equal(fmt("a «word» b", { type: "bold" }), "a =={b}«word»== b");
  assert.equal(fmt("a =={b}«word»== b", { type: "bold" }), "a «word» b");
  assert.equal(fmt("«a =={b}word==»", { type: "bold" }), "=={b}«a word»==");
  assert.equal(fmt("=={green}«x»==", { type: "underline" }), "=={green+u}«x»==");
});

test("colors set, toggle off and are removed", () => {
  assert.equal(fmt("«x»", { type: "color", color: "lime" }), "=={lime}«x»==");
  assert.equal(fmt("=={lime}«x»==", { type: "color", color: "lime" }), "«x»");
  assert.equal(fmt("=={lime+b}«x»==", { type: "removeColor" }), "=={b}«x»==");
  assert.equal(fmt("=={lime+b+u}«x `c`»==", { type: "clear" }), "«x c»");
});

test("formatting part of a token splits it, keeping untouched bytes", () => {
  assert.equal(fmt("=={u+lime}ab«cd»==", { type: "bold" }), "=={u+lime}ab===={lime+b+u}«cd»==");
});

test("inline code toggles on one line, skipping link text", () => {
  assert.equal(fmt("a «b c» d", { type: "code" }), "a `«b c»` d");
  assert.equal(fmt("a `«b c»` d", { type: "code" }), "a «b c» d");
  assert.equal(fmt("«see [docs](https://a.com)»", { type: "code" }), "`«see `[docs»](https://a.com)");
});

test("code across lines wraps, and touching a block unwraps it", () => {
  assert.equal(fmt("«a\n=={b}b==»", { type: "code" }), "```\n«a\nb»\n```");
  assert.equal(fmt("```\n«x»\n```", { type: "code" }), "‸x");
  assert.equal(fmt("«a\n```»", { type: "code" }), "refused:cant");
});

test("section adds and removes a heading", () => {
  assert.equal(fmt("  «Title»", { type: "section" }), "## {blue-deep} «Title»");
  assert.equal(fmt("## {red} «Title»", { type: "section" }), "«Title»");
  assert.equal(fmt("‸", { type: "section" }), "refused:select");
});

test("on a heading, a swatch recolors the section", () => {
  assert.equal(fmt("## {red} «Ti=={green}tle==»", { type: "color", color: "blue" }), "## {blue} «Title»");
  assert.equal(fmt("## {red} «Title»", { type: "color", color: "red" }), "## {red} «Title»");
  const st = formatState(formatCtx("## {red} Title"), 9, 14, false);
  assert.equal(st.color, "red");
  assert.equal(st.section, true);
});

test("links: set, edit, remove; bare URLs", () => {
  assert.equal(fmt("see «docs»", { type: "link", url: "https://a.com" }), "see [«docs»](https://a.com)");
  assert.equal(fmt("[«docs»](https://a.com)", { type: "link", url: "https://b.com" }), "[«docs»](https://b.com)");
  assert.equal(fmt("[«docs»](https://a.com)", { type: "link", url: "" }), "«docs»");
  assert.equal(fmt("«https://a.com»", { type: "link", url: "https://b.com" }), "«https://b.com»");
  assert.equal(fmt("«https://a.com»", { type: "link", url: "" }), "refused:cant");
  assert.equal(formatState(formatCtx("x https://a.com y"), 2, 15, false).link, "https://a.com");
});

test("refusals: things that can't be written down", () => {
  assert.equal(fmt("https://exa«mple».com", { type: "bold" }), "refused:cant");
  assert.equal(fmt("`a «b»", { type: "code" }), "refused:cant");
  assert.equal(fmt("«a=»", { type: "bold" }), "refused:cant");
});

test("the pinned bar applies to the word at the cursor", () => {
  assert.equal(fmt("wrist exer‸cises", { type: "bold" }, true), "wrist =={b}exercises‸==");
  assert.equal(fmt("a ‸ b", { type: "bold" }, true), "refused:select");
});

test("formatting skips code, fence and screenshot lines", () => {
  assert.equal(fmt("«a\n![](a7p2xq9d.png)\nb»", { type: "bold" }), "=={b}«a==\n![](a7p2xq9d.png)\n=={b}b»==");
});
