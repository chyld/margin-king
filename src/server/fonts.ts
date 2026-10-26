// Fonts (architecture §15, Fonts): the admin's `monospace/` and `other/` folders, read once at
// startup. Fonts are identified by the metadata inside each file, so any unzipped layout works.
// Scanning never stops the server: every problem is logged and that entry skipped.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { brotliDecompressSync, inflateSync } from "node:zlib";
import { isFontId, MAX_FONT_ID } from "../shared/syntax.ts";

/** What Margin reads from a font file. */
export interface FaceInfo {
  family: string;
  /** `OS/2` usWeightClass (400 without one). */
  weight: number;
  italic: boolean;
  /** The `wght` axis of a variable font. */
  range: [number, number] | null;
  /** `post.isFixedPitch`, or null without a `post` table. */
  fixedPitch: boolean | null;
  format: Format;
}

type Format = "woff2" | "woff" | "truetype" | "opentype";

const FORMATS: Record<Format, { ext: string; type: string; rank: number }> = {
  woff2: { ext: "woff2", type: "font/woff2", rank: 0 },
  woff: { ext: "woff", type: "font/woff", rank: 1 },
  truetype: { ext: "ttf", type: "font/ttf", rank: 2 },
  opentype: { ext: "otf", type: "font/otf", rank: 3 },
};

const FONT_EXTS = new Set([".woff2", ".woff", ".ttf", ".otf"]);
const COLLECTION_EXTS = new Set([".ttc", ".otc"]);
const WANTED = new Set(["name", "OS/2", "head", "post", "fvar"]);

export class FontError extends Error {}

// ---------------------------------------------------------------------------------------------
// Reading tables out of sfnt, WOFF and WOFF2 files

function tag(buf: Buffer, at: number): string {
  return buf.toString("latin1", at, at + 4);
}

function need(buf: Buffer, end: number): void {
  if (end > buf.length) throw new FontError("the file is cut short");
}

function sfntTables(buf: Buffer): Map<string, Buffer> {
  need(buf, 12);
  const count = buf.readUInt16BE(4);
  need(buf, 12 + count * 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const name = tag(buf, at);
    if (!WANTED.has(name)) continue;
    const offset = buf.readUInt32BE(at + 8);
    const length = buf.readUInt32BE(at + 12);
    need(buf, offset + length);
    out.set(name, buf.subarray(offset, offset + length));
  }
  return out;
}

function woffTables(buf: Buffer): Map<string, Buffer> {
  need(buf, 44);
  const count = buf.readUInt16BE(12);
  need(buf, 44 + count * 20);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const name = tag(buf, at);
    if (!WANTED.has(name)) continue;
    const offset = buf.readUInt32BE(at + 4);
    const compLength = buf.readUInt32BE(at + 8);
    const origLength = buf.readUInt32BE(at + 12);
    need(buf, offset + compLength);
    const data = buf.subarray(offset, offset + compLength);
    out.set(name, compLength < origLength ? inflateSync(data) : data);
  }
  return out;
}

// WOFF2's known-table tags, by index (the WOFF2 spec's table 1).
const WOFF2_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX " +
  "vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat " +
  "fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .match(/.{4}\s?/g)!
  .map((t) => t.slice(0, 4));

