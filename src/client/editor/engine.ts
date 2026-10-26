// The render-mode edit engine (architecture §7.7, part 1). Pure: it takes the document text and its
// analysis and returns changes against that text plus the new selection. Every render-mode edit,
// whatever its source, is computed here.

import { analyze, foldRanges, lineAt, type Analysis, type Fold } from "../../shared/analysis.ts";
import {
  applyChanges,
  buildRow,
  chars,
  charsOfLine,
  fixEquals,
  isChar,
  newChars,
  Out,
  piecesToChanges,
  PLAIN,
  sameVisible,
  serializeRow,
  serializeRows,
  type CaretItem,
  type Change,
  type Item,
  type LinkRef,
  type Row,
  type VChar,
} from "../../shared/model.ts";
import { matchHeading, matchImage, OPEN_FENCE_RE, parseInline, type Line, type Token } from "../../shared/syntax.ts";

export interface Ctx {
  text: string;
  a: Analysis;
  collapsed: ReadonlySet<string>;
}

export interface EditResult {
  changes: Change[];
  anchor: number;
  head: number;
  /** Collapsed sections (by heading text) to expand along with the edit. */
  expand: string[];
}

export function makeCtx(text: string, collapsed: ReadonlySet<string> = new Set()): Ctx {
  return { text, a: analyze(text), collapsed };
}

type Template = Pick<VChar, "style" | "hl" | "codeId" | "link">;

const sliceOf = (ctx: Ctx) => (from: number, to: number) => ctx.text.slice(from, to);

function done(changes: Change[], pos: number, expand: string[] = []): EditResult {
  return { changes, anchor: pos, head: pos, expand };
}

function rowOf(ctx: Ctx, index: number): Row {
  return buildRow(ctx.a.doc.lines[index], ctx.a.tokens[index]);
}

function isLiteralLine(line: Line): boolean {
  return line.kind === "code" || line.kind === "fence-open" || line.kind === "fence-close";
}

function isFence(line: Line): boolean {
  return line.kind === "fence-open" || line.kind === "fence-close";
}

function prefixEnd(line: Line): number {
  return line.kind === "heading" ? line.from + line.prefixLen! : line.from;
}

function isRich(row: Row): boolean {
  return row.kind === "text" || row.kind === "heading";
}

// ---------------------------------------------------------------------------------------------
// Positions and tokens

interface Enclosing {
  hl: Token | null;
  code: Token | null;
  link: Token | null;
}

/** Tokens whose visible part contains `pos` (edges included). Bare URLs don't enclose. */
function enclosingAt(ctx: Ctx, line: Line, pos: number): Enclosing {
  const rel = pos - line.from;
  const out: Enclosing = { hl: null, code: null, link: null };
  const visit = (tokens: Token[]) => {
    for (const t of tokens) {
      if (rel < t.contentFrom || rel > t.contentTo) continue;
      if (t.type === "hl") {
        out.hl = t;
        visit(t.children ?? []);
      } else if (t.type === "code") out.code = t;
      else if (t.type === "link") out.link = t;
    }
  };
  if (line.kind === "text" || line.kind === "heading") visit(ctx.a.tokens[line.index]);
  return out;
}

function charIn(row: Row, line: Line, t: Token): VChar | undefined {
  return chars(row).find((c) => c.raw >= line.from + t.contentFrom && c.raw < line.from + t.contentTo);
}

/** What text typed at `pos` looks like: the style of the tokens enclosing it. */
function templateAt(ctx: Ctx, row: Row, line: Line, pos: number): Template | null {
  if (!isRich(row)) return null;
  const enc = enclosingAt(ctx, line, pos);
  if (!enc.hl && !enc.code && !enc.link) return null;
  const hlChar = enc.hl ? charIn(row, line, enc.hl) : undefined;
  const codeChar = enc.code ? charIn(row, line, enc.code) : undefined;
  const linkChar = enc.link ? charIn(row, line, enc.link) : undefined;
  return {
    style: { color: enc.hl?.opts?.color ?? null, b: enc.hl?.opts?.b ?? false, u: enc.hl?.opts?.u ?? false, code: !!codeChar },
    hl: hlChar?.hl ?? null,
    codeId: codeChar?.codeId ?? -1,
    link: linkChar?.link ?? null,
  };
}

