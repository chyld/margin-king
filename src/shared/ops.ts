// Formatting operations (architecture §6.4, README §3.6): pure, verified, refused when the result
// can't be written down without an escape character.

import { analyze, lineAt, type Analysis } from "./analysis.ts";
import {
  applyChanges,
  buildRow,
  chars,
  charsOfLine,
  freshId,
  piecesToChanges,
  mapThrough,
  sameVisible,
  serializeRows,
  setStyle,
  splitLinksAtStyleBoundaries,
  UNSTYLED,
  type Change,
  type LinkRef,
  type Row,
  type VChar,
} from "./model.ts";
import { DEFAULT_SECTION_COLOR, isColor } from "./palette.ts";
import { CLOSE_FENCE_RE, withFenceFont, type Line } from "./syntax.ts";
import { lineVisibleText } from "./text.ts";

export interface FormatCtx {
  text: string;
  a: Analysis;
}

export type FormatOp =
  | { type: "bold" }
  | { type: "underline" }
  | { type: "color"; color: string }
  | { type: "removeColor" }
  | { type: "clear" }
  | { type: "code" }
  | { type: "section" }
  | { type: "link"; url: string }
  | FontOp;

/** A font (architecture §15, Fonts); `font: null` is Default. `mono` says whether it's a monospace
 *  font, the only kind code takes. */
export interface FontOp {
  type: "font";
  font: string | null;
  mono: boolean;
}

export type Refusal = "cant" | "select";

export type FormatResult =
  | { ok: true; changes: Change[]; anchor: number; head: number }
  | { ok: false; reason: Refusal };

export interface FormatState {
  bold: boolean;
  underline: boolean;
  code: boolean;
  section: boolean;
  link: string | null;
  color: string | null;
  /** Everything but `</>` and the font is disabled (inside a code block, or nothing formattable). */
  onlyCode: boolean;
  sectionDisabled: boolean;
  hasTarget: boolean;
  /** The font of the target's text, or of its code for a `codeOnly` target; null if none has one. */
  font: string | null;
  fontMixed: boolean;
  /** The target has no text characters, only inline code and/or code blocks. */
  codeOnly: boolean;
  /** Something in the target can take a font. */
  fontable: boolean;
  /** Every font stored anywhere in the target (text, code, touched blocks), installed or not. */
  fonts: string[];
}

export function formatCtx(text: string): FormatCtx {
  return { text, a: analyze(text) };
}

const isRichLine = (l: Line) => l.kind === "text" || l.kind === "heading";
const isBlockLine = (l: Line) => l.kind === "code" || l.kind === "fence-open" || l.kind === "fence-close";

