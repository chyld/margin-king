import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp, type App } from "../../src/server/main.ts";

export const ROOT = resolve(import.meta.dirname, "../..");

export interface Running {
  app: App;
  base: string;
  dataDir: string;
  close(): Promise<void>;
}

export async function start(): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), "margin-test-data-"));
  const publicDir = await mkdtemp(join(tmpdir(), "margin-test-public-"));
  await writeFile(join(publicDir, "index.html"), "<!doctype html><title>app</title>");
  await writeFile(join(publicDir, "login.html"), "<!doctype html><title>login</title>");
  await writeFile(join(publicDir, "404.html"), "<!doctype html><title>404</title>");
  await mkdir(join(publicDir, "assets"));
  await writeFile(join(publicDir, "assets", "app.js"), "console.log(1)");
  const app = await createApp({ dataDir, port: 0, host: "127.0.0.1", production: false, publicDir });
  const port = await app.listen();
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    dataDir,
    close: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(publicDir, { recursive: true, force: true });
    },
  };
}

export function cli(dataDir: string, args: string[], password?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const env = { ...process.env, DATA_DIR: dataDir } as NodeJS.ProcessEnv;
    if (password !== undefined) env.MARGIN_PASSWORD = password;
    else delete env.MARGIN_PASSWORD;
    execFile(process.execPath, [join(ROOT, "cli.js"), ...args], { env }, (err, stdout, stderr) => {
      resolveRun({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) ?? 1 : 0, stdout, stderr });
    });
  });
}

/** A tiny HTTP client that keeps the session cookie. */
export class Client {
  cookie = "";
  base: string;
  constructor(base: string) {
    this.base = base;
  }

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== "GET" && method !== "HEAD" && !("X-Margin" in h)) h["X-Margin"] = "1";
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      payload = body as unknown as BodyInit;
    } else if (body !== undefined) {
      h["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0];
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    return res;
  }

  async json(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await this.req(method, path, body);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async login(user: string, password: string): Promise<number> {
    return (await this.req("POST", "/api/login", { username: user, password })).status;
  }
}

export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
