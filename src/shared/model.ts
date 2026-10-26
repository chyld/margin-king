// The styled-character line model (architecture §6.3).
//
// A line becomes a list of visible characters with styles; hidden syntax is gone. Operations change
// the list, and `serialize` writes syntax back, keeping the original syntax wherever the operation
// didn't change it. Output is a list of pieces: retained characters (by their old document offset)
// and new text, so the caller can build a change set that keeps retained characters in place.

import { lineTokens, parseDoc, sameOpts, serializeOptions, type Line, type Opts, type Token } from "./syntax.ts";

export interface Style {
  color: string | null;
  b: boolean;
  u: boolean;
  code: boolean;
}

/** The original highlight a character came from, so its marker bytes can be kept. */
export interface HlSrc {
  id: number;
  opts: Opts;
  optsText: string;
}

export interface LinkRef {
  id: number;
  url: string;
  form: "md" | "bare";
}

export interface VChar {
  kind: "char";
  ch: string;
  /** Offset in the original document; -1 for new characters. */
  raw: number;
  style: Style;
  /** The original highlight this character belongs to, or null (none, new, or restyled). */
  hl: HlSrc | null;
  /** Which inline-code token it belongs to (-1 if not code). */
  codeId: number;
  link: LinkRef | null;
}

/** Text inserted as raw syntax at the top level (pasted formatting). */
export interface RawItem {
  kind: "raw";
  text: string;
}

/**
 * Where a caret or selection end lands. `prev` sticks to the character before (inside its
 * tokens), `next` to the character after, `out` stays outside tokens at a token boundary.
 */
export interface CaretItem {
  kind: "caret";
  id: string;
  aff: "prev" | "next" | "out";
}

export type Item = VChar | RawItem | CaretItem;

export type RowKind = "text" | "heading" | "literal" | "image";

export interface Row {
  kind: RowKind;
  /** A heading's `## {color} `, else "". */
  prefix: string;
  /** Document offset of the original prefix if it's unchanged, else -1. */
  prefixRaw: number;
  items: Item[];
}

export const PLAIN: Style = Object.freeze({ color: null, b: false, u: false, code: false });

let idSeq = 1;
export function freshId(): number {
  return idSeq++;
}

export function isChar(item: Item): item is VChar {
  return item.kind === "char";
}

export function chars(row: Row): VChar[] {
  return row.items.filter(isChar);
}

function makeChar(ch: string, raw: number, hl: HlSrc | null, codeId: number, link: LinkRef | null): VChar {
  return {
    kind: "char",
    ch,
    raw,
    style: { color: hl?.opts.color ?? null, b: hl?.opts.b ?? false, u: hl?.opts.u ?? false, code: codeId >= 0 },
    hl,
    codeId,
    link,
  };
}

/** Visible characters of `text[start..]` with `tokens`, offsets shifted by `base`. */
export function buildChars(text: string, base: number, start: number, tokens: Token[]): VChar[] {
  const out: VChar[] = [];
  const walk = (a: number, b: number, toks: Token[], hl: HlSrc | null) => {
    let pos = a;
    for (const t of toks) {
      if (t.from < pos || t.to > b) continue;
      for (let k = pos; k < t.from; k++) out.push(makeChar(text[k], base + k, hl, -1, null));
      if (t.type === "hl") {
        walk(t.contentFrom, t.contentTo, t.children ?? [], { id: freshId(), opts: t.opts!, optsText: t.optsText! });
      } else if (t.type === "code") {
        const id = freshId();
        for (let k = t.contentFrom; k < t.contentTo; k++) out.push(makeChar(text[k], base + k, hl, id, null));
      } else {
        const link: LinkRef = { id: freshId(), url: t.url!, form: t.type === "link" ? "md" : "bare" };
        for (let k = t.contentFrom; k < t.contentTo; k++) out.push(makeChar(text[k], base + k, hl, -1, link));
      }
      pos = t.to;
    }
    for (let k = pos; k < b; k++) out.push(makeChar(text[k], base + k, hl, -1, null));
  };
  walk(start, text.length, tokens, null);
  return out;
}

function literalChars(text: string, base: number): VChar[] {
  const out: VChar[] = [];
  for (let k = 0; k < text.length; k++) out.push(makeChar(text[k], base + k, null, -1, null));
  return out;
}

