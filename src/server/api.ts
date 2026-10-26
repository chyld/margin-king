// The JSON API (architecture §5.5).

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isImageName, isNoteId, isTag, isUsername } from "../shared/rules.ts";
import { HttpError, json, readJson, viaHttps } from "./http.ts";
import type { SessionStore } from "./sessions.ts";
import { SESSION_DAYS } from "./sessions.ts";
import { StoreError, type NoteStore } from "./store.ts";
import { BusyError, verifyPassword, type HashQueue, type UsersCache } from "./users.ts";

export const COOKIE = "margin_session";
const SMALL_BODY = 64 * 1024;
const NOTE_BODY = 50 * 1024 * 1024;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: string | null;
  token: string | null;
}

export interface Deps {
  store: NoteStore;
  sessions: SessionStore;
  users: UsersCache;
  hashes: HashQueue;
}

export type Handler = (c: Ctx) => Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  access: "public" | "user";
  handler: Handler;
}

export function sessionCookie(req: IncomingMessage, token: string | null): string {
  const secure = viaHttps(req) ? "; Secure" : "";
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`;
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a JSON object");
  return body as Record<string, unknown>;
}

function tagList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((t) => typeof t === "string" && isTag(t))) {
    throw new HttpError(400, "Tags are lowercase a-z and 0-9, at most 40 characters");
  }
  return value as string[];
}

function noteId(c: Ctx): string {
  const id = c.params.id;
  if (!isNoteId(id)) throw new HttpError(404, "Note not found");
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function apiRoutes(d: Deps): Route[] {
  const user = (c: Ctx) => c.user!;
  const wrap = (fn: Handler): Handler => async (c) => {
    try {
      await fn(c);
    } catch (err) {
      if (err instanceof StoreError) throw new HttpError(err.status, err.message);
      throw err;
    }
  };

  const routes: [string, string, Route["access"], Handler][] = [
    [
      "POST",
      "/api/login",
      "public",
      async (c) => {
        const started = Date.now();
        const body = bodyObject(await readJson(c.req, SMALL_BODY));
        const username = typeof body.username === "string" ? body.username : "";
        const password = typeof body.password === "string" ? body.password : "";
        await d.users.refresh();
        const record = isUsername(username) ? d.users.get(username) : undefined;
        const abort = new AbortController();
        c.res.on("close", () => {
          if (!c.res.writableFinished) abort.abort();
        });
        let ok: boolean;
        try {
          ok = await d.hashes.run(() => verifyPassword(record, password), abort.signal);
        } catch (err) {
          if (err instanceof BusyError) throw new HttpError(503, "Too many logins at once; try again in a moment");
          throw err;
        }
        if (!ok || !record) {
          await sleep(Math.max(0, 500 - (Date.now() - started)));
          throw new HttpError(401, "Wrong username or password");
        }
        const token = d.sessions.create(username, record.uid);
        c.res.setHeader("Set-Cookie", sessionCookie(c.req, token));
        json(c.res, 200, { user: username });
      },
    ],
    [
      "POST",
      "/api/logout",
      "public",
      async (c) => {
        if (c.token) d.sessions.delete(c.token);
        c.res.setHeader("Set-Cookie", sessionCookie(c.req, null));
        json(c.res, 200, { ok: true });
      },
    ],
    ["GET", "/api/session", "user", async (c) => json(c.res, 200, { user: user(c) })],
    [
      "GET",
      "/api/notes",
      "user",
      async (c) => {
        const q = c.url.searchParams;
        const tag = q.get("tag") || undefined;
        const notes = await d.store.list(user(c), { tag, q: q.get("q") ?? "", trash: q.get("trash") === "1" });
        json(c.res, 200, notes);
      },
    ],
    ["GET", "/api/tags", "user", async (c) => json(c.res, 200, await d.store.tags(user(c)))],
    [
      "POST",
      "/api/notes",
      "user",
      async (c) => {
        const body = c.req.headers["content-length"] === "0" ? {} : bodyObject(await readJson(c.req, SMALL_BODY));
        json(c.res, 201, await d.store.create(user(c), tagList(body.tags)));
      },
    ],
    ["GET", "/api/notes/:id", "user", async (c) => json(c.res, 200, await d.store.get(user(c), noteId(c)))],
    [
      "GET",
      "/api/notes/:id/meta",
      "user",
      async (c) => {
        const id = noteId(c);
        const text = await d.store.metaFile(user(c), id);
        json(c.res, 200, { path: `notes/${user(c)}/${id}/meta.json`, text });
      },
    ],
    [
      "PUT",
      "/api/notes/:id",
      "user",
      async (c) => {
        const id = noteId(c);
        const body = bodyObject(await readJson(c.req, NOTE_BODY));
        if (typeof body.text !== "string") throw new HttpError(400, "Expected { text }");
        json(c.res, 200, await d.store.saveText(user(c), id, body.text));
      },
    ],
    [
      "PUT",
      "/api/notes/:id/tags",
      "user",
      async (c) => {
        const id = noteId(c);
        const body = bodyObject(await readJson(c.req, SMALL_BODY));
        if (!Array.isArray(body.tags)) throw new HttpError(400, "Expected { tags }");
        json(c.res, 200, await d.store.setTags(user(c), id, tagList(body.tags)));
      },
    ],
    ["POST", "/api/notes/:id/trash", "user", async (c) => json(c.res, 200, await d.store.trash(user(c), noteId(c)))],
    ["POST", "/api/notes/:id/restore", "user", async (c) => json(c.res, 200, await d.store.restore(user(c), noteId(c)))],
    [
      "DELETE",
      "/api/notes/:id",
      "user",
      async (c) => {
        await d.store.deleteForever(user(c), noteId(c));
        json(c.res, 200, { ok: true });
      },
    ],
    ["POST", "/api/trash/empty", "user", async (c) => json(c.res, 200, { deleted: await d.store.emptyTrash(user(c)) })],
    [
      "POST",
      "/api/notes/:id/images",
      "user",
      async (c) => {
        const id = noteId(c);
        const type = (c.req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (type !== "image/png") {
          c.req.resume();
          throw new HttpError(415, "Only PNG screenshots are allowed");
        }
        const name = await d.store.upload(user(c), id, c.req);
        json(c.res, 201, { name });
      },
    ],
    [
      "GET",
      "/api/notes/:id/images/:name",
      "user",
      async (c) => {
        const id = noteId(c);
        const name = c.params.name;
        if (!isImageName(name) || !(await d.store.exists(user(c), id))) throw new HttpError(404, "Not found");
        const path = d.store.imagePath(user(c), id, name);
        let size: number;
        let etag: string;
        try {
          const st = await stat(path);
          size = st.size;
          // From the file itself, not its name: two users' notes can hold the same note and image names.
          etag = `"${st.ino.toString(36)}-${size.toString(36)}-${Math.trunc(st.mtimeMs).toString(36)}"`;
        } catch {
          throw new HttpError(404, "Not found");
        }
        // Screenshots never change, but they're revalidated so a browser shared by two users never
        // shows one user's cached image to the other: the session was checked above, before any 304.
        const headers = { "Content-Type": "image/png", "Cache-Control": "private, no-cache", ETag: etag };
        if (c.req.headers["if-none-match"] === etag) {
          c.res.writeHead(304, headers);
          c.res.end();
          return;
        }
        c.res.writeHead(200, { ...headers, "Content-Length": size });
        if (c.req.method === "HEAD") {
          c.res.end();
          return;
        }
        createReadStream(path).on("error", () => c.res.destroy()).pipe(c.res);
      },
    ],
  ];

  return routes.map(([method, path, access, handler]) => ({
    method,
    pattern: new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
    access,
    handler: wrap(handler),
  }));
}
