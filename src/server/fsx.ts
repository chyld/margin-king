// File-system helpers: atomic writes, keyed async locks, and a per-file write queue.

import { randomBytes } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/** fsync a directory so a rename inside it survives a power cut. Best effort on odd filesystems. */
export async function syncDir(dir: string): Promise<void> {
  let fh;
  try {
    fh = await open(dir, "r");
    await fh.sync();
  } catch {
    // Some filesystems don't allow fsync on directories; the rename is still atomic.
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** Write a file atomically: temp file, fsync, rename, fsync the folder. */
export async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
  const fh = await open(tmp, "wx");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  await syncDir(dirname(path));
}

export function isNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** An async lock per key: callers for the same key run one at a time, in order. */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.tails.set(key, tail);
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Resolves once every lock that's currently held or queued has been released. */
  async idle(): Promise<void> {
    while (this.tails.size) await Promise.allSettled([...this.tails.values()]);
  }
}

/**
 * Writes one file from a snapshot function, one write at a time. Each write takes the latest
 * snapshot, so an older snapshot can never be renamed over a newer one.
 */
export class WriteQueue {
  private running: Promise<void> | null = null;
  private pending = false;
  private path: string;
  private snapshot: () => string;

  constructor(path: string, snapshot: () => string) {
    this.path = path;
    this.snapshot = snapshot;
  }

  write(): Promise<void> {
    this.pending = true;
    if (!this.running) this.running = this.loop();
    return this.running;
  }

  private async loop(): Promise<void> {
    try {
      while (this.pending) {
        this.pending = false;
        await atomicWrite(this.path, this.snapshot());
      }
    } finally {
      this.running = null;
    }
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
  }
}