/** The row for a document line, from its tokens. */
export function buildRow(line: Line, tokens: Token[]): Row {
  switch (line.kind) {
    case "text":
      return { kind: "text", prefix: "", prefixRaw: -1, items: buildChars(line.text, line.from, 0, tokens) };
    case "heading":
      return {
        kind: "heading",
        prefix: line.text.slice(0, line.prefixLen),
        prefixRaw: line.from,
        items: buildChars(line.text, line.from, line.prefixLen!, tokens),
      };
    case "image":
      return { kind: "image", prefix: "", prefixRaw: -1, items: literalChars(line.text, line.from) };
    default:
      return { kind: "literal", prefix: "", prefixRaw: -1, items: literalChars(line.text, line.from) };
  }
}

/** New characters for `text`, with the given style, highlight source, code id and link. */
export function newChars(text: string, like: Pick<VChar, "style" | "hl" | "codeId" | "link"> | null): VChar[] {
  const out: VChar[] = [];
  for (const ch of text.split("")) {
    out.push({
      kind: "char",
      ch,
      raw: -1,
      style: like ? { ...like.style } : { ...PLAIN },
      hl: like?.hl ?? null,
      codeId: like?.codeId ?? -1,
      link: like?.link ?? null,
    });
  }
  return out;
}

export function sameStyle3(a: Style, b: Style): boolean {
  return a.color === b.color && a.b === b.b && a.u === b.u;
}

function styled(s: Style): boolean {
  return s.color !== null || s.b || s.u;
}

export function setStyle3(c: VChar, s: { color: string | null; b: boolean; u: boolean }): void {
  if (c.style.color === s.color && c.style.b === s.b && c.style.u === s.u) return;
  c.style = { ...c.style, color: s.color, b: s.b, u: s.u };
  c.hl = null;
}

// ---------------------------------------------------------------------------------------------
// Serialization

export type Piece = string | number;

export class Out {
  pieces: Piece[] = [];
  length = 0;
  carets = new Map<string, number>();

  text(s: string): void {
    if (!s) return;
    this.pieces.push(s);
    this.length += s.length;
  }

  char(c: VChar): void {
    if (c.raw >= 0) {
      this.pieces.push(c.raw);
      this.length += 1;
    } else {
      this.text(c.ch);
    }
  }

  caret(id: string): void {
    this.carets.set(id, this.length);
  }

  /** The output as a plain string, given the original document for retained characters. */
  toString(slice: (from: number, to: number) => string): string {
    return this.pieces.map((p) => (typeof p === "number" ? slice(p, p + 1) : p)).join("");
  }
}

interface Run {
  style: Style;
  src: HlSrc | null;
  start: number;
  end: number;
}

/** Highlight runs: equal (color, b, u), and never two different original highlights merged. */
export function groupRuns(cs: VChar[]): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const cur = runs[runs.length - 1];
    if (
      cur &&
      sameStyle3(cur.style, c.style) &&
      (!styled(c.style) || !c.hl || !cur.src || cur.src.id === c.hl.id)
    ) {
      cur.end = i + 1;
      if (styled(c.style) && !cur.src && c.hl) cur.src = c.hl;
    } else {
      runs.push({ style: c.style, src: styled(c.style) ? c.hl : null, start: i, end: i + 1 });
    }
  }
  return runs;
}

function openingMarker(run: Run): string {
  const opts: Opts = { color: run.style.color, b: run.style.b, u: run.style.u };
  if (run.src && sameOpts(run.src.opts, opts)) return `=={${run.src.optsText}}`;
  return `=={${serializeOptions(opts)}}`;
}