function linesIn(ctx: FormatCtx, from: number, to: number): Line[] {
  const l1 = lineAt(ctx.a, from);
  let l2 = lineAt(ctx.a, to);
  // A selection that ends at the very start of a line doesn't touch that line.
  if (to > from && to === l2.from && l2.index > l1.index) l2 = ctx.a.doc.lines[l2.index - 1];
  return ctx.a.doc.lines.slice(l1.index, l2.index + 1);
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * What an option applies to (README §3.6): the selection, or, with the formatting bar pinned and
 * nothing selected, the word at the cursor. Null when there's nothing to apply to.
 */
export function resolveTarget(ctx: FormatCtx, from: number, to: number, pinned: boolean): { from: number; to: number; word: boolean } | null {
  if (to > from) return { from, to, word: false };
  if (!pinned) return null;
  const line = lineAt(ctx.a, from);
  if (!isRichLine(line)) return null;
  const cs = chars(buildRow(line, ctx.a.tokens[line.index]));
  let i = cs.findIndex((c) => c.raw >= from);
  if (i < 0) i = cs.length;
  let start = i;
  while (start > 0 && WORD.test(cs[start - 1].ch)) start--;
  let end = i;
  while (end < cs.length && WORD.test(cs[end].ch)) end++;
  if (start === end) return null;
  return { from: cs[start].raw, to: cs[end - 1].raw + 1, word: true };
}

interface Prepared {
  lines: Line[];
  rows: (Row | null)[];
  targets: VChar[][];
}

function prepare(ctx: FormatCtx, from: number, to: number): Prepared {
  const lines = linesIn(ctx, from, to);
  const rows = lines.map((l) => (isRichLine(l) ? buildRow(l, ctx.a.tokens[l.index]) : null));
  const targets = rows.map((r) => (r ? chars(r).filter((c) => c.raw >= from && c.raw < to) : []));
  return { lines, rows, targets };
}

/**
 * The link under the characters: one link, or adjacent links to the same address left by formatting
 * part of one (they look and act as one, §13). Only on one line: a link never spans lines.
 */
function linkOf(targets: VChar[][]): LinkRef | null {
  const lines = targets.filter((t) => t.length);
  if (lines.length !== 1) return null;
  const first = lines[0][0].link;
  if (!first) return null;
  return lines[0].every((c) => c.link?.url === first.url && c.link.form === first.form) ? first : null;
}

/** The characters of the (possibly split) link that `cs[at]` is on. */
function linkRun(cs: VChar[], at: number): VChar[] {
  const link = cs[at].link!;
  const same = (c: VChar | undefined) => c?.link?.url === link.url && c.link.form === link.form;
  let i = at;
  let j = at;
  while (same(cs[i - 1])) i--;
  while (same(cs[j + 1])) j++;
  return cs.slice(i, j + 1);
}

export function formatState(ctx: FormatCtx, from: number, to: number, pinned: boolean): FormatState {
  const target = resolveTarget(ctx, from, to, pinned);
  const line = lineAt(ctx.a, from);
  const fonts = fontTarget(ctx, from, to, pinned);
  const state: FormatState = {
    bold: false,
    underline: false,
    code: false,
    section: line.kind === "heading",
    link: null,
    color: null,
    onlyCode: false,
    sectionDisabled: !isRichLine(line),
    // A cursor in a code block is a target too, for `</>` and the font.
    hasTarget: !!target || (pinned && isBlockLine(line)),
    font: null,
    fontMixed: false,
    codeOnly: false,
    fontable: false,
    fonts: [],
  };
  if (fonts) {
    const cs = fonts.p.targets.flat();
    const text = cs.filter((c) => !c.style.code);
    state.codeOnly = !text.length && (cs.length > 0 || fonts.blocks.length > 0);
    state.fontable = cs.length > 0 || fonts.blocks.length > 0;
    const seen = new Set<string | null>(
      text.length ? text.map((c) => c.style.font) : [...cs.map((c) => c.style.font), ...fonts.blocks.map((b) => ctx.a.doc.blocks[b].font)],
    );
    state.font = seen.size === 1 ? [...seen][0] : null;
    state.fontMixed = seen.size > 1;
    const stored = [...cs.map((c) => c.style.font), ...fonts.blocks.map((b) => ctx.a.doc.blocks[b].font)];
    state.fonts = [...new Set(stored.filter((f): f is string => f !== null))];
  }
  const range = target ?? { from, to };
  const { lines, targets } = prepare(ctx, range.from, Math.max(range.to, range.from));
  if (lines.some(isBlockLine) || !lines.some(isRichLine)) state.onlyCode = true;
  const all = targets.flat();
  if (!all.length) return state;
  state.bold = all.every((c) => c.style.b);
  state.underline = all.every((c) => c.style.u);
  const nonLink = all.filter((c) => !c.link);
  state.code = nonLink.length > 0 && nonLink.every((c) => c.style.code);
  state.link = linkOf(targets)?.url ?? null;
  const colors = new Set<string | null>();
  lines.forEach((l, i) => {
    for (const c of targets[i]) colors.add(l.kind === "heading" ? l.color! : c.style.color);
  });
  state.color = colors.size === 1 ? [...colors][0] : null;
  return state;
}

// ---------------------------------------------------------------------------------------------

function kindsMatch(before: Analysis, after: Analysis, expect: (oldIndex: number) => Line["kind"] | null): boolean {
  if (before.doc.lines.length !== after.doc.lines.length) return false;
  for (let i = 0; i < before.doc.lines.length; i++) {
    const want = expect(i) ?? before.doc.lines[i].kind;
    const got = after.doc.lines[i];
    if (got.kind !== want) return false;
    const oldBlock = before.doc.lines[i].block;
    if (want === before.doc.lines[i].kind && (oldBlock === undefined) !== (got.block === undefined)) return false;
  }
  return true;
}

function finish(
  ctx: FormatCtx,
  p: Prepared,
  regionRows: Row[],
  regionFrom: number,
  regionTo: number,
  word: boolean,
): FormatResult {
  const serial = serializeRows(regionRows);
  const changes = piecesToChanges(serial.pieces, regionFrom, regionTo, (a, b) => ctx.text.slice(a, b));
  const newText = applyChanges(ctx.text, changes);
  const after = analyze(newText);
  // 1. Line: each formatted line re-parses to the characters and styles that were intended.
  const firstIndex = p.lines[0].index;
  for (let i = 0; i < p.lines.length; i++) {
    const row = regionRows[i];
    if (row.kind !== "text" && row.kind !== "heading") continue;
    const newLine = after.doc.lines[firstIndex + i];
    if (!newLine || newLine.kind !== row.kind) return { ok: false, reason: "cant" };
    const parsed = charsOfLine(newLine.text);
    if (!sameVisible(chars(row), parsed.chars)) return { ok: false, reason: "cant" };
  }
  // 2. Document: line kinds and block pairings are unchanged.
  if (!kindsMatch(ctx.a, after, () => null)) return { ok: false, reason: "cant" };
  const anchor = regionFrom + (serial.carets.get("anchor") ?? 0);
  const head = regionFrom + (serial.carets.get("head") ?? 0);
  return word ? { ok: true, changes, anchor: head, head } : { ok: true, changes, anchor, head };
}

function markSelection(p: Prepared): void {
  const rows = p.rows;
  let firstRow = -1;
  let lastRow = -1;
  p.targets.forEach((t, i) => {
    if (!t.length) return;
    if (firstRow < 0) firstRow = i;
    lastRow = i;
  });
  if (firstRow < 0) return;
  const first = p.targets[firstRow][0];
  const last = p.targets[lastRow][p.targets[lastRow].length - 1];
  const r1 = rows[firstRow]!;
  r1.items.splice(r1.items.indexOf(first), 0, { kind: "caret", id: "anchor", aff: "next" });
  const r2 = rows[lastRow]!;
  r2.items.splice(r2.items.indexOf(last) + 1, 0, { kind: "caret", id: "head", aff: "prev" });
}

function regionOf(ctx: FormatCtx, p: Prepared): { rows: Row[]; from: number; to: number } {
  const rows = p.lines.map((l, i) => p.rows[i] ?? buildRow(l, ctx.a.tokens[l.index]));
  return { rows, from: p.lines[0].from, to: p.lines[p.lines.length - 1].to };
}

export function applyFormat(ctx: FormatCtx, from: number, to: number, op: FormatOp, pinned = false): FormatResult {
  if (op.type === "section") return section(ctx, from, to);
  if (op.type === "font") return applyFont(ctx, from, to, op, pinned);
  if (op.type === "code") {
    const lines = linesIn(ctx, from, Math.max(from, to));
    if (lines.some(isBlockLine)) return unwrapBlocks(ctx, lines, from, to);
    if (lines.length > 1) return wrapBlock(ctx, lines);
  }
  const target = resolveTarget(ctx, from, to, pinned);
  if (!target) return { ok: false, reason: "select" };
  const p = prepare(ctx, target.from, target.to);
  const all = p.targets.flat();
  if (!all.length) return { ok: false, reason: "select" };

  if (op.type === "link" && op.url) {
    // A bare URL: the new address replaces its text (the text *is* the address).
    const bare = all[0].link?.form === "bare" && all.every((c) => c.link?.id === all[0].link!.id) ? all[0].link : null;
    if (bare) {
      const row = p.rows.find((r) => r && chars(r).some((c) => c.link?.id === bare.id))!;
      const linkChars = chars(row).filter((c) => c.link?.id === bare.id);
      const start = linkChars[0].raw;
      const end = linkChars[linkChars.length - 1].raw + 1;
      // The new address must re-parse as exactly that link, with the rest of the line unchanged.
      const line = lineAt(ctx.a, start);
      const before = chars(row).filter((c) => c.link?.id !== bare.id);
      const check = (insert: string, form: "bare" | "md"): boolean => {
        const text = line.text.slice(0, start - line.from) + insert + line.text.slice(end - line.from);
        const parsed = charsOfLine(text);
        if (parsed.kind !== line.kind) return false;
        const linked = parsed.chars.filter((c) => c.link?.url === op.url && c.link.form === form);
        if (linked.map((c) => c.ch).join("") !== op.url) return false;
        const rest = parsed.chars.filter((c) => !(c.link?.url === op.url && c.link.form === form));
        return sameVisible(before.map((c) => ({ ...c, raw: -1 })), rest);
      };
      for (const [insert, form] of [[op.url, "bare"], [`[${op.url}](${op.url})`, "md"]] as const) {
        if (!check(insert, form)) continue;
        const changes = [{ from: start, to: end, insert }];
        const textStart = form === "md" ? start + 1 : start;
        return { ok: true, changes, anchor: textStart, head: textStart + op.url.length };
      }
      return { ok: false, reason: "cant" };
    }
  }

  // Toggles are decided once for the whole selection, before any line changes.
  const boldOn = !all.every((c) => c.style.b);
  const underlineOn = !all.every((c) => c.style.u);
  const removeColor = op.type === "color" && all.every((c) => c.style.color === op.color);
  const allCode = all.filter((c) => !c.link).every((c) => c.style.code);
  p.lines.forEach((line, i) => {
    const row = p.rows[i];
    const targets = p.targets[i];
    if (!row || !targets.length) return;
    const heading = line.kind === "heading";
    switch (op.type) {
      case "bold": {
        for (const c of targets) setStyle(c, { b: boldOn });
        break;
      }
      case "underline": {
        for (const c of targets) setStyle(c, { u: underlineOn });
        break;
      }
      case "color": {
        if (!isColor(op.color)) return;
        if (heading) {
          // A swatch on a heading recolors the section and strips highlight colors inside it.
          if (line.color === op.color) return;
          row.prefix = `## {${op.color}} `;
          row.prefixRaw = -1;
          for (const c of chars(row)) setStyle(c, { color: null });
          return;
        }
        for (const c of targets) setStyle(c, { color: removeColor ? null : op.color });
        break;
      }
      case "removeColor":
        for (const c of targets) setStyle(c, { color: null });
        break;
      case "clear":
        for (const c of targets) {
          setStyle(c, UNSTYLED);
          c.style = { ...c.style, code: false };
          c.codeId = -1;
        }
        break;
      case "code": {
        const nonLink = targets.filter((c) => !c.link);
        const id = freshId();
        for (const c of nonLink) {
          c.style = { ...c.style, code: !allCode };
          c.codeId = allCode ? -1 : id;
        }
        break;
      }
      case "link": {
        const cs = chars(row);
        if (!op.url) {
          // Remove every link the target touches (all of it), keeping its text.
          const drop = new Set<VChar>();
          for (const t of targets) if (t.link && !drop.has(t)) for (const c of linkRun(cs, cs.indexOf(t))) drop.add(c);
          for (const c of drop) c.link = null;
          break;
        }
        const existing = linkOf(p.targets);
        if (existing?.form === "md") {
          // The whole link gets the new address, including parts outside the selection.
          const moved = { ...existing, url: op.url };
          for (const c of linkRun(cs, cs.indexOf(targets[0]))) c.link = moved;
          break;
        }
        const link = { id: freshId(), url: op.url, form: "md" as const };
        for (const c of targets) {
          c.link = link;
          c.style = { ...c.style, code: false };
          c.codeId = -1;
        }
        break;
      }
    }
  });

  for (const row of p.rows) if (row) splitLinksAtStyleBoundaries(row);
  markSelection(p);
  const region = regionOf(ctx, p);
  const result = finish(ctx, p, region.rows, region.from, region.to, target.word);
  if (result.ok && op.type === "link" && !op.url) {
    // Unlinking a bare URL can't be written down: its text re-parses as the same link.
    const after = formatCtx(applyChanges(ctx.text, result.changes));
    const still = formatState(after, result.anchor, result.head, false).link;
    if (still) return { ok: false, reason: "cant" };
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Fonts (architecture §15, Fonts)

interface FontTarget {
  p: Prepared;
  /** Indexes of the code blocks it touches. */
  blocks: number[];
  word: boolean;
}

/** What a font applies to: the selection's text and the blocks it touches; with the bar pinned and
 *  nothing selected, the word at the cursor, or the block the cursor is in. */
function fontTarget(ctx: FormatCtx, from: number, to: number, pinned: boolean): FontTarget | null {
  if (to > from) {
    const blocks = [...new Set(linesIn(ctx, from, to).filter(isBlockLine).map((l) => l.block!))];
    return { p: prepare(ctx, from, to), blocks, word: false };
  }
  if (!pinned) return null;
  const line = lineAt(ctx.a, from);
  if (isBlockLine(line)) return { p: prepare(ctx, from, from), blocks: [line.block!], word: false };
  const word = resolveTarget(ctx, from, to, pinned);
  return word ? { p: prepare(ctx, word.from, word.to), blocks: [], word: true } : null;
}

/** One line's text replaced by `next`, as the smallest change. */
function lineEdit(line: Line, next: string): Change {
  const old = line.text;
  let pre = 0;
  while (pre < old.length && pre < next.length && old[pre] === next[pre]) pre++;
  let suf = 0;
  while (suf < old.length - pre && suf < next.length - pre && old[old.length - 1 - suf] === next[next.length - 1 - suf]) suf++;
  return { from: line.from + pre, to: line.to - suf, insert: next.slice(pre, next.length - suf) };
}

/**
 * A font on everything in the target it's allowed on: text takes any font; inline code and code
 * blocks only a monospace one. Default (null) removes the font from all of them.
 */
function applyFont(ctx: FormatCtx, from: number, to: number, op: FontOp, pinned: boolean): FormatResult {
  const t = fontTarget(ctx, from, to, pinned);
  if (!t) return { ok: false, reason: "select" };
  const all = t.p.targets.flat();
  if (!all.length && !t.blocks.length) return { ok: false, reason: "select" };
  const takes = (c: VChar) => op.font === null || op.mono || !c.style.code;
  const blocksTake = op.font === null || op.mono;
  if (!all.some(takes) && !(blocksTake && t.blocks.length)) return { ok: false, reason: "cant" };

  // Text and inline code: the usual serialize-and-verify path.
  let textChanges: Change[] = [];
  let caret: { anchor: number; head: number } | null = null;
  if (all.length) {
    for (const c of all) if (takes(c)) setStyle(c, { font: op.font });
    for (const row of t.p.rows) if (row) splitLinksAtStyleBoundaries(row);
    markSelection(t.p);
    const region = regionOf(ctx, t.p);
    const result = finish(ctx, t.p, region.rows, region.from, region.to, t.word);
    if (!result.ok) return result;
    textChanges = result.changes;
    caret = { anchor: result.anchor, head: result.head };
  }

  // Code blocks: the font word on each opening fence.
  const fenceChanges: Change[] = [];
  if (blocksTake) {
    for (const id of t.blocks) {
      const open = ctx.a.doc.lines[ctx.a.doc.blocks[id].open];
      const next = withFenceFont(open.text, op.font);
      if (next !== open.text) fenceChanges.push(lineEdit(open, next));
    }
  }
  const changes = [...textChanges, ...fenceChanges].sort((x, y) => x.from - y.from);
  if (fenceChanges.length) {
    // Line kinds and block pairings are unchanged, and each block has the font intended.
    const after = analyze(applyChanges(ctx.text, changes));
    if (!kindsMatch(ctx.a, after, () => null)) return { ok: false, reason: "cant" };
    for (const id of t.blocks) {
      const b = after.doc.lines[ctx.a.doc.blocks[id].open].block;
      if (b === undefined || after.doc.blocks[b].font !== op.font) return { ok: false, reason: "cant" };
    }
  }

  // The same text stays selected (README §3.6). An end on a line whose characters were targeted
  // comes from the serializer's carets; any other end (in code or a fence, on a line with nothing
  // selected, or at the start of the line after the selection) is mapped through the changes.
  const fence1 = fenceChanges.map((c) => ({ ...c, from: mapThrough(c.from, textChanges), to: mapThrough(c.to, textChanges) }));
  if (t.word && caret) return { ok: true, changes, anchor: caret.anchor, head: caret.head };
  const targeted = (pos: number) => {
    const i = t.p.lines.indexOf(lineAt(ctx.a, pos));
    return i >= 0 && t.p.targets[i].length > 0;
  };
  const end = (pos: number, fromCaret: number | undefined) =>
    mapThrough(fromCaret !== undefined && targeted(pos) ? fromCaret : mapThrough(pos, textChanges), fence1);
  return { ok: true, changes, anchor: end(from, caret?.anchor), head: end(to, caret?.head) };
}

function section(ctx: FormatCtx, from: number, to: number): FormatResult {
  const lines = linesIn(ctx, from, Math.max(from, to));
  const line = lines.find((l) => l.text.trim() !== "") ?? lines[0];
  if (line.text.trim() === "") return { ok: false, reason: "select" };
  if (!isRichLine(line)) return { ok: false, reason: "cant" };
  let changes: Change[];
  let shift: (pos: number) => number;
  if (line.kind === "heading") {
    const len = line.prefixLen!;
    changes = [{ from: line.from, to: line.from + len, insert: "" }];
    shift = (pos) => (pos >= line.from + len ? pos - len : line.from);
  } else {
    const lead = /^[ \t]*/.exec(line.text)![0].length;
    const prefix = `## {${DEFAULT_SECTION_COLOR}} `;
    changes = [{ from: line.from, to: line.from + lead, insert: prefix }];
    shift = (pos) => (pos >= line.from + lead ? pos - lead + prefix.length : line.from + prefix.length);
  }
  const after = analyze(applyChanges(ctx.text, changes));
  const want = line.kind === "heading" ? "text" : "heading";
  if (!kindsMatch(ctx.a, after, (i) => (i === line.index ? want : null))) return { ok: false, reason: "cant" };
  return { ok: true, changes, anchor: shift(from), head: shift(to) };
}

function unwrapBlocks(ctx: FormatCtx, lines: Line[], from: number, to: number): FormatResult {
  const doc = ctx.a.doc;
  const blockIds = [...new Set(lines.filter(isBlockLine).map((l) => l.block!))];
  const removed = new Set<number>();
  const changes: Change[] = [];
  for (const id of blockIds) {
    const block = doc.blocks[id];
    for (const index of [block.open, block.close]) {
      const l = doc.lines[index];
      removed.add(index);
      if (index + 1 < doc.lines.length) changes.push({ from: l.from, to: l.to + 1, insert: "" });
      else changes.push({ from: l.from - 1, to: l.to, insert: "" });
    }
  }
  changes.sort((x, y) => x.from - y.from);
  const after = analyze(applyChanges(ctx.text, changes));
  // Lines outside the unwrapped blocks keep their kinds.
  const map: number[] = [];
  let n = 0;
  for (let i = 0; i < doc.lines.length; i++) map[i] = removed.has(i) ? -1 : n++;
  const inside = new Set<number>();
  for (const id of blockIds) for (let i = doc.blocks[id].open; i <= doc.blocks[id].close; i++) inside.add(i);
  for (let i = 0; i < doc.lines.length; i++) {
    if (inside.has(i)) continue;
    if (after.doc.lines[map[i]]?.kind !== doc.lines[i].kind) return { ok: false, reason: "cant" };
  }
  // The same visible text stays selected (README §3.6).
  return { ok: true, changes, anchor: mapThrough(from, changes), head: mapThrough(to, changes) };
}

function wrapBlock(ctx: FormatCtx, lines: Line[]): FormatResult {
  if (lines.some((l) => CLOSE_FENCE_RE.test(l.text))) return { ok: false, reason: "cant" };
  const body = lines.map((l) => (l.kind === "image" ? l.text : lineVisibleText(l)));
  const insert = ["```", ...body, "```"].join("\n");
  const from = lines[0].from;
  const to = lines[lines.length - 1].to;
  const changes = [{ from, to, insert }];
  const after = analyze(applyChanges(ctx.text, changes));
  const first = lines[0].index;
  for (let i = 0; i < body.length + 2; i++) {
    const want = i === 0 ? "fence-open" : i === body.length + 1 ? "fence-close" : "code";
    if (after.doc.lines[first + i]?.kind !== want) return { ok: false, reason: "cant" };
  }
  const before = ctx.a.doc.lines;
  for (let i = lines[lines.length - 1].index + 1; i < before.length; i++) {
    const got = after.doc.lines[i + 2];
    if (!got || got.kind !== before[i].kind) return { ok: false, reason: "cant" };
  }
  return { ok: true, changes, anchor: from + 4, head: from + insert.length - 4 };
}
