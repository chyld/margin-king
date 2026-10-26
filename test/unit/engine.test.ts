import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backspace,
  copyText,
  del,
  deleteRange,
  deleteUnit,
  enter,
  insertText,
  makeCtx,
  transpose,
  type EditResult,
} from "../../src/client/editor/engine.ts";
import { applyChanges } from "../../src/shared/model.ts";

// Notation: ‸ is the caret, «…» a selection.
function parse(s: string): { text: string; from: number; to: number } {
  if (s.includes("‸")) {
    const at = s.indexOf("‸");
    return { text: s.replace("‸", ""), from: at, to: at };
  }
  const a = s.indexOf("«");
  const b = s.indexOf("»") - 1;
  return { text: s.replace("«", "").replace("»", ""), from: a, to: b };
}

function show(text: string, r: EditResult | null): string {
  if (!r) return "(nothing)";
  const out = applyChanges(text, r.changes);
  return out.slice(0, r.head) + "‸" + out.slice(r.head);
}

const ctxOf = (text: string, collapsed: string[] = []) => makeCtx(text, new Set(collapsed));

function bs(s: string, collapsed: string[] = []): string {
  const { text, from } = parse(s);
  return show(text, backspace(ctxOf(text, collapsed), from));
}
function dl(s: string): string {
  const { text, from } = parse(s);
  return show(text, del(ctxOf(text), from));
}
function type(s: string, t: string, mode: "type" | "paste" = "type"): string {
  const { text, from, to } = parse(s);
  return show(text, insertText(ctxOf(text), from, to, t, mode));
}
function ent(s: string, split = false): string {
  const { text, from, to } = parse(s);
  return show(text, enter(ctxOf(text), from, to, split));
}
function cut(s: string): string {
  const { text, from, to } = parse(s);
  return show(text, deleteRange(ctxOf(text), from, to));
}

test("typing at the end of a highlight extends it; after the marker it doesn't", () => {
  assert.equal(type("=={green}wrist‸==", "s"), "=={green}wrists‸==");
  assert.equal(type("=={green}wrist==‸", "!"), "=={green}wrist==!‸");
  assert.equal(type("=={u+lime}abc‸==", "d"), "=={u+lime}abcd‸==");
  assert.equal(type("`code‸`", "x"), "`codex‸`");
  assert.equal(type("[docs‸](https://a.com)", "s"), "[docss‸](https://a.com)");
});

test("backspace and delete step over hidden syntax", () => {
  assert.equal(bs("=={green}wrist==‸ ex"), "=={green}wris==‸ ex");
  assert.equal(bs("=={green}wrist‸=="), "=={green}wris‸==");
  assert.equal(dl("‸=={green}wrist=="), "‸=={green}rist==");
  assert.equal(bs("`ab`‸"), "`a`‸");
  assert.equal(bs("[docs](https://a.com)‸"), "[doc](https://a.com)‸");
});

test("a token left with no visible characters disappears", () => {
  assert.equal(bs("a =={b}x==‸ b"), "a ‸ b");
  assert.equal(dl("a ‸`x` b"), "a ‸ b");
  assert.equal(bs("[d](https://a.com)‸"), "‸");
  assert.equal(cut("x «=={b}ab==» y"), "x ‸ y");
  assert.equal(cut("x =={b}«ab»== y"), "x ‸ y");
});

test("emoji are deleted as one grapheme", () => {
  assert.equal(bs("a👩‍💻‸b"), "a‸b");
  assert.equal(dl("=={b}‸👍==x"), "‸x");
});

test("headings: Backspace at the start, emptied text, leading space", () => {
  assert.equal(bs("## {red} ‸Title"), "‸Title");
  assert.equal(bs("## {red} =={b}‸Hi=="), "=={b}‸Hi==");
  assert.equal(bs("## {red} x‸"), "‸");
  assert.equal(bs("## {red} A‸ b"), "## {red} ‸b");
  assert.equal(type("## {red} ‸Ab", " "), "## {red} ‸Ab");
  assert.equal(cut("## {red} «Ab» cd"), "## {red} ‸cd");
});

test("headings: Enter at the start of the text breaks before the line", () => {
  assert.equal(ent("## {red} ‸Title"), "\n## {red} ‸Title");
  assert.equal(ent("## {blue-deep} =={green}‸abc=="), "\n## {blue-deep} =={green}‸abc==");
  assert.equal(ent("## {red} Ti‸tle"), "## {red} Ti\n‸tle");
  assert.equal(ent("## {red} Title‸"), "## {red} Title\n‸");
});

test("screenshot lines", () => {
  assert.equal(bs("a\n![](a7p2xq9d.png)\n‸b"), "a\n‸b");
  assert.equal(bs("a\n![](a7p2xq9d.png)‸\nb"), "a\n‸b");
  assert.equal(dl("a‸\n![](a7p2xq9d.png)\nb"), "a‸\nb");
  assert.equal(dl("a\n‸![](a7p2xq9d.png)\nb"), "a\n‸b");
  assert.equal(bs("a\n‸![](a7p2xq9d.png)"), "a‸\n![](a7p2xq9d.png)");
  assert.equal(ent("‸![](a7p2xq9d.png)"), "\n‸![](a7p2xq9d.png)");
  assert.equal(ent("![](a7p2xq9d.png)‸"), "![](a7p2xq9d.png)\n‸");
  assert.equal(type("![](a7p2xq9d.png)‸", "hi"), "![](a7p2xq9d.png)\nhi‸");
  assert.equal(type("‸![](a7p2xq9d.png)", "hi"), "hi‸\n![](a7p2xq9d.png)");
});