function emitSegment(out: Out, items: Item[]): void {
  const cs: VChar[] = [];
  for (const it of items) if (it.kind === "char") cs.push(it);
  const runs = groupRuns(cs);
  const runOf: number[] = [];
  runs.forEach((r, ri) => {
    for (let i = r.start; i < r.end; i++) runOf[i] = ri;
  });
  // Inner segment of a character: which link or code token (or plain) inside its run.
  const segKey = (i: number) => {
    const c = cs[i];
    if (c.link) return `l${c.link.id}`;
    if (c.style.code) return `c${c.codeId}`;
    return "p";
  };

  const before = new Map<number, string[]>();
  const after = new Map<number, string[]>();
  const afterSeg = new Map<number, string[]>();
  const gap = new Map<number, string[]>();
  const add = (m: Map<number, string[]>, k: number, id: string) => {
    const list = m.get(k);
    if (list) list.push(id);
    else m.set(k, [id]);
  };
  let ci = 0;
  for (const it of items) {
    if (it.kind === "char") {
      ci++;
      continue;
    }
    if (it.kind !== "caret") continue;
    const prev = ci - 1;
    const next = ci < cs.length ? ci : -1;
    if (it.aff === "prev") {
      if (prev >= 0) add(after, prev, it.id);
      else if (next >= 0) add(before, next, it.id);
      else add(gap, ci, it.id);
    } else if (it.aff === "next") {
      if (next >= 0) add(before, next, it.id);
      else if (prev >= 0) add(after, prev, it.id);
      else add(gap, ci, it.id);
    } else if (prev >= 0 && next >= 0 && runOf[prev] === runOf[next]) {
      if (segKey(prev) === segKey(next)) add(after, prev, it.id);
      else add(afterSeg, prev, it.id);
    } else {
      add(gap, ci, it.id);
    }
  }

  const emitCarets = (list: string[] | undefined) => {
    if (list) for (const id of list) out.caret(id);
  };
  const emitChars = (a: number, b: number) => {
    for (let k = a; k < b; k++) {
      emitCarets(before.get(k));
      out.char(cs[k]);
      emitCarets(after.get(k));
    }
  };

  for (const run of runs) {
    emitCarets(gap.get(run.start));
    const isStyled = styled(run.style);
    if (isStyled) out.text(openingMarker(run));
    let i = run.start;
    while (i < run.end) {
      const c = cs[i];
      let j = i + 1;
      if (c.link) {
        while (j < run.end && cs[j].link?.id === c.link.id) j++;
        if (c.link.form === "md") {
          out.text("[");
          emitChars(i, j);
          out.text(`](${c.link.url})`);
        } else {
          emitChars(i, j);
        }
      } else if (c.style.code) {
        while (j < run.end && !cs[j].link && cs[j].style.code && cs[j].codeId === c.codeId) j++;
        out.text("`");
        emitChars(i, j);
        out.text("`");
      } else {
        while (j < run.end && !cs[j].link && !cs[j].style.code) j++;
        emitChars(i, j);
      }
      emitCarets(afterSeg.get(j - 1));
      i = j;
    }
    if (isStyled) out.text("==");
  }
  emitCarets(gap.get(cs.length));
}

export function serializeRow(out: Out, row: Row): void {
  if (row.prefix) {
    if (row.prefixRaw >= 0) {
      for (let k = 0; k < row.prefix.length; k++) {
        out.pieces.push(row.prefixRaw + k);
        out.length += 1;
      }
    } else {
      out.text(row.prefix);
    }
  }
  if (row.kind === "literal" || row.kind === "image") {
    for (const it of row.items) {
      if (it.kind === "char") out.char(it);
      else if (it.kind === "caret") out.caret(it.id);
      else out.text(it.text);
    }
    return;
  }
  let seg: Item[] = [];
  for (const it of row.items) {
    if (it.kind === "raw") {
      emitSegment(out, seg);
      seg = [];
      out.text(it.text);
    } else {
      seg.push(it);
    }
  }
  emitSegment(out, seg);
}

/** Rows joined by line breaks. */
export function serializeRows(rows: Row[]): Out {
  const out = new Out();
  rows.forEach((row, i) => {
    if (i > 0) out.text("\n");
    serializeRow(out, row);
  });
  return out;
}

/**
 * Where a style change cuts through a `[text](url)` link, the parts become separate links to the
 * same address (they're written that way, and look and act as one). Bare URLs can't be split.
 */
export function splitLinksAtStyleBoundaries(row: Row): void {
  const cs = chars(row);
  const runs = groupRuns(cs);
  const runOf: number[] = [];
  runs.forEach((r, ri) => {
    for (let i = r.start; i < r.end; i++) runOf[i] = ri;
  });
  const firstRun = new Map<number, number>();
  const parts = new Map<string, LinkRef>();
  cs.forEach((c, i) => {
    if (c.link?.form !== "md") return;
    const run = runOf[i];
    if (!firstRun.has(c.link.id)) firstRun.set(c.link.id, run);
    if (firstRun.get(c.link.id) === run) return;
    const key = `${c.link.id}:${run}`;
    let ref = parts.get(key);
    if (!ref) parts.set(key, (ref = { id: freshId(), url: c.link.url, form: "md" }));
    c.link = ref;
  });
}

