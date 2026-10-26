// users.json: reading (server and CLI), writing (CLI only, under a lock), and password hashing.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, isNotFound } from "./fsx.ts";

export interface UserRecord {
  uid: string;
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
  created: string;
}

export type Users = Record<string, UserRecord>;

/** scrypt cost (architecture §5.7): one of OWASP's equal-strength settings, ~32 MiB. */
export const SCRYPT = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;

export function usersPath(dataDir: string): string {
  return join(dataDir, "users.json");
}

export function lockPath(dataDir: string): string {
  return join(dataDir, "users.json.lock");
}

export class UsersFileError extends Error {}

/** Parse users.json; a missing file is empty, a corrupt one is an error (never "empty"). */
export async function readUsers(dataDir: string): Promise<Users> {
  let text: string;
  try {
    text = await readFile(usersPath(dataDir), "utf8");
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    return data as Users;
  } catch (err) {
    throw new UsersFileError(`${usersPath(dataDir)} is not valid JSON (${(err as Error).message})`);
  }
}

function maxmem(N: number, r: number): number {
  return 2 * 128 * N * r;
}

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<Pick<UserRecord, "salt" | "hash" | "N" | "r" | "p">> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return { salt: salt.toString("hex"), hash: key.toString("hex"), ...SCRYPT };
}

/** A fixed record unknown usernames are checked against, so timing doesn't reveal which exist. */
const DUMMY: Pick<UserRecord, "salt" | "hash" | "N" | "r" | "p"> = {
  salt: "00".repeat(16),
  hash: "00".repeat(KEY_LENGTH),
  ...SCRYPT,
};

export async function verifyPassword(record: UserRecord | undefined, password: string): Promise<boolean> {
  const rec = record ?? DUMMY;
  const key = await scryptAsync(password, Buffer.from(rec.salt, "hex"), rec.N, rec.r, rec.p);
  const expected = Buffer.from(rec.hash, "hex");
  const ok = key.length === expected.length && timingSafeEqual(key, expected);
  return ok && !!record;
}

export class BusyError extends Error {}

/** At most two hashes run at once, at most 16 wait; anything beyond is refused (503). */
export class HashQueue {
  private running = 0;
  private waiting: { run: () => void; cancel: () => void }[] = [];
  private maxRunning: number;
  private maxWaiting: number;

  constructor(maxRunning = 2, maxWaiting = 16) {
    this.maxRunning = maxRunning;
    this.maxWaiting = maxWaiting;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.running >= this.maxRunning) {
      if (this.waiting.length >= this.maxWaiting) throw new BusyError("Too many logins at once");
      await new Promise<void>((resolve, reject) => {
        const entry = {
          run: () => resolve(),
          cancel: () => reject(new BusyError("Login abandoned")),
        };
        this.waiting.push(entry);
        signal?.addEventListener("abort", () => {
          const i = this.waiting.indexOf(entry);
          if (i >= 0) {
            this.waiting.splice(i, 1);
            entry.cancel();
          }
        });
      });
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.run();
    }
  }
}

/** The server's view of users.json, re-read when its inode, size or mtime changes. */
export class UsersCache {
  private users: Users = {};
  private key = "";
  private dataDir: string;
  private log: (msg: string) => void;

  constructor(dataDir: string, log: (msg: string) => void = (m) => console.error(m)) {
    this.dataDir = dataDir;
    this.log = log;
  }

  /** Load at startup; a corrupt file is fatal here. */
  async load(): Promise<void> {
    this.users = await readUsers(this.dataDir);
    this.key = await this.statKey();
  }

  private async statKey(): Promise<string> {
    try {
      const s = await stat(usersPath(this.dataDir));
      return `${s.ino}:${s.size}:${s.mtimeMs}`;
    } catch (err) {
      if (isNotFound(err)) return "missing";
      throw err;
    }
  }

  /** Re-read if the file changed. Returns true when it did. Keeps the last good copy on errors. */
  async refresh(): Promise<boolean> {
    const key = await this.statKey();
    if (key === this.key) return false;
    try {
      this.users = await readUsers(this.dataDir);
      this.key = key;
      return true;
    } catch (err) {
      this.log(`margin: keeping the last good users.json: ${(err as Error).message}`);
      this.key = key;
      return false;
    }
  }

  get(name: string): UserRecord | undefined {
    return Object.hasOwn(this.users, name) ? this.users[name] : undefined;
  }

  all(): Users {
    return this.users;
  }
}

// ---------------------------------------------------------------------------------------------
// The CLI's lock (architecture §5.9): never reclaimed automatically.

export class LockedError extends Error {}

interface LockInfo {
  pid: number;
  host: string;
  token: string;
  created: string;
}

async function readLock(dataDir: string): Promise<string> {
  try {
    return await readFile(lockPath(dataDir), "utf8");
  } catch (err) {
    if (isNotFound(err)) return "";
    throw err;
  }
}

/** Take users.json.lock, retrying for up to `waitMs`. Returns the token that proves ownership. */
export async function acquireLock(dataDir: string, waitMs = 10_000): Promise<string> {
  const token = randomBytes(16).toString("hex");
  const info: LockInfo = { pid: process.pid, host: hostname(), token, created: new Date().toISOString() };
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fh = await open(lockPath(dataDir), "wx");
      try {
        await fh.writeFile(JSON.stringify(info));
        await fh.sync();
      } finally {
        await fh.close();
      }
      return token;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    if (Date.now() >= deadline) {
      const contents = (await readLock(dataDir)).trim();
      throw new LockedError(
        `${lockPath(dataDir)} exists (${contents ? contents : "empty or unreadable"}).\n` +
          "If no other margin-user is running, delete this file and try again.",
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function holdsLock(dataDir: string, token: string): Promise<boolean> {
  const text = await readLock(dataDir);
  try {
    return (JSON.parse(text) as LockInfo).token === token;
  } catch {
    return false;
  }
}

export async function releaseLock(dataDir: string, token: string): Promise<void> {
  if (await holdsLock(dataDir, token)) await unlink(lockPath(dataDir)).catch(() => {});
}

/** Re-read, change and atomically replace users.json while holding the lock. */
export async function updateUsers(dataDir: string, token: string, change: (users: Users) => void): Promise<void> {
  const users = await readUsers(dataDir);
  change(users);
  if (!(await holdsLock(dataDir, token))) throw new LockedError(`Lost ${lockPath(dataDir)}; nothing was changed.`);
  await atomicWrite(usersPath(dataDir), `${JSON.stringify(users, null, 2)}\n`);
}