test("joins", () => {
  assert.equal(bs("abc\n‸def"), "abc‸def");
  assert.equal(dl("abc‸\ndef"), "abc‸def");
  assert.equal(bs("## {red} T\n‸x"), "## {red} T‸x");
  assert.equal(bs("```\nx\n```\n‸y"), "```\nx\n```‸\ny");
  assert.equal(bs("```\n‸x\n```"), "```‸\nx\n```");
  assert.equal(bs("```\na\n‸b\n```"), "```\na‸b\n```");
  assert.equal(dl("x‸\n## {red} T"), "x\n## {red} ‸T");
  // An empty line simply goes, whatever its neighbor is.
  assert.equal(bs("```\nx\n```\n‸"), "```\nx\n```‸");
  assert.equal(dl("‸\n## {red} T"), "## {red} ‸T");
  // Right after a screenshot, Backspace deletes the screenshot, even from an empty line.
  assert.equal(bs("![](a7p2xq9d.png)\n‸\ny"), "‸\ny");
  assert.equal(bs("x\n\n‸y"), "x\n‸y");
  // A join that would pair syntax across the two lines is refused.
  assert.equal(bs("x =={red}\n‸y=="), "x =={red}‸\ny==");
});

test("Enter splits tokens and reopens them", () => {
  assert.equal(ent("=={green}wri‸st=="), "=={green}wri==\n=={green}‸st==");
  assert.equal(ent("=={green}wrist‸=="), "=={green}wrist==\n‸");
  assert.equal(ent("‸=={green}wrist=="), "\n‸=={green}wrist==");
  assert.equal(ent("[the d‸ocs](https://a.com)"), "[the d](https://a.com)\n[‸ocs](https://a.com)");
  assert.equal(ent("https://exa‸mple.com"), "[https://exa](https://example.com)\n‸[mple.com](https://example.com)");
  assert.equal(ent("```\n  x‸\n```"), "```\n  x\n‸\n```");
  assert.equal(ent("=={b}ab‸cd==", true), "=={b}ab‸==\n=={b}cd==");
});

test("typed syntax splits the token around it", () => {
  assert.equal(type("[d‸ocs](https://a.com)", "]"), "[d](https://a.com)]‸[ocs](https://a.com)");
  assert.equal(type("`a‸b`", "`"), "`a``‸`b`");
  assert.equal(type("=={b}x ‸==", "="), "=={b}x ===‸");
});

test("pasted text: plain inherits, syntax is inserted raw between the halves", () => {
  assert.equal(type("=={green}a‸bc==", "XY", "paste"), "=={green}aXY‸bc==");
  assert.equal(type("=={green}a‸bc==", "=={red}x==", "paste"), "=={green}a===={red}x==‸=={green}bc==");
  assert.equal(type("=={green}HEL‸LO==", "x\ny", "paste"), "=={green}HELx==\n=={green}y‸LO==");
});

test("typing over a selection keeps the first selected character's style", () => {
  assert.equal(type("=={green}«teh»==", "the"), "=={green}the‸==");
  assert.equal(type("## {red} «Goals»", "Plans"), "## {red} Plans‸");
  assert.equal(type("[«docs»](https://a.com)", "help"), "[help‸](https://a.com)");
});

test("range deletions", () => {
  // The selection started inside the highlight, so the caret stays inside it.
  assert.equal(cut("=={green}wri«st== and pla»in"), "=={green}wri‸==in");
  assert.equal(cut("ab«c\n## {red} De»f"), "ab‸f");
  assert.equal(cut("Intro«\n»![](a7p2xq9d.png)"), "Intro‸\n![](a7p2xq9d.png)");
  assert.equal(cut("intro te«xt\n```\ncode li»ne one\n```"), "intro te‸\n```\nne one\n```");
  assert.equal(cut("«a\nb\n»c"), "‸c");
  assert.equal(cut("a«\nb\nc»"), "a‸");
});

test("word and line deletion over visible text", () => {
  const unit = (s: string, u: "word" | "line", d: "backward" | "forward") => {
    const { text, from } = parse(s);
    return show(text, deleteUnit(ctxOf(text), from, u, d));
  };
  assert.equal(unit("=={green}hello wor‸ld==", "word", "backward"), "=={green}hello ‸ld==");
  assert.equal(unit("=={green}hello  ‸x==", "word", "backward"), "=={green}hello‸x==");
  assert.equal(unit("=={green}hello‸x==", "word", "backward"), "=={green}‸x==");
  assert.equal(unit("=={green}hel‸lo== world", "line", "forward"), "=={green}hel‸==");
  assert.equal(unit("a\n‸b", "word", "backward"), "a‸b");
});

test("transpose swaps visible characters", () => {
  const tr = (s: string) => {
    const { text, from } = parse(s);
    return show(text, transpose(ctxOf(text), from));
  };
  assert.equal(tr("ab‸c"), "acb‸");
  assert.equal(tr("=={b}a==‸b"), "b=={b}a‸==");
});

test("collapsed sections expand when Backspace reaches into them", () => {
  const text = "## {red} T\nbody";
  const r = backspace(ctxOf(text, ["## {red} T"]), text.length);
  assert.deepEqual(r?.expand, ["## {red} T"]);
});

test("copy writes balanced syntax for partial lines", () => {
  const cp = (s: string) => {
    const { text, from, to } = parse(s);
    return copyText(ctxOf(text), from, to);
  };
  assert.equal(cp("=={green}w«rist» exercises=="), "=={green}rist==");
  assert.equal(cp("=={green}wrist «exercises==\nhello»"), "=={green}exercises==\nhello");
  assert.equal(cp("```\nfo«o b»ar\n```"), "o b");
  assert.equal(cp("«## {red} Head»"), "## {red} Head");
});
