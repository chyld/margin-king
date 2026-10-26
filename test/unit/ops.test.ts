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
  assert.equal(fmt("```\n«x»\n```", { type: "code" }), "«x»");
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

test("a toggle is decided once for the whole selection (code review r1)", () => {
  assert.equal(fmt("«a\n=={b}b==»", { type: "bold" }), "=={b}«a==\n=={b}b»==");
  assert.equal(fmt("«a\n=={lime}b==»", { type: "color", color: "lime" }), "=={lime}«a==\n=={lime}b»==");
});

test("formatting part of a link splits it into links to the same address (§13)", () => {
  assert.equal(fmt("[d«o»cs](https://a.com)", { type: "bold" }), "[d](https://a.com)=={b}[«o»](https://a.com)==[cs](https://a.com)");
});

test("a new bare-URL address is verified: explicit link if needed, else refused (code review r1)", () => {
  assert.equal(fmt("«https://ex.com/a»", { type: "link", url: "https://ex.com/b" }), "«https://ex.com/b»");
  assert.equal(fmt("«https://ex.com/a»", { type: "link", url: "https://ex.com/a==" }), "[«https://ex.com/a==»](https://ex.com/a==)");
  assert.equal(fmt("=={green}«https://ex.com/a»==", { type: "link", url: "https://ex.com/a==b" }), "=={green}[«https://ex.com/a==b»](https://ex.com/a==b)==");
});

test("a bare-URL address ending in = keeps its = (Kimi r1 #8)", () => {
  assert.equal(fmt("«https://a.com»", { type: "link", url: "https://b.com/?a=" }), "[«https://b.com/?a=»](https://b.com/?a=)");
  assert.equal(fmt("=={green}«https://a.com»==", { type: "link", url: "https://b.com/?a==b" }), "=={green}[«https://b.com/?a==b»](https://b.com/?a==b)==");
});

test("a link split by formatting acts as one link (DeepSeek r1 #6)", () => {
  const split = "[d](https://a.com)=={b}[o](https://a.com)==[cs](https://a.com)";
  const { text, from, to } = sel("«" + split + "»");
  assert.equal(formatState(formatCtx(text), from, to, false).link, "https://a.com");
  assert.equal(formatState(formatCtx(text), 1, 2, false).link, "https://a.com");
  const moved = fmt("[«d»](https://a.com)=={b}[o](https://a.com)==[cs](https://a.com)", { type: "link", url: "https://b.com" });
  assert.equal(moved, "[«d»](https://b.com)=={b}[o](https://b.com)==[cs](https://b.com)");
  const removed = fmt("[«d»](https://a.com)=={b}[o](https://a.com)==[cs](https://a.com)", { type: "link", url: "" });
  assert.equal(removed, "«d»=={b}o==cs");
});

// Fonts (architecture §15, Fonts).
const mono = (font: string | null): FormatOp => ({ type: "font", font, mono: true });
const other = (font: string | null): FormatOp => ({ type: "font", font, mono: false });

test("fonts: text takes any font; picking it again changes nothing; Default removes it", () => {
  assert.equal(fmt("a «word» b", other("inter")), "a =={font-inter}«word»== b");
  assert.equal(fmt("a «word» b", mono("fira-code")), "a =={font-fira-code}«word»== b");
  assert.equal(fmt("=={font-inter}«word»==", other("inter")), "=={font-inter}«word»==");
  assert.equal(fmt("=={lime+font-inter}«word»==", other(null)), "=={lime}«word»==");
  assert.equal(fmt("=={font-a}x«y»z==", other("b")), "=={font-a}x===={font-b}«y»===={font-a}z==");
  // Clear formatting removes fonts too.
  assert.equal(fmt("=={b+font-inter}«x»==", { type: "clear" }), "«x»");
});

test("fonts: other formatting keeps a font", () => {
  assert.equal(fmt("=={font-inter}«x»==", { type: "bold" }), "=={b+font-inter}«x»==");
  assert.equal(fmt("=={font-inter}«x»==", { type: "color", color: "lime" }), "=={lime+font-inter}«x»==");
  assert.equal(fmt("=={lime+font-inter}«x»==", { type: "removeColor" }), "=={font-inter}«x»==");
  assert.equal(fmt("=={font-inter}«x»==", { type: "link", url: "https://a.com" }), "=={font-inter}[«x»](https://a.com)==");
  assert.equal(fmt("=={font-inter}«x»==", { type: "code" }), "=={font-inter}`«x»`==");
  assert.equal(fmt("## {red} =={font-inter}«T»==", { type: "color", color: "lime" }), "## {lime} =={font-inter}«T»==");
});