function idsOf(t: Template | undefined | null): Set<string> {
  const ids = new Set<string>();
  if (!t) return ids;
  if (t.hl) ids.add(`h${t.hl.id}`);
  if (t.style.code && t.codeId >= 0) ids.add(`c${t.codeId}`);
  if (t.link) ids.add(`l${t.link.id}`);
  return ids;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** Affinity for a caret between `prev` and `next` that keeps its original containment. */
function affinity(ids: Set<string>, prev: VChar | undefined, next: VChar | undefined): CaretItem["aff"] {
  if (ids.size && overlaps(ids, idsOf(prev))) return "prev";
  if (ids.size && overlaps(ids, idsOf(next))) return "next";
  return "out";
}

function lastChar(items: Item[]): VChar | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "char") return it;
    if (it.kind === "raw") return undefined;
  }
  return undefined;
}

function firstChar(items: Item[]): VChar | undefined {
  for (const it of items) {
    if (it.kind === "char") return it;
    if (it.kind === "raw") return undefined;
  }
  return undefined;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function lastGraphemeLength(s: string): number {
  let last = 0;
  for (const seg of segmenter.segment(s)) last = seg.segment.length;
  return last;
}

function firstGraphemeLength(s: string): number {
  for (const seg of segmenter.segment(s)) return seg.segment.length;
  return 0;
}

function visibleBefore(row: Row, pos: number): VChar[] {
  return chars(row).filter((c) => c.raw < pos);
}

function visibleAfter(row: Row, pos: number): VChar[] {
  return chars(row).filter((c) => c.raw >= pos);
}

export function atHeadingTextStart(ctx: Ctx, line: Line, pos: number): boolean {
  if (line.kind !== "heading" || pos < prefixEnd(line)) return false;
  return visibleBefore(rowOf(ctx, line.index), pos).length === 0;
}

function folds(ctx: Ctx): Fold[] {
  return foldRanges(ctx.a, ctx.collapsed);
}

// ---------------------------------------------------------------------------------------------
// The edit core: replace [from, to) with segments, keeping tokens and line rules intact.

export type Seg = { type: "text"; text: string } | { type: "raw"; text: string } | { type: "break" };

interface EditOpts {
  /** Leave the caret before the inserted break (splitLine). */
  caretAtStart?: boolean;
  /** Text typed or pasted over a selection takes the first selected character's style. */
  replaceStyle?: boolean;
  /** Where the caret was before the edit, for its containment. */
  caretOrigin?: number;
  expand?: string[];
}

/** A heading's text loses leading whitespace; a heading with no text becomes an empty line. */
function cleanHeading(row: Row): Row {
  if (row.kind !== "heading") return row;
  const items = row.items;
  for (;;) {
    const i = items.findIndex(isChar);
    if (i < 0) break;
    const c = items[i] as VChar;
    if (c.ch !== " " && c.ch !== "\t") break;
    items.splice(i, 1);
  }
  if (!items.some((it) => it.kind !== "caret")) return { kind: "text", prefix: "", prefixRaw: -1, items };
  return row;
}

/** Bare URLs split across rows become `[text](url)` links to the original address. */
function convertSplitBareLinks(rows: Row[]): void {
  const rowsOfLink = new Map<number, Set<number>>();
  rows.forEach((row, ri) => {
    for (const c of chars(row)) {
      if (c.link?.form !== "bare") continue;
      let set = rowsOfLink.get(c.link.id);
      if (!set) rowsOfLink.set(c.link.id, (set = new Set()));
      set.add(ri);
    }
  });
  let seq = 0;
  for (const [id, set] of rowsOfLink) {
    if (set.size < 2) continue;
    rows.forEach((row) => {
      let md: LinkRef | null = null;
      for (const c of chars(row)) {
        if (c.link?.id !== id) continue;
        md ??= { id: -1_000_000 - seq++, url: c.link.url, form: "md" };
        c.link = md;
      }
    });
  }
}

function rowText(row: Row, slice: (a: number, b: number) => string): string {
  const out = new Out();
  serializeRow(out, row);
  return out.toString(slice);
}

/**
 * If the row doesn't re-parse as intended (typed syntax inside a token), make the new characters
 * plain so the token is split around them, then fix `=` runs. Edits are never refused.
 */
function settleRow(row: Row, slice: (a: number, b: number) => string): void {
  if (!isRich(row) || row.items.some((it) => it.kind === "raw")) return;
  const ok = () => {
    const parsed = charsOfLine(rowText(row, slice));
    return parsed.kind === row.kind && sameVisible(chars(row), parsed.chars);
  };
  if (ok()) return;
  for (const c of chars(row)) {
    if (c.raw >= 0) continue;
    c.style = { ...PLAIN };
    c.hl = null;
    c.codeId = -1;
    c.link = null;
  }
  if (ok()) return;
  // A bare URL now runs into its neighbor (URLs may contain =, { and }): write it as an explicit
  // [url](url) link, which looks the same and keeps both tokens.
  const explicit = new Map<number, LinkRef>();
  for (const c of chars(row)) {
    if (c.link?.form !== "bare") continue;
    let ref = explicit.get(c.link.id);
    if (!ref) explicit.set(c.link.id, (ref = { id: c.link.id, url: c.link.url, form: "md" }));
    c.link = ref;
  }
  if (explicit.size && ok()) return;
  fixEquals(row);
}

function emptyRow(kind: Row["kind"] = "text"): Row {
  return { kind, prefix: "", prefixRaw: -1, items: [] };
}

function editRange(ctx: Ctx, fromIn: number, toIn: number, segs: Seg[], o: EditOpts = {}): EditResult {
  const { a } = ctx;
  const slice = sliceOf(ctx);
  let from = Math.max(0, Math.min(fromIn, toIn));
  let to = Math.min(ctx.text.length, Math.max(fromIn, toIn));
  let L1 = lineAt(a, from);
  let L2 = lineAt(a, to);
  // Endpoints inside a heading prefix move outward; an insertion moves to the text's start.
  if (L1.kind === "heading" && from > L1.from && from < prefixEnd(L1)) from = from === to ? prefixEnd(L1) : L1.from;
  if (to < from) to = from;
  if (L2.kind === "heading" && to > L2.from && to < prefixEnd(L2)) to = prefixEnd(L2);
  L1 = lineAt(a, from);
  L2 = lineAt(a, to);
  const lines = a.doc.lines;

  const row1 = rowOf(ctx, L1.index);
  const row2 = L1.index === L2.index ? row1 : rowOf(ctx, L2.index);
  const origin = o.caretOrigin ?? from;
  const originLine = lineAt(a, origin);
  const originRow = originLine.index === L1.index ? row1 : originLine.index === L2.index ? row2 : rowOf(ctx, originLine.index);
  const ids = idsOf(templateAt(ctx, originRow, originLine, origin));

  // Style for inserted text.
  let template: Template | null = null;
  if (isRich(row1)) {
    const first = o.replaceStyle && to > from ? [...chars(row1), ...(row2 === row1 ? [] : chars(row2))].find((c) => c.raw >= from && c.raw < to) : undefined;
    template = first ? { style: { ...first.style }, hl: first.hl, codeId: first.codeId, link: first.link } : templateAt(ctx, row1, L1, from);
  }

  // Inserted parts, separated by line breaks.
  const parts: Item[][] = [[]];
  for (const seg of segs) {
    if (seg.type === "break") parts.push([]);
    else if (seg.type === "raw") parts[parts.length - 1].push({ kind: "raw", text: seg.text });
    else parts[parts.length - 1].push(...newChars(seg.text, template));
  }

  const before = (row: Row, line: Line): Item[] => {
    if (row.kind === "image") return from >= line.to ? [...row.items] : [];
    return row.items.filter((it) => isChar(it) && it.raw < from);
  };
  const after = (row: Row, line: Line): Item[] => {
    if (row.kind === "image") return to <= line.from ? [...row.items] : [];
    return row.items.filter((it) => isChar(it) && it.raw >= to);
  };
  const caretItem = (prev: Item[], next: Item[], afterBreak = false): CaretItem => {
    const last = prev[prev.length - 1];
    let aff: CaretItem["aff"];
    if (last && last.kind === "char" && last.raw < 0) aff = "prev"; // typing extends the token it's in
    else if (last && last.kind === "raw") aff = "out"; // after pasted syntax, outside every token
    else if (afterBreak) aff = affinityAfterBreak(ids, firstChar(next));
    else aff = affinity(ids, lastChar(prev), firstChar(next));
    return { kind: "caret", id: "c", aff };
  };

  const out: Row[] = [];
  const contKind = (line: Line): Row["kind"] => (isLiteralLine(line) ? "literal" : "text");

  if (L1.index === L2.index) {
    if (row1.kind === "image" && from > L1.from && from < L1.to) return done([], from);
    const keepPrefix = row1.kind === "heading" && from >= prefixEnd(L1);
    const headKind: Row["kind"] = row1.kind === "heading" && !keepPrefix ? "text" : row1.kind;
    const left = [...before(row1, L1), ...parts[0]];
    const right = after(row1, L1);
    const first: Row = { kind: headKind, prefix: keepPrefix ? row1.prefix : "", prefixRaw: keepPrefix ? row1.prefixRaw : -1, items: left };
    if (parts.length === 1) {
      first.items = [...left, caretItem(left, right), ...right];
      out.push(first);
    } else {
      const lastItems = parts[parts.length - 1];
      if (o.caretAtStart) first.items.push(caretItem(left, []));
      out.push(first);
      for (let i = 1; i < parts.length - 1; i++) out.push({ ...emptyRow(contKind(L1)), items: parts[i] });
      const tail: Item[] = o.caretAtStart ? [...lastItems, ...right] : [...lastItems, caretItem(lastItems, right, !lastItems.length), ...right];
      out.push({ ...emptyRow(contKind(L1)), items: tail });
    }
  } else {
    const inRange = (i: number) => i >= L1.index && i <= L2.index;
    const keptFence = (line: Line) => {
      if (!isFence(line)) return false;
      const block = a.doc.blocks[line.block!];
      return !inRange(line.kind === "fence-open" ? block.close : block.open);
    };
    // The first line's surviving part.
    let left: Row | null;
    let leftWhole = false;
    if (keptFence(L1) || (row1.kind === "image" && from >= L1.to)) {
      left = { ...row1, items: [...row1.items] };
      leftWhole = true;
    } else if (row1.kind === "image") {
      left = null;
    } else {
      const keepPrefix = row1.kind === "heading" && from >= prefixEnd(L1);
      left = {
        kind: row1.kind === "heading" && !keepPrefix ? "text" : row1.kind,
        prefix: keepPrefix ? row1.prefix : "",
        prefixRaw: keepPrefix ? row1.prefixRaw : -1,
        items: before(row1, L1),
      };
    }
    // The last line's surviving part.
    let right: Row | null;
    let rightWhole = false;
    if (keptFence(L2) || (row2.kind === "image" && to <= L2.from)) {
      right = { ...row2, items: [...row2.items] };
      rightWhole = true;
    } else if (row2.kind === "image") {
      right = null;
    } else {
      const prefixSurvives = row2.kind === "heading" && to <= L2.from;
      right = {
        kind: row2.kind === "heading" && !prefixSurvives ? "text" : row2.kind,
        prefix: prefixSurvives ? row2.prefix : "",
        prefixRaw: prefixSurvives ? row2.prefixRaw : -1,
        items: after(row2, L2),
      };
    }
    const kept: Row[] = [];
    for (let i = L1.index + 1; i < L2.index; i++) if (keptFence(lines[i])) kept.push(rowOf(ctx, i));

    const hasContent = (r: Row | null) => !!r && (!!r.prefix || r.items.some((it) => it.kind !== "caret"));
    const joinable =
      !!left && !!right && !leftWhole && !rightWhole && !kept.length &&
      ((!isLiteralLine(L1) && !isLiteralLine(L2)) || (L1.kind === "code" && L2.kind === "code" && L1.block === L2.block));

    const leftItems = [...(left?.items ?? []), ...parts[0]];
    if (parts.length === 1) {
      const leftEmpty = !hasContent(left) && !parts[0].length;
      const rightEmpty = !hasContent(right);
      if (joinable && !leftEmpty && !rightEmpty) {
        // The second line's text (its heading prefix already dropped) joins the first line.
        out.push({ ...left!, items: [...leftItems, caretItem(leftItems, right!.items), ...right!.items] });
      } else {
        // An empty side simply goes; nothing is joined to a kept fence or a screenshot line.
        const keepLeft = !leftEmpty || (!right && !kept.length) || (rightEmpty && !kept.length);
        if (keepLeft) out.push({ ...(left ?? emptyRow()), items: [...leftItems, caretItem(leftItems, [])] });
        out.push(...kept);
        if (right && !rightEmpty) {
          out.push(keepLeft || kept.length ? right : { ...right, items: [caretItem([], right.items), ...right.items] });
        } else if (!keepLeft && kept.length) {
          kept[0] = { ...kept[0], items: [{ kind: "caret", id: "c", aff: "out" }, ...kept[0].items] };
        }
        if (!out.length) out.push({ ...emptyRow(), items: [{ kind: "caret", id: "c", aff: "out" }] });
      }
    } else {
      const lastItems = parts[parts.length - 1];
      const firstRow: Row = { ...(left ?? emptyRow()), items: o.caretAtStart ? [...leftItems, caretItem(leftItems, [])] : leftItems };
      out.push(firstRow, ...kept);
      for (let i = 1; i < parts.length - 1; i++) out.push({ ...emptyRow(contKind(L1)), items: parts[i] });
      const rightItems = right && !rightWhole ? right.items : [];
      const tail: Item[] = o.caretAtStart ? [...lastItems, ...rightItems] : [...lastItems, caretItem(lastItems, rightItems, !lastItems.length), ...rightItems];
      out.push({ ...(right && !rightWhole ? right : emptyRow(contKind(L2))), items: tail });
      if (rightWhole && right) out.push(right);
    }
  }

  convertSplitBareLinks(out);
  for (let i = 0; i < out.length; i++) out[i] = cleanHeading(out[i]);
  for (const row of out) settleRow(row, slice);

  const serial = serializeRows(out);
  const changes = piecesToChanges(serial.pieces, L1.from, L2.to, slice);
  const pos = L1.from + (serial.carets.get("c") ?? 0);
  return done(changes, pos, o.expand ?? []);
}

function affinityAfterBreak(ids: Set<string>, next: VChar | undefined): CaretItem["aff"] {
  // After Enter inside a token, the caret starts inside the reopened half.
  if (ids.size && overlaps(ids, idsOf(next))) return "next";
  return "out";
}

// ---------------------------------------------------------------------------------------------
// Joins

/** README §3.7's join rule for the line break between `upper` and `lower`. */
function join(ctx: Ctx, upper: Line, lower: Line, dir: "backward" | "forward"): EditResult {
  const refused = () => done([], dir === "backward" ? upper.to : prefixEnd(lower));
  // An empty line simply goes; the other stays exactly as it is.
  if (upper.text === "") return done([{ from: upper.from, to: lower.from, insert: "" }], upper.from + (lower.kind === "heading" ? lower.prefixLen! : 0));
  if (lower.text === "") return done([{ from: upper.to, to: lower.to, insert: "" }], upper.to);
  if (isFence(upper) || isFence(lower) || upper.kind === "image" || lower.kind === "image") return refused();
  if (lower.kind === "heading") return refused();
  if ((upper.kind === "code") !== (lower.kind === "code")) return refused();
  const r = editRange(ctx, upper.to, lower.from, [], { caretOrigin: upper.to });
  // Both lines' tokens must re-parse unchanged after the join.
  const joined = applyChanges(ctx.text, r.changes);
  const before = [...chars(rowOf(ctx, upper.index)), ...chars(rowOf(ctx, lower.index))];
  const line = lineAt(analyze(joined), upper.from);
  const parsed = charsOfLine(line.text);
  if (upper.kind !== "code" && !sameVisible(before, parsed.chars)) return refused();
  return r;
}

// ---------------------------------------------------------------------------------------------
// Public engine functions

function deleteScreenshot(ctx: Ctx, line: Line, caret: number): EditResult {
  const lines = ctx.a.doc.lines;
  let from = line.from;
  let to = line.to;
  if (line.index + 1 < lines.length) to += 1;
  else if (line.index > 0) from -= 1;
  return done([{ from, to, insert: "" }], caret < from ? caret : from);
}

function graphemeBefore(row: Row, line: Line, pos: number): [number, number] | null {
  if (!isRich(row)) {
    if (pos <= line.from) return null;
    const n = lastGraphemeLength(line.text.slice(0, pos - line.from));
    return [pos - n, pos];
  }
  const cs = visibleBefore(row, pos);
  if (!cs.length) return null;
  const n = lastGraphemeLength(cs.map((c) => c.ch).join(""));
  const group = cs.slice(cs.length - n);
  return [group[0].raw, group[group.length - 1].raw + 1];
}

function graphemeAfter(row: Row, line: Line, pos: number): [number, number] | null {
  if (!isRich(row)) {
    if (pos >= line.to) return null;
    const n = firstGraphemeLength(line.text.slice(pos - line.from));
    return [pos, pos + n];
  }
  const cs = visibleAfter(row, pos);
  if (!cs.length) return null;
  const n = firstGraphemeLength(cs.map((c) => c.ch).join(""));
  const group = cs.slice(0, n);
  return [group[0].raw, group[group.length - 1].raw + 1];
}

export function backspace(ctx: Ctx, pos: number): EditResult | null {
  const lines = ctx.a.doc.lines;
  const line = lineAt(ctx.a, pos);
  // Headings first: at the start of a heading's text, Backspace removes the prefix.
  if (atHeadingTextStart(ctx, line, pos)) {
    return done([{ from: line.from, to: prefixEnd(line), insert: "" }], pos - line.prefixLen!);
  }
  if (line.kind === "image" && pos === line.to) return deleteScreenshot(ctx, line, pos);
  if (line.kind !== "image" && pos === line.from && line.index > 0 && lines[line.index - 1].kind === "image") {
    return deleteScreenshot(ctx, lines[line.index - 1], pos);
  }
  const expand: string[] = [];
  const fold = folds(ctx).find((f) => pos === f.to);
  if (fold) expand.push(fold.key);
  const row = rowOf(ctx, line.index);
  const range = line.kind === "image" ? null : graphemeBefore(row, line, pos);
  if (!range) {
    if (line.index === 0) return null;
    const r = join(ctx, lines[line.index - 1], line, "backward");
    return { ...r, expand: [...expand, ...r.expand] };
  }
  return editRange(ctx, range[0], range[1], [], { caretOrigin: pos, expand });
}

export function del(ctx: Ctx, pos: number): EditResult | null {
  const lines = ctx.a.doc.lines;
  const line = lineAt(ctx.a, pos);
  if (line.kind === "image" && pos === line.from) return deleteScreenshot(ctx, line, pos);
  if (line.kind !== "image" && pos === line.to && line.index + 1 < lines.length && lines[line.index + 1].kind === "image") {
    return deleteScreenshot(ctx, lines[line.index + 1], pos);
  }
  const expand: string[] = [];
  const fold = folds(ctx).find((f) => pos === f.from);
  if (fold) expand.push(fold.key);
  const row = rowOf(ctx, line.index);
  const range = line.kind === "image" ? null : graphemeAfter(row, line, pos);
  if (!range) {
    if (line.index + 1 >= lines.length) return null;
    const r = join(ctx, line, lines[line.index + 1], "forward");
    return { ...r, expand: [...expand, ...r.expand] };
  }
  return editRange(ctx, range[0], range[1], [], { caretOrigin: pos, expand });
}

type Category = "word" | "space" | "other";
function categorize(ch: string): Category {
  if (/\s/.test(ch)) return "space";
  if (/[\p{L}\p{N}_]/u.test(ch)) return "word";
  return "other";
}

/** A word (CodeMirror's grouping) or everything to the line's edge, over visible characters. */
export function deleteUnit(ctx: Ctx, pos: number, unit: "word" | "line", dir: "backward" | "forward"): EditResult | null {
  const line = lineAt(ctx.a, pos);
  const row = rowOf(ctx, line.index);
  if (atHeadingTextStart(ctx, line, pos) && dir === "backward") return backspace(ctx, pos);
  if (line.kind === "image") return dir === "backward" ? backspace(ctx, pos) : del(ctx, pos);
  const literal = !isRich(row);
  const seq: { ch: string; raw: number }[] = literal
    ? line.text.split("").map((ch, i) => ({ ch, raw: line.from + i }))
    : chars(row).map((c) => ({ ch: c.ch, raw: c.raw }));
  const side = dir === "backward" ? seq.filter((c) => c.raw < pos).reverse() : seq.filter((c) => c.raw >= pos);
  if (!side.length) return dir === "backward" ? backspace(ctx, pos) : del(ctx, pos);
  let taken = side.length;
  if (unit === "word") {
    let cat: Category | null = null;
    taken = 0;
    for (let i = 0; i < side.length; i++) {
      const c = categorize(side[i].ch);
      if (cat !== null && c !== cat) break;
      if (side[i].ch !== " " || i !== 0) cat = c;
      taken = i + 1;
    }
  }
  const group = side.slice(0, taken);
  const start = dir === "backward" ? group[group.length - 1].raw : pos;
  const end = dir === "backward" ? pos : group[group.length - 1].raw + 1;
  return editRange(ctx, start, end, [], { caretOrigin: pos });
}

export function enter(ctx: Ctx, from: number, to: number, split = false): EditResult {
  const line = lineAt(ctx.a, from);
  if (from === to) {
    if (atHeadingTextStart(ctx, line, from)) return done([{ from: line.from, to: line.from, insert: "\n" }], split ? line.from : from + 1);
    if (line.kind === "image" && from === line.from) return done([{ from, to: from, insert: "\n" }], split ? from : from + 1);
    if (line.kind === "image" && from === line.to) return done([{ from, to: from, insert: "\n" }], split ? from : from + 1);
  }
  const expand: string[] = [];
  const fold = folds(ctx).find((f) => from === f.from);
  if (fold) expand.push(fold.key);
  return editRange(ctx, from, to, [{ type: "break" }], { caretAtStart: split, expand });
}

export function transpose(ctx: Ctx, pos: number): EditResult | null {
  const line = lineAt(ctx.a, pos);
  const row = rowOf(ctx, line.index);
  if (line.kind === "image") return null;
  const cs = isRich(row) ? chars(row) : line.text.split("").map((ch, i) => ({ ch, raw: line.from + i }) as VChar);
  let i = cs.findIndex((c) => c.raw >= pos);
  if (i < 0) i = cs.length;
  if (i === cs.length) i--;
  if (i <= 0) return null;
  const x = cs[i - 1];
  const y = cs[i];
  if (!isRich(row)) {
    return done([{ from: x.raw, to: y.raw + 1, insert: y.ch + x.ch }], y.raw + 1);
  }
  // Swap the characters; each keeps its own style. Hidden syntax never moves.
  const swapped: Item[] = [];
  for (const it of row.items) {
    if (it === x) swapped.push({ ...y, raw: -1 });
    else if (it === y) swapped.push({ ...x, raw: -1 }, { kind: "caret", id: "c", aff: "prev" });
    else swapped.push(it);
  }
  const serial = serializeRows([{ ...row, items: swapped }]);
  const changes = piecesToChanges(serial.pieces, line.from, line.to, sliceOf(ctx));
  return done(changes, line.from + (serial.carets.get("c") ?? 0));
}

function hasSyntax(line: string): boolean {
  return parseInline(line).length > 0 || !!matchHeading(line) || !!matchImage(line) || OPEN_FENCE_RE.test(line);
}

/** Typing, a spellcheck replacement, or a paste (README §3.7; architecture §7.7). */
export function insertText(ctx: Ctx, from: number, to: number, text: string, mode: "type" | "paste" = "type"): EditResult {
  const line = lineAt(ctx.a, from);
  if (from === to) {
    if (atHeadingTextStart(ctx, line, from)) {
      // Whitespace at the start of a heading's text is dropped.
      const trimmed = text.replace(/^[ \t]+/, "");
      if (!trimmed) return done([], from);
      text = trimmed;
    }
    if (line.kind === "image" && (from === line.from || from === line.to)) {
      const before = from === line.from;
      const insert = before ? `${text}\n` : `\n${text}`;
      return done([{ from, to: from, insert }], before ? from + text.length : from + insert.length);
    }
  }
  const expand: string[] = [];
  const fold = folds(ctx).find((f) => from === f.from && to === from);
  if (fold) expand.push(fold.key);
  const segs: Seg[] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) segs.push({ type: "break" });
    if (!part) return;
    segs.push(mode === "paste" && hasSyntax(part) ? { type: "raw", text: part } : { type: "text", text: part });
  });
  return editRange(ctx, from, to, segs, { replaceStyle: to > from, expand });
}

