// Text derived from the note format: what render mode shows, and a note's title.

import { lineTokens, normalizeNewlines, parseDoc, type Line, type Token } from "./syntax.ts";

function visibleOf(s: string, from: number, to: number, tokens: Token[]): string {
  let out = "";
  let pos = from;
  for (const t of tokens) {
    if (t.from < pos || t.to > to) continue;
    out += s.slice(pos, t.from);
    if (t.type === "hl") out += visibleOf(s, t.contentFrom, t.contentTo, t.children ?? []);
    else out += s.slice(t.contentFrom, t.contentTo);
    pos = t.to;
  }
  return out + s.slice(pos, to);
}

/** The visible text of a document line, as render mode shows it. */
export function lineVisibleText(line: Line): string {
  switch (line.kind) {
    case "text":
      return visibleOf(line.text, 0, line.text.length, lineTokens(line));
    case "heading":
      return visibleOf(line.text, line.prefixLen!, line.text.length, lineTokens(line));
    case "code":
      return line.text;
    default:
      return "";
  }
}

/** The visible text of one line taken on its own (no code-block context). */
export function stripInline(lineText: string): string {
  return lineVisibleText(parseDoc(lineText).lines[0]);
}

/** What render mode shows: syntax, fences and screenshots removed, code kept. Used for search. */
export function visibleText(text: string): string {
  return parseDoc(text)
    .lines.map(lineVisibleText)
    .join("\n");
}

/** The first line's visible text, trimmed ("" shows as Untitled). */
export function noteTitle(text: string): string {
  const normalized = normalizeNewlines(text);
  const doc = parseDoc(normalized);
  return lineVisibleText(doc.lines[0]).trim();
}

/** Lowercased visible text, the server's search index for one note. */
export function searchText(text: string): string {
  return visibleText(text).toLowerCase();
}