test("fonts: inline code only takes monospace fonts", () => {
  // An "other" font skips the code; a monospace font is applied to all of it.
  assert.equal(fmt("«see `x` here»", other("inter")), "=={font-inter}«see ==`x`=={font-inter} here»==");
  assert.equal(fmt("«see `x` here»", mono("fira-code")), "=={font-fira-code}«see `x` here»==");
  assert.equal(fmt("«`x`»", other("inter")), "refused:cant");
  assert.equal(fmt("=={font-fira-code}«`x`»==", other(null)), "`«x»`");
});

test("fonts: code blocks get a monospace font on the opening fence", () => {
  assert.equal(fmt("```\n«x»\n```", mono("fira-code")), "```font-fira-code\n«x»\n```");
  assert.equal(fmt("```python font-a\n«x»\n```", mono("b")), "```python font-b\n«x»\n```");
  assert.equal(fmt("```font-a\n«x»\n```", other(null)), "```\n«x»\n```");
  assert.equal(fmt("```\n«x»\n```", other("inter")), "refused:cant");
  // A cursor in a block, with the bar pinned; and every block a selection touches.
  assert.equal(fmt("```\nx‸\n```", mono("a"), true), "```font-a\nx‸\n```");
  assert.equal(fmt("```\n«a\n```\n```\nb»\n```", mono("c")), "```font-c\n«a\n```\n```font-c\nb»\n```");
});

test("fonts: text and blocks together each take what they can", () => {
  assert.equal(fmt("«intro\n```\nx»\n```", other("inter")), "=={font-inter}«intro==\n```\nx»\n```");
  assert.equal(fmt("«intro\n```\nx»\n```", mono("a")), "=={font-a}«intro==\n```font-a\nx»\n```");
  assert.equal(fmt("=={font-a}«intro==\n```font-a\nx»\n```", mono(null)), "«intro\n```\nx»\n```");
});

test("fonts: links split, bare URLs refuse, the pinned bar takes the word", () => {
  assert.equal(fmt("[a «bc»](https://a.com)", other("inter")), "[a ](https://a.com)=={font-inter}[«bc»](https://a.com)==");
  assert.equal(fmt("https://a.«com»", other("inter")), "refused:cant");
  assert.equal(fmt("one tw‸o", other("inter"), true), "one =={font-inter}two‸==");
  assert.equal(fmt("‸", other("inter"), true), "refused:select");
});

test("fonts: formatState reports the font, mixed fonts and code-only targets", () => {
  const st = (s: string, pinned = false) => {
    const { text, from, to } = sel(s);
    const f = formatState(formatCtx(text), from, to, pinned);
    return { font: f.font, mixed: f.fontMixed, codeOnly: f.codeOnly, fontable: f.fontable };
  };
  assert.deepEqual(st("«plain»"), { font: null, mixed: false, codeOnly: false, fontable: true });
  assert.deepEqual(st("=={font-a}«x»=="), { font: "a", mixed: false, codeOnly: false, fontable: true });
  assert.deepEqual(st("«=={font-a}x== =={font-b}y==»"), { font: null, mixed: true, codeOnly: false, fontable: true });
  // The text's font counts, not the code it skipped.
  assert.deepEqual(st("=={font-inter}«see ==`x`=={font-inter} here»=="), { font: "inter", mixed: false, codeOnly: false, fontable: true });
  assert.deepEqual(st("«`x`»"), { font: null, mixed: false, codeOnly: true, fontable: true });
  assert.deepEqual(st("```font-a\n«x»\n```"), { font: "a", mixed: false, codeOnly: true, fontable: true });
  assert.deepEqual(st("```font-a\nx‸\n```", true), { font: "a", mixed: false, codeOnly: true, fontable: true });
  assert.deepEqual(st("«![](a7p2xq9d.png)»"), { font: null, mixed: false, codeOnly: false, fontable: false });
  // A cursor in a block is a target for the pinned bar.
  const { text, from, to } = sel("```\nx‸\n```");
  assert.equal(formatState(formatCtx(text), from, to, true).hasTarget, true);
});

test("fonts: a selection ending at the start of the next line keeps the block it covers (Sol code r1 #3)", () => {
  assert.equal(fmt("«intro\n```\nx\n```\n»end", mono("a")), "=={font-a}«intro==\n```font-a\nx\n```\n»end");
  assert.equal(fmt("intro«\n```\nx\n```\nend»", mono("a")), "intro«\n```font-a\nx\n```\n=={font-a}end»==");
});

test("fonts: formatState lists every font stored in the target, for the Font button (Sol code r1 #4)", () => {
  const { text, from, to } = sel("«plain =={font-a}x==\n```font-gone\ny»\n```");
  assert.deepEqual(formatState(formatCtx(text), from, to, false).fonts, ["a", "gone"]);
});
