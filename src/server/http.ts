// HTTP helpers: errors, JSON bodies, cookies, security headers, static files.

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export function securityHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
}

function isHead(res: ServerResponse): boolean {
  return res.req?.method === "HEAD";
}

export function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string | number> = {}): void {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  res.writeHead(status, { "Content-Length": buf.length, ...headers });
  res.end(isHead(res) ? undefined : buf);
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON.stringify(body), { "Content-Type": "application/json; charset=utf-8" });
}

/** Read and parse a JSON body of at most `limit` bytes. */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    req.resume();
    throw new HttpError(415, "Expected application/json");
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  if (declared > limit) {
    req.resume();
    throw new HttpError(413, "Request too large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Margin is behind a TLS proxy when the request says so (the flag only ever narrows a cookie). */
export function viaHttps(req: IncomingMessage): boolean {
  const proto = req.headers["x-forwarded-proto"];
  const first = (Array.isArray(proto) ? proto[0] : proto ?? "").split(",")[0].trim().toLowerCase();
  return first === "https";
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

interface StaticFile {
  body: Buffer;
  type: string;
  etag: string;
}

function etagOf(body: Buffer): string {
  return `"${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"`;
}

/**
 * Files under dist/public/. In production they're read into memory at startup and that set is the
 * allowlist; in development they're read from disk on each request (names checked) so a rebuild
 * shows on reload.
 */
export class StaticFiles {
  private files = new Map<string, StaticFile>();
  private root: string;
  private production: boolean;

  constructor(root: string, production: boolean) {
    this.root = root;
    this.production = production;
  }

  async load(): Promise<void> {
    if (!this.production) return;
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const body = await readFile(full);
          const name = relative(this.root, full).split(sep).join("/");
          this.files.set(name, { body, type: TYPES[extname(name)] ?? "application/octet-stream", etag: etagOf(body) });
        }
      }
    };
    await walk(this.root);
  }

  async get(name: string): Promise<StaticFile | null> {
    if (this.production) return this.files.get(name) ?? null;
    if (!/^[a-zA-Z0-9._/-]+$/.test(name) || name.includes("..")) return null;
    const full = normalize(join(this.root, name));
    if (!full.startsWith(this.root + sep)) return null;
    try {
      if (!(await stat(full)).isFile()) return null;
      const body = await readFile(full);
      return { body, type: TYPES[extname(name)] ?? "application/octet-stream", etag: etagOf(body) };
    } catch {
      return null;
    }
  }

  /** Send a file with ETag revalidation; false if there's no such file. */
  async serve(req: IncomingMessage, res: ServerResponse, name: string, status = 200): Promise<boolean> {
    const file = await this.get(name);
    if (!file) return false;
    const headers = { "Content-Type": file.type, "Cache-Control": "no-cache", ETag: file.etag };
    if (status === 200 && req.headers["if-none-match"] === file.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    send(res, status, file.body, headers);
    return true;
  }
}
