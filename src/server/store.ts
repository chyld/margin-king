// Notes on disk (architecture §4, §5.6): data/notes/<user>/<id>/{note.md, meta.json, *.png}.

import { randomInt } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { isNoteId, isTag, TAG_RE, dedupeTags } from "../shared/rules.ts";
import { noteTitle, searchText } from "../shared/text.ts";
import { atomicWrite, isNotFound, KeyedLock, syncDir } from "./fsx.ts";

export interface Meta {
  created: string;
  modified: string;
  tags: string[];
  trashedAt: string | null;
}

export interface Summary {
  id: string;
  title: string;
  created: string;
  modified: string;
  tags: string[];
  trashedAt: string | null;
}

export interface Note extends Summary {
  text: string;
}

export class StoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const notFound = () => new StoreError(404, "Note not found");
const errorCode = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code ?? String(err);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(): string {
  let id = "";
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[randomInt(36)];
  return id;
}

const isoString = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** A meta.json with the expected shape, invalid tag entries dropped; null if malformed. */
export function parseMeta(text: string): Meta | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (!isoString(m.created) || !isoString(m.modified) || !Array.isArray(m.tags)) return null;
  if (m.trashedAt !== null && !isoString(m.trashedAt)) return null;
  const tags = dedupeTags(m.tags.filter((t): t is string => typeof t === "string" && isTag(t)));
  return { created: m.created, modified: m.modified, tags, trashedAt: m.trashedAt as string | null };
}

export function summaryOf(id: string, meta: Meta, text: string): Summary {
  return { id, title: noteTitle(text), created: meta.created, modified: meta.modified, tags: meta.tags, trashedAt: meta.trashedAt };
}

export interface ListQuery {
  tag?: string;
  q?: string;
  trash?: boolean;
}

export class NoteStore {
  private notesDir: string;
  private locks = new KeyedLock();

  private log: (msg: string) => void;
  /** Folders already reported: listings read every folder on every request. */
  private skipped = new Set<string>();

  constructor(dataDir: string, log: (msg: string) => void = (m) => console.error(m)) {
    this.notesDir = join(dataDir, "notes");
    this.log = log;
  }

  userDir(user: string): string {
    return join(this.notesDir, user);
  }

  noteDir(user: string, id: string): string {
    return join(this.notesDir, user, id);
  }

  private lock<T>(user: string, id: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.run(`${user}/${id}`, fn);
  }

  /** Every lock released: used by graceful shutdown. */
  idle(): Promise<void> {
    return this.locks.idle();
  }

  /** An invalid note folder is skipped, never an error for the whole listing (§5.6); logged once. */
  private skip(user: string, id: string, reason: string): null {
    const key = `${user}/${id}: ${reason}`;
    if (!this.skipped.has(key)) {
      this.skipped.add(key);
      this.log(`margin: skipping notes/${key}`);
    }
    return null;
  }

