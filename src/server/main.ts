// The Margin server: configuration, the request pipeline, startup and shutdown.

import { randomBytes } from "node:crypto";
import { access, constants, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiRoutes, COOKIE, sessionCookie, type Ctx, type Route } from "./api.ts";
import { HttpError, json, parseCookies, securityHeaders, send, StaticFiles } from "./http.ts";
import { home } from "./pages.ts";
import { SessionStore } from "./sessions.ts";
import { NoteStore } from "./store.ts";
import { HashQueue, UsersCache } from "./users.ts";

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  production: boolean;
  publicDir: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dataDir: resolve(env.DATA_DIR || "./data"),
    port: Number(env.PORT || 5555),
    host: env.HOST || "0.0.0.0",
    production: env.NODE_ENV === "production",
    publicDir: resolve(env.PUBLIC_DIR || join(ROOT, "dist/public")),
  };
}

export interface App {
  server: Server;
  sessions: SessionStore;
  store: NoteStore;
  listen(): Promise<number>;
  close(): Promise<void>;
}

async function checkDataDir(dataDir: string): Promise<void> {
  try {
    await mkdir(join(dataDir, "notes"), { recursive: true });
    await access(dataDir, constants.W_OK);
    await access(join(dataDir, "notes"), constants.W_OK);
  } catch (err) {
    const who = typeof process.getuid === "function" ? ` (uid ${process.getuid()}, gid ${process.getgid?.()})` : "";
    throw new Error(
      `margin: the data folder ${dataDir} isn't writable by this process${who}: ${(err as Error).message}\n` +
        "Make it owned by this user, e.g. `sudo chown -R $(id -u):$(id -g) ./data`, or set MARGIN_UID/MARGIN_GID.",
    );
  }
}

export async function createApp(config: Config): Promise<App> {
  await checkDataDir(config.dataDir);
  const users = new UsersCache(config.dataDir);
  await users.load();
  const sessions = new SessionStore(config.dataDir);
  await sessions.load();
  sessions.prune(users.all());
  const store = new NoteStore(config.dataDir);
  const files = new StaticFiles(config.publicDir, config.production);
  await files.load();
  const hashes = new HashQueue();
  const routes: Route[] = apiRoutes({ store, sessions, users, hashes });

  const pruneTimer = setInterval(() => sessions.prune(users.all()), 60 * 60 * 1000);
  pruneTimer.unref();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    securityHeaders(res);
    const url = new URL(req.url ?? "/", "http://margin.invalid");
    const path = url.pathname;
    const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
    const isApi = path === "/api" || path.startsWith("/api/");

    // Static assets need no session.
    if (method === "GET" && !isApi && path !== "/") {
      const name = path === "/favicon.ico" ? "favicon.svg" : path.slice(1);
      if (!name.endsWith(".html") && (await files.serve(req, res, name))) return;
      if (!(await files.serve(req, res, "404.html", 404))) send(res, 404, "Not found", { "Content-Type": "text/plain" });
      return;
    }

    if (await users.refresh()) sessions.prune(users.all());
    const token = parseCookies(req.headers.cookie)[COOKIE] ?? null;
    let user: string | null = null;
    if (token) {
      const found = sessions.lookup(token, users.all());
      if (found) {
        user = found.session.user;
        if (found.renewed) res.setHeader("Set-Cookie", sessionCookie(req, token));
      }
    }
    const c: Ctx = { req, res, url, params: {}, user, token };

    if (!isApi) {
      if (path === "/" && method === "GET") {
        await home(c, files, store);
        if (!res.headersSent) send(res, 500, "Margin isn't built yet: run npm run build", { "Content-Type": "text/plain" });
        return;
      }
      if (!(await files.serve(req, res, "404.html", 404))) send(res, 404, "Not found", { "Content-Type": "text/plain" });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    // Writes need a header another origin can't send without a CORS preflight (§5.3).
    if (method !== "GET" && req.headers["x-margin"] !== "1") throw new HttpError(403, "Missing X-Margin header");
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      if (route.access === "user" && !user) throw new HttpError(401, "Not logged in");
      c.params = { ...(m.groups ?? {}) };
      if (route.pattern.source.includes("images") && route.method === "GET") res.removeHeader("Cache-Control");
      await route.handler(c);
      return;
    }
    throw new HttpError(404, "Not found");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message });
        return;
      }
      const id = randomBytes(4).toString("hex");
      console.error(`margin: request ${id} ${req.method} ${req.url} failed:`, err);
      json(res, 500, { error: "Server error" });
    });
  });
  // Uploads have no size limit (README §3.11): no overall request timeout, but idle sockets close.
  server.requestTimeout = 0;
  server.timeout = 120_000;

  return {
    server,
    sessions,
    store,
    listen: () =>
      new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          const addr = server.address();
          resolveListen(typeof addr === "object" && addr ? addr.port : config.port);
        });
      }),
    close: async () => {
      clearInterval(pruneTimer);
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeIdleConnections();
      });
      await store.idle();
      await sessions.flush();
    },
  };
}

async function main(): Promise<void> {
  const config = configFromEnv();
  let app: App;
  try {
    app = await createApp(config);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const port = await app.listen();
  console.log(`Margin listening on http://${config.host}:${port} (data in ${config.dataDir})`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => {
      console.error("margin: shutdown took too long; exiting");
      process.exit(1);
    }, 20_000);
    force.unref();
    await app.close().catch((err) => console.error("margin: shutdown error:", err));
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