export function deleteRange(ctx: Ctx, from: number, to: number): EditResult {
  return editRange(ctx, from, to, [], { caretOrigin: from });
}

/** The visible text in [from, to): what render mode shows of that range. */
export function visibleSlice(ctx: Ctx, from: number, to: number): string {
  const L1 = lineAt(ctx.a, from);
  const L2 = lineAt(ctx.a, to);
  let out = "";
  for (let i = L1.index; i <= L2.index; i++) {
    const line = ctx.a.doc.lines[i];
    if (i > L1.index && from <= line.from - 1 && to > line.from - 1) out += "\n";
    if (line.kind === "text" || line.kind === "heading") {
      for (const c of chars(rowOf(ctx, i))) if (c.raw >= from && c.raw < to) out += c.ch;
    } else if (line.kind !== "image") {
      out += ctx.text.slice(Math.max(from, line.from), Math.min(to, line.to));
    }
  }
  return out;
}

export function graphemeCount(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

/** What render mode copies (§7.9): partial lines as balanced syntax, whole lines raw. */
export function copyText(ctx: Ctx, from: number, to: number): string {
  const L1 = lineAt(ctx.a, from);
  const L2 = lineAt(ctx.a, to);
  const out: string[] = [];
  for (let i = L1.index; i <= L2.index; i++) {
    const line = ctx.a.doc.lines[i];
    const a = Math.max(from, line.from);
    const b = Math.min(to, line.to);
    const whole = a <= line.from && b >= line.to;
    if (whole || line.kind !== "text" && line.kind !== "heading") {
      out.push(whole ? line.text : ctx.text.slice(a, b));
      continue;
    }
    const row = rowOf(ctx, i);
    const picked: Row = { kind: "text", prefix: "", prefixRaw: -1, items: chars(row).filter((c) => c.raw >= a && c.raw < b) };
    out.push(rowText(picked, sliceOf(ctx)));
  }
  return out.join("\n");
}

/**
 * A pasted screenshot's line at `pos` (README §3.11): on its own line, line breaks added as needed;
 * a highlight or link there is split as Enter does; inside a code block it goes after the block.
 */
export function insertScreenshot(ctx: Ctx, pos: number, name: string): EditResult {
  const md = `![](${name})`;
  const line = lineAt(ctx.a, pos);
  if (isLiteralLine(line)) {
    const close = ctx.a.doc.lines[ctx.a.doc.blocks[line.block!].close];
    return done([{ from: close.to, to: close.to, insert: `\n${md}` }], close.to + 1 + md.length);
  }
  if (line.kind === "image") return done([{ from: line.to, to: line.to, insert: `\n${md}` }], line.to + 1 + md.length);
  if (atHeadingTextStart(ctx, line, pos)) return done([{ from: line.from, to: line.from, insert: `${md}\n` }], line.from + md.length + 1);
  const expand: string[] = [];
  const fold = folds(ctx).find((f) => pos === f.from);
  if (fold) expand.push(fold.key);
  const row = rowOf(ctx, line.index);
  const segs: Seg[] = [];
  if (line.kind === "heading" || visibleBefore(row, pos).length) segs.push({ type: "break" });
  segs.push({ type: "raw", text: md });
  if (visibleAfter(row, pos).length) segs.push({ type: "break" });
  return editRange(ctx, pos, pos, segs, { expand });
}

/** The same in raw mode: plain text, line breaks added as needed. */
export function insertScreenshotRaw(text: string, pos: number, name: string): EditResult {
  const md = `![](${name})`;
  const before = pos > 0 && text[pos - 1] !== "\n";
  const after = pos < text.length && text[pos] !== "\n";
  const insert = `${before ? "\n" : ""}${md}${after ? "\n" : ""}`;
  return done([{ from: pos, to: pos, insert }], pos + insert.length);
}