/** Map a position through sorted, non-overlapping changes (a position inside a replaced range goes to its start). */
export function mapThrough(pos: number, changes: Change[]): number {
  let delta = 0;
  for (const c of changes) {
    if (c.to <= pos) delta += c.insert.length - (c.to - c.from);
    else if (c.from < pos) return c.from + delta;
    else break;
  }
  return pos + delta;
}

// ---------------------------------------------------------------------------------------------
// Change sets from pieces

export interface Change {
  from: number;
  to: number;
  insert: string;
}

/**
 * Changes that turn the document's [from, to) into the pieces, keeping every retained character
 * in place: only the gaps between retained characters change.
 */
export function piecesToChanges(
  pieces: Piece[],
  from: number,
  to: number,
  slice: (a: number, b: number) => string,
): Change[] {
  const changes: Change[] = [];
  let oldPos = from;
  let buf = "";
  const flush = (end: number) => {
    const old = slice(oldPos, end);
    const inside = old ? buf.indexOf(old) : -1;
    if (old !== buf && inside >= 0) {
      // The old text survives inside the new: insert around it instead of replacing it.
      if (inside > 0) changes.push({ from: oldPos, to: oldPos, insert: buf.slice(0, inside) });
      if (inside + old.length < buf.length) changes.push({ from: end, to: end, insert: buf.slice(inside + old.length) });
    } else if (old !== buf) {
      let pre = 0;
      const max = Math.min(old.length, buf.length);
      while (pre < max && old.charCodeAt(pre) === buf.charCodeAt(pre)) pre++;
      let suf = 0;
      while (suf < max - pre && old.charCodeAt(old.length - 1 - suf) === buf.charCodeAt(buf.length - 1 - suf)) suf++;
      changes.push({ from: oldPos + pre, to: end - suf, insert: buf.slice(pre, buf.length - suf) });
    }
    buf = "";
  };
  for (const p of pieces) {
    if (typeof p === "number") {
      if (p < oldPos || p >= to) {
        buf += slice(p, p + 1);
        continue;
      }
      flush(p);
      oldPos = p + 1;
    } else {
      buf += p;
    }
  }
  flush(to);
  return changes;
}

/** Apply changes (sorted, non-overlapping, against `text`) to a string. */
export function applyChanges(text: string, changes: Change[]): string {
  let out = "";
  let pos = 0;
  for (const c of changes) {
    out += text.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + text.slice(pos);
}

// ---------------------------------------------------------------------------------------------
// Re-parsing, for verification

/** Visible characters of a single line of text, parsed on its own as the kind it now has. */
export function charsOfLine(text: string): { kind: Line["kind"]; chars: VChar[] } {
  const line = parseDoc(text).lines[0];
  if (line.kind !== "text" && line.kind !== "heading") return { kind: line.kind, chars: [] };
  return { kind: line.kind, chars: buildChars(text, 0, line.kind === "heading" ? line.prefixLen! : 0, lineTokens(line)) };
}

/** Do two character lists show the same thing (text, styles, links and link extents)? */
export function sameVisible(a: VChar[], b: VChar[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.ch !== y.ch) return false;
    if (!sameStyle3(x.style, y.style) || x.style.code !== y.style.code) return false;
    if (!!x.link !== !!y.link) return false;
    if (x.link && y.link && (x.link.url !== y.link.url || x.link.form !== y.link.form)) return false;
    if (i > 0) {
      const sameA = !!x.link && a[i - 1].link?.id === x.link.id;
      const sameB = !!y.link && b[i - 1].link?.id === y.link.id;
      if (sameA !== sameB) return false;
    }
  }
  return true;
}

/**
 * Highlight text can't end with `=` (it merges with the closing `==`) or start with `==`. Turn such
 * `=` characters plain. Returns whether anything changed.
 */
export function fixEquals(row: Row): boolean {
  const cs = chars(row);
  let changed = false;
  for (const run of groupRuns(cs)) {
    if (!styled(run.style)) continue;
    let end = run.end;
    while (end > run.start && cs[end - 1].ch === "=" && !cs[end - 1].link && !cs[end - 1].style.code) {
      end--;
      setStyle3(cs[end], { color: null, b: false, u: false });
      changed = true;
    }
    let start = run.start;
    while (start + 1 < end && cs[start].ch === "=" && cs[start + 1].ch === "=" && !cs[start].link && !cs[start].style.code) {
      setStyle3(cs[start], { color: null, b: false, u: false });
      start++;
      changed = true;
    }
  }
  return changed;
}
