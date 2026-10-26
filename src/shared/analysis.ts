// A parsed document with each line's inline tokens, plus the ranges render mode hides.

import { lineTokens, parseDoc, type Doc, type Line, type Token } from "./syntax.ts";

export interface Analysis {
  text: string;
  doc: Doc;
  /** Inline tokens per line, with offsets relative to the line start. */
  tokens: Token[][];
}

export function analyze(text: string): Analysis {
  const doc = parseDoc(text);
  return { text, doc, tokens: doc.lines.map(lineTokens) };
}

/** The line containing document offset `pos`. */
export function lineAt(a: Analysis, pos: number): Line {
  const lines = a.doc.lines;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].from <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo];
}

export interface Fold {
  /** The heading line's text, the key collapsed sections are remembered by (README §3.8). */
  key: string;
  heading: number;
  /** From the end of the heading line to the end of the section. */
  from: number;
  to: number;
}

/** Collapsed sections that have content to hide. */
export function foldRanges(a: Analysis, collapsed: ReadonlySet<string>): Fold[] {
  if (!collapsed.size) return [];
  const folds: Fold[] = [];
  for (const s of a.doc.sections) {
    const heading = a.doc.lines[s.heading];
    if (s.end <= s.heading || !collapsed.has(heading.text)) continue;
    folds.push({ key: heading.text, heading: s.heading, from: heading.to, to: a.doc.lines[s.end].to });
  }
  return folds;
}

export type HiddenKind = "open" | "close" | "prefix" | "fence" | "image" | "fold";

export interface Hidden {
  from: number;
  to: number;
  kind: HiddenKind;
}

function tokenHidden(tokens: Token[], base: number, out: Hidden[]): void {
  for (const t of tokens) {
    if (t.type === "hl") {
      out.push({ from: base + t.from, to: base + t.contentFrom, kind: "open" });
      tokenHidden(t.children ?? [], base, out);
      out.push({ from: base + t.contentTo, to: base + t.to, kind: "close" });
    } else if (t.type === "code" || t.type === "link") {
      out.push({ from: base + t.from, to: base + t.contentFrom, kind: "open" });
      out.push({ from: base + t.contentTo, to: base + t.to, kind: "close" });
    }
  }
}

/**
 * What render mode hides, sorted by position: syntax markers, heading prefixes, fence lines
 * (unless a caret is on them), screenshot lines, and collapsed sections' content.
 */
export function hiddenRanges(a: Analysis, collapsed: ReadonlySet<string>, caretLines: ReadonlySet<number>): Hidden[] {
  const out: Hidden[] = [];
  const folds = foldRanges(a, collapsed);
  let f = 0;
  for (const line of a.doc.lines) {
    while (f < folds.length && folds[f].to < line.from) f++;
    const fold = folds[f];
    if (fold && line.from > fold.from && line.from <= fold.to) continue;
    switch (line.kind) {
      case "heading":
        out.push({ from: line.from, to: line.from + line.prefixLen!, kind: "prefix" });
        tokenHidden(a.tokens[line.index], line.from, out);
        break;
      case "text":
        tokenHidden(a.tokens[line.index], line.from, out);
        break;
      case "fence-open":
      case "fence-close":
        if (!caretLines.has(line.index) && line.to > line.from) out.push({ from: line.from, to: line.to, kind: "fence" });
        break;
      case "image":
        out.push({ from: line.from, to: line.to, kind: "image" });
        break;
      default:
        break;
    }
    if (fold && fold.heading === line.index) out.push({ from: fold.from, to: fold.to, kind: "fold" });
  }
  return out;
}
