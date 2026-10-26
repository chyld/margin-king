// Font files for the font tests (architecture §15, Fonts), with just the tables Margin reads:
// `name`, `OS/2`, `head`, `post` and, for a variable font, `fvar`. Browsers can't render them.

import { brotliCompressSync, deflateSync } from "node:zlib";

export interface FakeFont {
  /** `name` ID 1. */
  family: string;
  /** `name` ID 16, the typographic family, if it differs. */
  typoFamily?: string;
  /** `name` ID 2. */
  style?: string;
  weight?: number;
  /** The `OS/2` italic flag. */
  italic?: boolean;
  /** A `wght` axis. */
  wght?: [number, number];
  fixedPitch?: boolean;
  /** Write the names as Mac Roman only. */
  mac?: boolean;
}

function nameTable(f: FakeFont): Buffer {
  const names: [number, string][] = [
    [1, f.family],
    [2, f.style ?? "Regular"],
  ];
  if (f.typoFamily) names.push([16, f.typoFamily]);
  const strings = names.map(([, s]) => (f.mac ? Buffer.from(s, "latin1") : Buffer.from(s, "utf16le").swap16()));
  const head = Buffer.alloc(6 + names.length * 12);
  head.writeUInt16BE(0, 0);
  head.writeUInt16BE(names.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  names.forEach(([id], i) => {
    const at = 6 + i * 12;
    head.writeUInt16BE(f.mac ? 1 : 3, at);
    head.writeUInt16BE(f.mac ? 0 : 1, at + 2);
    head.writeUInt16BE(f.mac ? 0 : 0x409, at + 4);
    head.writeUInt16BE(id, at + 6);
    head.writeUInt16BE(strings[i].length, at + 8);
    head.writeUInt16BE(offset, at + 10);
    offset += strings[i].length;
  });
  return Buffer.concat([head, ...strings]);
}

function tables(f: FakeFont): [string, Buffer][] {
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(4, 0);
  os2.writeUInt16BE(f.weight ?? 400, 4);
  os2.writeUInt16BE(f.italic ? 1 : 0x40, 62);
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0);
  post.writeUInt32BE(f.fixedPitch ? 1 : 0, 12);
  const out: [string, Buffer][] = [
    ["OS/2", os2],
    ["head", head],
    ["name", nameTable(f)],
    ["post", post],
  ];
  if (f.wght) {
    const fvar = Buffer.alloc(16 + 20);
    fvar.writeUInt16BE(1, 0);
    fvar.writeUInt16BE(16, 4);
    fvar.writeUInt16BE(2, 6);
    fvar.writeUInt16BE(1, 8);
    fvar.writeUInt16BE(20, 10);
    fvar.write("wght", 16, "latin1");
    fvar.writeInt32BE(f.wght[0] * 65536, 20);
    fvar.writeInt32BE(400 * 65536, 24);
    fvar.writeInt32BE(f.wght[1] * 65536, 28);
    out.push(["fvar", fvar]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
}

const pad4 = (b: Buffer) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

/** An sfnt (`.ttf`, or `.otf` with `OTTO`). */
export function sfnt(f: FakeFont, magic = "\0\x01\0\0"): Buffer {
  const list = tables(f);
  const head = Buffer.alloc(12 + list.length * 16);
  head.write(magic, 0, "latin1");
  head.writeUInt16BE(list.length, 4);
  let offset = head.length;
  const data: Buffer[] = [];
  list.forEach(([tag, body], i) => {
    const at = 12 + i * 16;
    head.write(tag, at, "latin1");
    head.writeUInt32BE(offset, at + 8);
    head.writeUInt32BE(body.length, at + 12);
    data.push(pad4(body));
    offset += pad4(body).length;
  });
  return Buffer.concat([head, ...data]);
}

export function woff(f: FakeFont): Buffer {
  const list = tables(f);
  const head = Buffer.alloc(44 + list.length * 20);
  head.write("wOFF", 0, "latin1");
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt16BE(list.length, 12);
  let offset = head.length;
  const data: Buffer[] = [];
  list.forEach(([tag, body], i) => {
    const packed = deflateSync(body);
    const stored = packed.length < body.length ? packed : body;
    const at = 44 + i * 20;
    head.write(tag, at, "latin1");
    head.writeUInt32BE(offset, at + 4);
    head.writeUInt32BE(stored.length, at + 8);
    head.writeUInt32BE(body.length, at + 12);
    data.push(pad4(stored));
    offset += pad4(stored).length;
  });
  head.writeUInt32BE(offset, 8);
  return Buffer.concat([head, ...data]);
}

const WOFF2_INDEX: Record<string, number> = { head: 1, name: 5, "OS/2": 6, post: 7, fvar: 47 };

function base128(n: number): Buffer {
  const bytes = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) bytes.unshift((n & 0x7f) | 0x80);
  return Buffer.from(bytes);
}

/** A WOFF2 file; `arbitraryTags` writes each tag out instead of using its known-table index. */
export function woff2(f: FakeFont, arbitraryTags = false): Buffer {
  const list = tables(f);
  const dir: Buffer[] = [];
  for (const [tag, body] of list) {
    if (arbitraryTags) {
      const t = Buffer.alloc(5);
      t[0] = 63;
      t.write(tag, 1, "latin1");
      dir.push(t);
    } else {
      dir.push(Buffer.from([WOFF2_INDEX[tag]]));
    }
    dir.push(base128(body.length));
  }
  const compressed = brotliCompressSync(Buffer.concat(list.map(([, b]) => b)));
  const head = Buffer.alloc(48);
  head.write("wOF2", 0, "latin1");
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt16BE(list.length, 12);
  head.writeUInt32BE(compressed.length, 20);
  const out = Buffer.concat([head, ...dir, compressed]);
  out.writeUInt32BE(out.length, 8);
  return out;
}