function woff2Tables(buf: Buffer): Map<string, Buffer> {
  need(buf, 48);
  if (tag(buf, 4) === "ttcf") throw new FontError("font collections aren't supported");
  const count = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      need(buf, at + 1);
      const b = buf[at++];
      if (i === 0 && b === 0x80) throw new FontError("a bad WOFF2 table directory");
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new FontError("a bad WOFF2 table directory");
  };
  const entries: { name: string; length: number }[] = [];
  for (let i = 0; i < count; i++) {
    need(buf, at + 1);
    const flags = buf[at++];
    let name: string;
    if ((flags & 0x3f) === 63) {
      need(buf, at + 4);
      name = tag(buf, at);
      at += 4;
    } else {
      name = WOFF2_TAGS[flags & 0x3f];
    }
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed unless their version is 3; every other table, unless it's 0.
    const transformed = name === "glyf" || name === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    entries.push({ name, length });
  }
  need(buf, at + compressed);
  const data = brotliDecompressSync(buf.subarray(at, at + compressed));
  const out = new Map<string, Buffer>();
  let offset = 0;
  for (const e of entries) {
    if (WANTED.has(e.name)) {
      if (offset + e.length > data.length) throw new FontError("the file is cut short");
      out.set(e.name, data.subarray(offset, offset + e.length));
    }
    offset += e.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading the metadata

function nameOf(table: Buffer | undefined, id: number): string | null {
  if (!table || table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  // Windows English, then any Windows Unicode, then Mac Roman, then Unicode.
  let best: { rank: number; text: string } | null = null;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (at + 12 > table.length) break;
    if (table.readUInt16BE(at + 6) !== id) continue;
    const platform = table.readUInt16BE(at);
    const encoding = table.readUInt16BE(at + 2);
    const language = table.readUInt16BE(at + 4);
    const length = table.readUInt16BE(at + 8);
    const offset = strings + table.readUInt16BE(at + 10);
    if (offset + length > table.length) continue;
    const bytes = table.subarray(offset, offset + length);
    let rank: number;
    let text: string;
    if (platform === 3 && [0, 1, 10].includes(encoding)) {
      rank = encoding !== 0 && language === 0x409 ? 0 : 1;
      text = utf16be(bytes);
    } else if (platform === 1 && encoding === 0) {
      rank = 2;
      text = bytes.toString("latin1");
    } else if (platform === 0) {
      rank = 3;
      text = utf16be(bytes);
    } else {
      continue;
    }
    text = text.replace(/\0/g, "").trim();
    if (text && (!best || rank < best.rank)) best = { rank, text };
  }
  return best?.text ?? null;
}

function utf16be(bytes: Buffer): string {
  const swapped = Buffer.from(bytes.subarray(0, bytes.length & ~1));
  swapped.swap16();
  return swapped.toString("utf16le");
}

/** The family, weight, style and axes of one font file. Throws a FontError if it isn't one. */
export function readFaceInfo(buf: Buffer): FaceInfo {
  need(buf, 4);
  const magic = tag(buf, 0);
  let tables: Map<string, Buffer>;
  let format: Format;
  if (magic === "wOF2") {
    tables = woff2Tables(buf);
    format = "woff2";
  } else if (magic === "wOFF") {
    tables = woffTables(buf);
    format = "woff";
  } else if (magic === "OTTO") {
    tables = sfntTables(buf);
    format = "opentype";
  } else if (magic === "\0\x01\0\0" || magic === "true") {
    tables = sfntTables(buf);
    format = "truetype";
  } else if (magic === "ttcf") {
    throw new FontError("font collections aren't supported");
  } else {
    throw new FontError("not a font file");
  }
  const name = tables.get("name");
  const family = nameOf(name, 16) ?? nameOf(name, 1);
  if (!family) throw new FontError("it has no family name");
  const os2 = tables.get("OS/2");
  let weight = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : 400;
  // Some old fonts use 1–9.
  if (weight >= 1 && weight <= 9) weight *= 100;
  weight = Math.min(1000, Math.max(1, weight || 400));
  const head = tables.get("head");
  // Italic by its flags, or by its style name (some fonts' flags say Regular for an italic).
  const style = nameOf(name, 17) ?? nameOf(name, 2) ?? "";
  const italic =
    (!!os2 && os2.length >= 64 && (os2.readUInt16BE(62) & 0b10_0000_0001) !== 0) ||
    (!!head && head.length >= 46 && (head.readUInt16BE(44) & 0b10) !== 0) ||
    /italic|oblique/i.test(style);
  const post = tables.get("post");
  const fixedPitch = post && post.length >= 16 ? post.readUInt32BE(12) !== 0 : null;
  return { family, weight, italic, range: weightAxis(tables.get("fvar")), fixedPitch, format };
}

function weightAxis(fvar: Buffer | undefined): [number, number] | null {
  if (!fvar || fvar.length < 16) return null;
  const axes = fvar.readUInt16BE(4);
  const count = fvar.readUInt16BE(8);
  const size = fvar.readUInt16BE(10);
  for (let i = 0; i < count; i++) {
    const at = axes + i * size;
    if (at + 16 > fvar.length) break;
    if (tag(fvar, at) !== "wght") continue;
    const clamp = (n: number) => Math.min(1000, Math.max(1, Math.round(n / 65536)));
    const min = clamp(fvar.readInt32BE(at + 4));
    const max = clamp(fvar.readInt32BE(at + 12));
    return min <= max ? [min, max] : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The folders

/** "JetBrains Mono" → `jetbrains-mono`; null if nothing is left. */
export function fontId(name: string): string | null {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FONT_ID)
    .replace(/-+$/, "");
  return isFontId(slug) ? slug : null;
}

export interface Face {
  /** A CSS `font-weight`: "400", "700", or a variable font's "100 900". */
  weight: string;
  format: Format;
  url: string;
  /** The file it came from, relative to its folder (for the log). */
  file: string;
  bytes: Buffer;
  type: string;
}

export interface Font {
  id: string;
  name: string;
  mono: boolean;
  faces: Face[];
}

interface Candidate {
  path: string;
  rel: string;
  info: FaceInfo;
}

const KINDS = [
  { dir: "monospace", mono: true },
  { dir: "other", mono: false },
] as const;

/** The fonts found at startup, with their chosen faces held in memory. */
export class FontTable {
  readonly fonts: Font[];
  private readonly byUrl = new Map<string, Face>();

  constructor(fonts: Font[]) {
    this.fonts = fonts;
    for (const f of fonts) for (const face of f.faces) this.byUrl.set(face.url, face);
  }

  /** What `GET /api/fonts` returns. */
  list(): { fonts: { id: string; name: string; mono: boolean; faces: { weight: string; format: Format; url: string }[] }[] } {
    return {
      fonts: this.fonts.map((f) => ({
        id: f.id,
        name: f.name,
        mono: f.mono,
        faces: f.faces.map((face) => ({ weight: face.weight, format: face.format, url: face.url })),
      })),
    };
  }

  /** The face at `/api/fonts/<id>/<file>`, looked up exactly. */
  face(id: string, file: string): Face | undefined {
    return this.byUrl.get(`/api/fonts/${id}/${file}`);
  }
}

type Log = (msg: string) => void;

/** Every font file under `root/kind` (any depth): regular files and real directories only. */
async function walk(root: string, kind: string, rel: string, out: string[], log: Log, ignored: { n: number }): Promise<void> {
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch (err) {
    log(`fonts: can't read ${kind}/${rel} (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}); skipped`);
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    // macOS zips carry `__MACOSX/` and `._*` files that aren't fonts.
    if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) {
      log(`fonts: ${kind}/${path} is a symlink; skipped`);
    } else if (e.isDirectory()) {
      await walk(root, kind, path, out, log, ignored);
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if (FONT_EXTS.has(ext)) out.push(path);
      else if (COLLECTION_EXTS.has(ext)) log(`fonts: ${kind}/${path}: font collections aren't supported; skipped`);
      else if (ext === ".zip") log(`fonts: ${kind}/${path}: unzip it first; skipped`);
      else ignored.n++;
    }
  }
}

const byPath = (a: Candidate, b: Candidate) => FORMATS[a.info.format].rank - FORMATS[b.info.format].rank || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

/** The faces a family is served with: its variable face, or a regular and (if it has one) a bold. */
function chooseFaces(cands: Candidate[]): { cand: Candidate; weight: string }[] {
  const variable = cands.filter((c) => c.info.range).sort(byPath)[0];
  if (variable) return [{ cand: variable, weight: `${variable.info.range![0]} ${variable.info.range![1]}` }];
  const nearest = (list: Candidate[], to: number) =>
    [...list].sort((a, b) => Math.abs(a.info.weight - to) - Math.abs(b.info.weight - to) || a.info.weight - b.info.weight || byPath(a, b))[0];
  const regular = nearest(cands, 400);
  const out = [{ cand: regular, weight: "400" }];
  const bold = nearest(
    cands.filter((c) => c.info.weight >= 600 && c.info.weight > regular.info.weight),
    700,
  );
  if (bold) out.push({ cand: bold, weight: "700" });
  return out;
}

/**
 * Read the font folders. `dir` undefined means no fonts. Never throws: every problem is logged and
 * that entry skipped.
 */
export async function loadFonts(dir: string | undefined, log: Log = (m) => console.log(m)): Promise<FontTable> {
  if (!dir) return new FontTable([]);
  const fonts: Font[] = [];
  const used = new Set<string>();
  for (const kind of KINDS) {
    const root = join(dir, kind.dir);
    try {
      await readdir(root);
    } catch {
      log(`fonts: no ${kind.dir}/ folder in ${dir}; no ${kind.dir === "monospace" ? "monospace" : "other"} fonts`);
      continue;
    }
    const paths: string[] = [];
    const ignored = { n: 0 };
    await walk(root, kind.dir, "", paths, log, ignored);
    if (ignored.n) log(`fonts: ${kind.dir}/: ignored ${ignored.n} file${ignored.n === 1 ? "" : "s"} that aren't fonts`);

    // 1. Each file's metadata (the bytes aren't kept: a folder can hold many large files).
    const families = new Map<string, Candidate[]>();
    const italics = new Set<string>();
    for (const rel of paths) {
      const path = join(root, rel);
      try {
        const info = readFaceInfo(await readFile(path));
        if (info.italic) {
          italics.add(info.family);
          continue;
        }
        const list = families.get(info.family) ?? [];
        list.push({ path, rel, info });
        families.set(info.family, list);
      } catch (err) {
        const why = err instanceof FontError ? err.message : ((err as NodeJS.ErrnoException).code ?? (err as Error).message);
        log(`fonts: ${kind.dir}/${rel}: ${why}; skipped`);
      }
    }

    for (const name of italics) if (!families.has(name)) log(`fonts: "${name}" (${kind.dir}/) has only italic faces; skipped`);

    // 2. One font per family, its faces read again and kept.
    const names = [...families.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const id = fontId(name);
      if (!id) {
        log(`fonts: "${name}" (${kind.dir}/) has no letters or digits for an id; skipped`);
        continue;
      }
      if (used.has(id)) {
        log(`fonts: "${name}" (${kind.dir}/) has the same id as another font, ${id}; skipped`);
        continue;
      }
      const faces: Face[] = [];
      for (const { cand, weight } of chooseFaces(families.get(name)!)) {
        try {
          const bytes = await readFile(cand.path);
          if (readFaceInfo(bytes).family !== name) throw new FontError("it changed while being read");
          const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
          const f = FORMATS[cand.info.format];
          faces.push({ weight, format: cand.info.format, url: `/api/fonts/${id}/${hash}.${f.ext}`, file: cand.rel, bytes, type: f.type });
        } catch (err) {
          const why = err instanceof FontError ? err.message : ((err as NodeJS.ErrnoException).code ?? (err as Error).message);
          log(`fonts: ${kind.dir}/${cand.rel}: ${why}; skipped`);
        }
      }
      if (!faces.some((f) => f.weight !== "700")) continue;
      used.add(id);
      fonts.push({ id, name, mono: kind.mono, faces });
      const pitch = kind.mono && families.get(name)!.some((c) => c.info.fixedPitch === false) ? " (its file says it isn't fixed-pitch)" : "";
      log(`fonts: ${kind.dir}: ${name} as ${id}${pitch}: ${faces.map((f) => `${f.weight} ${f.file}`).join(", ")}`);
    }
  }
  fonts.sort((a, b) => Number(b.mono) - Number(a.mono) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const total = fonts.reduce((n, f) => n + f.faces.reduce((m, face) => m + face.bytes.length, 0), 0);
  if (fonts.length) log(`fonts: ${fonts.length} font${fonts.length === 1 ? "" : "s"}, ${(total / 1048576).toFixed(1)} MB in memory`);
  return new FontTable(fonts);
}