  private async readMeta(user: string, id: string): Promise<Meta | null> {
    const dir = this.noteDir(user, id);
    let text: string;
    try {
      text = await readFile(join(dir, "meta.json"), "utf8");
    } catch (err) {
      if (!isNotFound(err)) return this.skip(user, id, `meta.json can't be read (${errorCode(err)})`);
      // Left by a crash after note.md was written; a note being created looks the same for a moment.
      const st = await stat(join(dir, "note.md")).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 60_000) this.skip(user, id, "no meta.json");
      return null;
    }
    return parseMeta(text) ?? this.skip(user, id, "meta.json isn't valid");
  }

  /** The note, or null if the folder is missing or invalid (or vanished while being read). */
  private async readNote(user: string, id: string): Promise<{ meta: Meta; text: string } | null> {
    if (!isNoteId(id)) return null;
    const meta = await this.readMeta(user, id);
    if (!meta) return null;
    try {
      const text = await readFile(join(this.noteDir(user, id), "note.md"), "utf8");
      return { meta, text };
    } catch (err) {
      if (isNotFound(err)) return null;
      return this.skip(user, id, `note.md can't be read (${errorCode(err)})`);
    }
  }

  private async mustRead(user: string, id: string): Promise<{ meta: Meta; text: string }> {
    const note = await this.readNote(user, id);
    if (!note) throw notFound();
    return note;
  }

  private async writeMeta(user: string, id: string, meta: Meta): Promise<void> {
    await atomicWrite(join(this.noteDir(user, id), "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  }

  async exists(user: string, id: string): Promise<boolean> {
    return !!(await this.readNote(user, id));
  }

  /** The note's meta.json exactly as stored, for the read-only viewer (owner decision, §15). */
  async metaFile(user: string, id: string): Promise<string> {
    if (!(await this.exists(user, id))) throw notFound();
    try {
      return await readFile(join(this.noteDir(user, id), "meta.json"), "utf8");
    } catch (err) {
      if (isNotFound(err)) throw notFound();
      throw err;
    }
  }

  private async ids(user: string): Promise<string[]> {
    try {
      return (await readdir(this.userDir(user))).filter(isNoteId);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  /** Every valid note of the user, read directly (README §7 accepts this at this scale). */
  async all(user: string): Promise<{ id: string; meta: Meta; text: string }[]> {
    const ids = await this.ids(user);
    const out: { id: string; meta: Meta; text: string }[] = [];
    for (let i = 0; i < ids.length; i += 32) {
      const batch = await Promise.all(ids.slice(i, i + 32).map(async (id) => ({ id, note: await this.readNote(user, id) })));
      for (const { id, note } of batch) if (note) out.push({ id, ...note });
    }
    return out;
  }

  async list(user: string, query: ListQuery = {}): Promise<Summary[]> {
    const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const notes = (await this.all(user)).filter((n) => {
      if (!!n.meta.trashedAt !== !!query.trash) return false;
      if (query.tag && !n.meta.tags.includes(query.tag)) return false;
      if (terms.length) {
        const hay = searchText(n.text);
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const key = (n: (typeof notes)[number]) => (query.trash ? n.meta.trashedAt! : n.meta.modified);
    notes.sort((x, y) => (key(x) < key(y) ? 1 : key(x) > key(y) ? -1 : x.id < y.id ? -1 : 1));
    return notes.map((n) => summaryOf(n.id, n.meta, n.text));
  }

  async tags(user: string): Promise<{ tag: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const n of await this.all(user)) {
      if (n.meta.trashedAt) continue;
      for (const t of n.meta.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([tag, count]) => ({ tag, count }));
  }

  async tagInUse(user: string, tag: string): Promise<boolean> {
    return (await this.tags(user)).some((t) => t.tag === tag);
  }

  async create(user: string, tags: string[] = []): Promise<Summary> {
    if (!tags.every((t) => TAG_RE.test(t))) throw new StoreError(400, "Tags are lowercase a-z and 0-9, at most 40 characters");
    await mkdir(this.userDir(user), { recursive: true });
    for (;;) {
      const id = randomId();
      const dir = this.noteDir(user, id);
      try {
        await mkdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
      const now = new Date().toISOString();
      const meta: Meta = { created: now, modified: now, tags: dedupeTags(tags), trashedAt: null };
      await atomicWrite(join(dir, "note.md"), "");
      await this.writeMeta(user, id, meta);
      await syncDir(this.userDir(user));
      return summaryOf(id, meta, "");
    }
  }

  async get(user: string, id: string): Promise<Note> {
    const { meta, text } = await this.mustRead(user, id);
    return { ...summaryOf(id, meta, text), text };
  }

  async saveText(user: string, id: string, text: string): Promise<Summary> {
    return this.lock(user, id, async () => {
      const { meta } = await this.mustRead(user, id);
      if (meta.trashedAt) throw new StoreError(409, "This note is in the trash");
      await atomicWrite(join(this.noteDir(user, id), "note.md"), text);
      const next: Meta = { ...meta, modified: new Date().toISOString() };
      await this.writeMeta(user, id, next);
      return summaryOf(id, next, text);
    });
  }

  async setTags(user: string, id: string, tags: string[]): Promise<Summary> {
    if (!tags.every((t) => TAG_RE.test(t))) throw new StoreError(400, "Tags are lowercase a-z and 0-9, at most 40 characters");
    return this.lock(user, id, async () => {
      const { meta, text } = await this.mustRead(user, id);
      const next: Meta = { ...meta, tags: dedupeTags(tags) };
      await this.writeMeta(user, id, next);
      return summaryOf(id, next, text);
    });
  }

  async trash(user: string, id: string): Promise<Summary> {
    return this.lock(user, id, async () => {
      const { meta, text } = await this.mustRead(user, id);
      const next: Meta = { ...meta, trashedAt: meta.trashedAt ?? new Date().toISOString() };
      await this.writeMeta(user, id, next);
      return summaryOf(id, next, text);
    });
  }

  async restore(user: string, id: string): Promise<Summary> {
    return this.lock(user, id, async () => {
      const { meta, text } = await this.mustRead(user, id);
      const next: Meta = { ...meta, trashedAt: null };
      await this.writeMeta(user, id, next);
      return summaryOf(id, next, text);
    });
  }

  /** Under the lock, re-check that the note is still trashed, then remove it. */
  private async removeIfTrashed(user: string, id: string): Promise<boolean> {
    return this.lock(user, id, async () => {
      const meta = await this.readMeta(user, id);
      if (!meta) return false;
      if (!meta.trashedAt) return false;
      await rm(this.noteDir(user, id), { recursive: true, force: true });
      await syncDir(this.userDir(user));
      return true;
    });
  }

  async deleteForever(user: string, id: string): Promise<void> {
    const meta = await this.readMeta(user, id);
    if (!meta) throw notFound();
    if (!meta.trashedAt) throw new StoreError(409, "Only notes in the trash can be deleted");
    if (!(await this.removeIfTrashed(user, id))) throw new StoreError(409, "Only notes in the trash can be deleted");
  }

  async emptyTrash(user: string): Promise<number> {
    let deleted = 0;
    for (const n of await this.all(user)) {
      if (n.meta.trashedAt && (await this.removeIfTrashed(user, n.id))) deleted++;
    }
    return deleted;
  }

  private async checkWritable(user: string, id: string): Promise<void> {
    const meta = await this.readMeta(user, id);
    if (!meta) throw notFound();
    if (meta.trashedAt) throw new StoreError(409, "This note is in the trash");
  }

  /** Stream a PNG upload into the note's folder (architecture §5.6). Returns its name. */
  async upload(user: string, id: string, body: Readable): Promise<string> {
    if (!isNoteId(id)) throw notFound();
    await this.lock(user, id, () => this.checkWritable(user, id));
    const dir = this.noteDir(user, id);
    const tempName = `${randomId()}.png.upload`;
    const temp = join(dir, tempName);
    let fh;
    try {
      fh = await open(temp, "wx");
    } catch (err) {
      if (isNotFound(err)) throw notFound();
      throw err;
    }
    const cleanup = () => unlink(temp).catch(() => {});
    try {
      let head = Buffer.alloc(0);
      let checked = false;
      let bad = false;
      for await (const chunk of body as AsyncIterable<Buffer>) {
        if (bad) continue; // Drain the rest so the 415 can still be sent.
        if (!checked) {
          head = Buffer.concat([head, chunk]);
          if (head.length >= PNG_SIGNATURE.length) {
            checked = true;
            if (!head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
              bad = true;
              continue;
            }
            await fh.write(head);
          }
          continue;
        }
        await fh.write(chunk);
      }
      if (bad || !checked) throw new StoreError(415, "Only PNG screenshots are allowed");
      await fh.sync().catch(() => {});
    } catch (err) {
      await fh.close().catch(() => {});
      await cleanup();
      if (isNotFound(err)) throw notFound();
      throw err;
    }
    await fh.close().catch(() => {});
    try {
      return await this.lock(user, id, async () => {
        await this.checkWritable(user, id);
        for (;;) {
          const name = `${randomId()}.png`;
          const final = join(dir, name);
          try {
            await stat(final);
            continue; // Name taken: draw another.
          } catch (err) {
            if (!isNotFound(err)) throw err;
          }
          await rename(temp, final);
          await syncDir(dir);
          return name;
        }
      });
    } catch (err) {
      await cleanup();
      if (isNotFound(err)) throw notFound();
      throw err;
    }
  }

  imagePath(user: string, id: string, name: string): string {
    return join(this.noteDir(user, id), name);
  }
}
