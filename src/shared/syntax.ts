// The note format (README §3.5): document structure and inline tokens.
// Offsets are UTF-16 code units, like CodeMirror's.

import { isColor } from "./palette.ts";

export type LineKind = "text" | "heading" | "image" | "fence-open" | "code" | "fence-close";

export interface Opts {
  color: string | null;
  b: boolean;
  u: boolean;
}

export type TokenType = "hl" | "code" | "link" | "url";

export interface Token {
  type: TokenType;
  /** Start of the token's syntax, as an offset in the string that was parsed. */
  from: number;
  /** End of the token's syntax. */
  to: number;
  /** The visible part. */
  contentFrom: number;
  contentTo: number;
  /** Highlights: the options and their text as written (`u+lime`). */
  opts?: Opts;
  optsText?: string;
  /** Links and bare URLs. */
  url?: string;
  /** Highlights: inline code, links and bare URLs inside. */
  children?: Token[];
}

export interface Line {
  index: number;
  /** Document offsets. */
  from: number;
  to: number;
  text: string;
  kind: LineKind;
  /** Code-block index, for fence and code lines. */
  block?: number;
  /** Section index, for the heading and every line of its section. */
  section?: number;
  /** Headings: the section color and the length of `## {color} `. */
  color?: string;
  prefixLen?: number;
  /** Screenshot lines: the image name, and its width in % of the text column (null: natural size). */
  image?: string;
  imageWidth?: number | null;
}

export interface Block {
  /** Line indexes of the opening and closing fences. */
  open: number;
  close: number;
}

export interface Section {
  heading: number;
  /** Index of the section's last line. */
  end: number;
  color: string;
}

export interface Doc {
  lines: Line[];
  blocks: Block[];
  sections: Section[];
}

export const OPEN_FENCE_RE = /^```/;
export const CLOSE_FENCE_RE = /^```[ \t]*$/;
const HEADING_RE = /^## \{([a-z]+(?:-deep)?)\} (?=\S)/;
// `![](name.png)`, or `![60%](name.png)` for a width of 10–100% of the text column (owner decision).
const IMAGE_RE = /^!\[(?:(100|[1-9][0-9])%)?\]\(([a-z0-9]{8}\.png)\)$/;
const LINK_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^\s<>()[\]`]+)\)/;
const URL_RE = /^https?:\/\/[^\s<>()[\]`]+/;
const URL_TRAILING = /[.,;:!?'"*_~=]+$/;
const HL_OPEN_RE = /^==\{([a-z0-9+-]+)\}/;

/** Margin always writes `\n`; text copied in from elsewhere may have `\r\n` or `\r`. */
export function normalizeNewlines(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** `lime+b+u` → options, or null if invalid (an unknown or repeated option, an empty part). */
export function parseOptions(text: string): Opts | null {
  const opts: Opts = { color: null, b: false, u: false };
  for (const part of text.split("+")) {
    if (part === "b") {
      if (opts.b) return null;
      opts.b = true;
    } else if (part === "u") {
      if (opts.u) return null;
      opts.u = true;
    } else if (isColor(part)) {
      if (opts.color) return null;
      opts.color = part;
    } else {
      return null;
    }
  }
  return opts;
}

/** Options as Margin writes them: color, then `b`, then `u`. */
export function serializeOptions(opts: Opts): string {
  const parts: string[] = [];
  if (opts.color) parts.push(opts.color);
  if (opts.b) parts.push("b");
  if (opts.u) parts.push("u");
  return parts.join("+");
}

export function sameOpts(a: Opts, b: Opts): boolean {
  return a.color === b.color && a.b === b.b && a.u === b.u;
}

/** A heading's color and prefix length, or null if the line isn't a heading. */
export function matchHeading(text: string): { color: string; prefixLen: number } | null {
  const m = HEADING_RE.exec(text);
  if (!m || !isColor(m[1])) return null;
  return { color: m[1], prefixLen: m[0].length };
}

export const MIN_IMAGE_WIDTH = 10;
export const MAX_IMAGE_WIDTH = 100;

export function matchImage(text: string): { name: string; width: number | null } | null {
  const m = IMAGE_RE.exec(text);
  return m ? { name: m[2], width: m[1] ? Number(m[1]) : null } : null;
}

/** A screenshot line; `width` null is the natural size. Always one the parser reads back: the width
 *  is rounded and kept to 10–100. */
export function imageLine(name: string, width: number | null): string {
  if (width === null) return `![](${name})`;
  const w = Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, Math.round(width)));
  return `![${w}%](${name})`;
}

