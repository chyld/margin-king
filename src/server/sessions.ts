// Sessions (architecture §5.8): in memory, keyed by the token's hash, persisted to sessions.json.

import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isNotFound, WriteQueue } from "./fsx.ts";
import type { Users } from "./users.ts";

export const SESSION_DAYS = 30;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 60 * 60 * 1000;
const PERSIST_DELAY_MS = 200;

export interface Session {
  user: string;
  uid: string;
  expires: number;
  renewed: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private queue: WriteQueue;
  private timer: NodeJS.Timeout | null = null;
  private path: string;
  private now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.now = now;
    this.path = join(dataDir, "sessions.json");
    this.queue = new WriteQueue(this.path, () => JSON.stringify(Object.fromEntries(this.sessions)));
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
    try {
      const data = JSON.parse(text) as Record<string, Session>;
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v.user === "string" && typeof v.expires === "number") this.sessions.set(k, v);
      }
    } catch {
      // A corrupt sessions file only means everyone logs in again.
      console.error(`margin: ${this.path} is not valid JSON; starting with no sessions`);
    }
  }

  private changed(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.queue.write().catch((err) => console.error("margin: could not save sessions:", err));
    }, PERSIST_DELAY_MS);
  }

  create(user: string, uid: string): string {
    const token = randomBytes(32).toString("hex");
    const t = this.now();
    this.sessions.set(hashToken(token), { user, uid, expires: t + SESSION_MS, renewed: t });
    this.changed();
    return token;
  }

  /** The valid session for a token, renewing it when due. `renewed` tells the caller to re-send the cookie. */
  lookup(token: string, users: Users): { session: Session; renewed: boolean } | null {
    const key = hashToken(token);
    const s = this.sessions.get(key);
    if (!s) return null;
    const t = this.now();
    const user = Object.hasOwn(users, s.user) ? users[s.user] : undefined;
    if (s.expires <= t || !user || user.uid !== s.uid) {
      this.sessions.delete(key);
      this.changed();
      return null;
    }
    let renewed = false;
    if (t - s.renewed > RENEW_AFTER_MS) {
      s.expires = t + SESSION_MS;
      s.renewed = t;
      renewed = true;
      this.changed();
    }
    return { session: s, renewed };
  }

  delete(token: string): void {
    if (this.sessions.delete(hashToken(token))) this.changed();
  }

  /** Drop expired sessions and those whose user or uid no longer matches. */
  prune(users: Users): void {
    const t = this.now();
    let any = false;
    for (const [k, s] of this.sessions) {
      const user = Object.hasOwn(users, s.user) ? users[s.user] : undefined;
      if (s.expires <= t || !user || user.uid !== s.uid) {
        this.sessions.delete(k);
        any = true;
      }
    }
    if (any) this.changed();
  }

  get size(): number {
    return this.sessions.size;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.queue.write();
    }
    await this.queue.flush();
  }
}