export function parseDoc(input: string): Doc {
  const text = normalizeNewlines(input);
  const texts = text.split("\n");
  const lines: Line[] = [];
  let offset = 0;
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    lines.push({ index: i, from: offset, to: offset + t.length, text: t, kind: "text" });
    offset += t.length + 1;
  }

  // 1. Code blocks: an opening fence pairs with the next closing fence. With no closing fence,
  // scanning for blocks stops and the rest is ordinary lines.
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN_FENCE_RE.test(lines[i].text)) continue;
    let j = i + 1;
    while (j < lines.length && !CLOSE_FENCE_RE.test(lines[j].text)) j++;
    if (j >= lines.length) break;
    const block = blocks.length;
    blocks.push({ open: i, close: j });
    lines[i].kind = "fence-open";
    lines[j].kind = "fence-close";
    lines[i].block = lines[j].block = block;
    for (let k = i + 1; k < j; k++) {
      lines[k].kind = "code";
      lines[k].block = block;
    }
    i = j;
  }

  // 2. Headings and 3. screenshots, among lines outside code blocks.
  const sections: Section[] = [];
  for (const line of lines) {
    if (line.kind !== "text") continue;
    const heading = matchHeading(line.text);
    if (heading) {
      line.kind = "heading";
      line.color = heading.color;
      line.prefixLen = heading.prefixLen;
      continue;
    }
    const image = matchImage(line.text);
    if (image) {
      line.kind = "image";
      line.image = image.name;
      line.imageWidth = image.width;
    }
  }

  // Sections run from a heading to the line before the next heading, or the last line.
  for (const line of lines) {
    if (line.kind !== "heading") continue;
    if (sections.length) sections[sections.length - 1].end = line.index - 1;
    sections.push({ heading: line.index, end: lines.length - 1, color: line.color! });
  }
  sections.forEach((section, i) => {
    for (let k = section.heading; k <= section.end; k++) lines[k].section = i;
  });

  return { lines, blocks, sections };
}

function isUrlBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[A-Za-z0-9/]/.test(ch);
}

function matchCode(s: string, i: number): Token | null {
  const close = s.indexOf("`", i + 1);
  if (close <= i + 1) return null;
  return { type: "code", from: i, to: close + 1, contentFrom: i + 1, contentTo: close };
}

function matchLink(s: string, i: number): Token | null {
  const m = LINK_RE.exec(s.slice(i));
  if (!m) return null;
  const textEnd = i + 1 + m[1].length;
  return { type: "link", from: i, to: i + m[0].length, contentFrom: i + 1, contentTo: textEnd, url: m[2] };
}

function matchUrl(s: string, i: number, end: number): Token | null {
  if (!isUrlBoundary(s[i - 1])) return null;
  const m = URL_RE.exec(s.slice(i, end));
  if (!m) return null;
  const url = m[0].replace(URL_TRAILING, "");
  if (!/^https?:\/\/./.test(url)) return null;
  return { type: "url", from: i, to: i + url.length, contentFrom: i, contentTo: i + url.length, url };
}

function matchHighlight(s: string, i: number): Token | null {
  const m = HL_OPEN_RE.exec(s.slice(i));
  if (!m) return null;
  const opts = parseOptions(m[1]);
  if (!opts) return null;
  const contentFrom = i + m[0].length;
  // The highlight ends at the first `==` that isn't inside inline code or a [text](url) link.
  let k = contentFrom;
  while (k < s.length - 1) {
    const c = s[k];
    if (c === "`") {
      const code = matchCode(s, k);
      if (code) {
        k = code.to;
        continue;
      }
    } else if (c === "[") {
      const link = matchLink(s, k);
      if (link) {
        k = link.to;
        continue;
      }
    } else if (c === "=" && s[k + 1] === "=") {
      break;
    }
    k++;
  }
  if (k >= s.length - 1 || k === contentFrom) return null;
  return {
    type: "hl",
    from: i,
    to: k + 2,
    contentFrom,
    contentTo: k,
    opts,
    optsText: m[1],
    children: scan(s, contentFrom, k, true),
  };
}

function scan(s: string, start: number, end: number, inHighlight: boolean): Token[] {
  const tokens: Token[] = [];
  let i = start;
  while (i < end) {
    const c = s[i];
    let token: Token | null = null;
    if (c === "`") token = matchCode(s, i);
    else if (c === "[") token = matchLink(s, i);
    else if (c === "h") token = matchUrl(s, i, end);
    else if (c === "=" && !inHighlight && s.startsWith("=={", i)) token = matchHighlight(s, i);
    if (token && token.to <= end) {
      tokens.push(token);
      i = token.to;
    } else {
      i++;
    }
  }
  return tokens;
}

/** The inline tokens of one line (or of a heading's text): left to right, first match wins. */
export function parseInline(text: string): Token[] {
  return scan(text, 0, text.length, false);
}

/** Inline tokens shifted by `offset`, children included. */
export function shiftTokens(tokens: Token[], offset: number): Token[] {
  if (offset === 0) return tokens;
  return tokens.map((t) => ({
    ...t,
    from: t.from + offset,
    to: t.to + offset,
    contentFrom: t.contentFrom + offset,
    contentTo: t.contentTo + offset,
    children: t.children ? shiftTokens(t.children, offset) : undefined,
  }));
}

/** The inline tokens of a document line: whole text lines, and the text of headings. */
export function lineTokens(line: Line): Token[] {
  if (line.kind === "text") return parseInline(line.text);
  if (line.kind === "heading") return shiftTokens(parseInline(line.text.slice(line.prefixLen)), line.prefixLen!);
  return [];
}
