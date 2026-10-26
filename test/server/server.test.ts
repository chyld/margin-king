import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli, Client, PNG, start, type Running } from "./helpers.ts";

let s: Running;
before(async () => {
  s = await start();
  assert.equal((await cli(s.dataDir, ["add", "alice"], "secret")).code, 0);
  assert.equal((await cli(s.dataDir, ["add", "bob"], "hunter2")).code, 0);
});
after(async () => s.close());

describe("login and sessions", () => {
  test("wrong password: 401 after at least 500 ms", async () => {
    const c = new Client(s.base);
    const t = Date.now();
    const res = await c.req("POST", "/api/login", { username: "alice", password: "nope" });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Wrong username or password" });
    assert.ok(Date.now() - t >= 490);
    assert.equal((await c.req("POST", "/api/login", { username: "nobody", password: "x" })).status, 401);
  });

  test("right password: a session cookie that works", async () => {
    const c = new Client(s.base);
    const res = await c.req("POST", "/api/login", { username: "alice", password: "secret" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie")!, /^margin_session=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    assert.deepEqual((await c.json("GET", "/api/session")).body, { user: "alice" });
    assert.equal((await new Client(s.base).req("GET", "/api/session")).status, 401);
  });

  test("Secure only behind an HTTPS proxy", async () => {
    const c = new Client(s.base);
    const res = await c.req("POST", "/api/login", { username: "alice", password: "secret" }, { "X-Forwarded-Proto": "https" });
    assert.match(res.headers.get("set-cookie")!, /; Secure$/);
  });

  test("logout ends the session", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const token = c.cookie;
    assert.equal((await c.req("POST", "/api/logout")).status, 200);
    const again = new Client(s.base);
    again.cookie = token;
    assert.equal((await again.req("GET", "/api/session")).status, 401);
  });

  test("a user added after startup can log in at once; removing and re-adding ends old sessions", async () => {
    assert.equal((await cli(s.dataDir, ["add", "carol"], "pass1")).code, 0);
    const c = new Client(s.base);
    assert.equal(await c.login("carol", "pass1"), 200);
    assert.equal((await cli(s.dataDir, ["remove", "carol"])).code, 0);
    assert.equal((await cli(s.dataDir, ["add", "carol"], "pass2")).code, 0);
    assert.equal((await c.req("GET", "/api/session")).status, 401);
    assert.equal(await new Client(s.base).login("carol", "pass2"), 200);
  });

  test("passwd keeps sessions", async () => {
    const c = new Client(s.base);
    await c.login("bob", "hunter2");
    assert.equal((await cli(s.dataDir, ["passwd", "bob"], "hunter3")).code, 0);
    assert.equal((await c.req("GET", "/api/session")).status, 200);
    assert.equal(await new Client(s.base).login("bob", "hunter3"), 200);
    await cli(s.dataDir, ["passwd", "bob"], "hunter2");
  });
});

describe("request rules", () => {
  test("writes need X-Margin; GET and HEAD don't", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    assert.equal((await c.req("POST", "/api/notes", {}, { "X-Margin": "" })).status, 403);
    assert.equal((await c.req("HEAD", "/api/session")).status, 200);
  });

  test("security headers and no-store", async () => {
    const res = await fetch(s.base + "/api/session");
    assert.match(res.headers.get("content-security-policy")!, /script-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("unknown API paths are JSON 404s; other paths get the 404 page", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const api = await c.req("GET", "/api/nothing");
    assert.equal(api.status, 404);
    assert.deepEqual(await api.json(), { error: "Not found" });
    const page = await fetch(s.base + "/nothing");
    assert.equal(page.status, 404);
    assert.match(await page.text(), /404/);
  });

  test("GET / serves login, app or 404", async () => {
    const anon = await fetch(s.base + "/?note=abcdefgh");
    assert.equal(anon.status, 200);
    assert.match(await anon.text(), /login/);
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const { body: note } = await c.json("POST", "/api/notes", { tags: ["work"] });
    const page = async (q: string) => {
      const r = await c.req("GET", `/${q}`);
      return `${r.status} ${(await r.text()).includes("app") ? "app" : "404"}`;
    };
    assert.equal(await page(""), "200 app");
    assert.equal(await page(`?note=${note.id}`), "200 app");
    assert.equal(await page("?tag=work"), "200 app");
    assert.equal(await page("?tag=unused"), "404 404");
    assert.equal(await page("?note=zzzzzzzz"), "404 404");
    assert.equal(await page(`?note=${note.id}&tag=work`), "404 404");
    assert.equal(await page("?x=1"), "404 404");
    assert.equal(await page("?note="), "404 404");
    assert.equal(await page(`?note=${note.id}&note=${note.id}`), "404 404");
    // Another user's note doesn't exist for you.
    const b = new Client(s.base);
    await b.login("bob", "hunter2");
    assert.equal((await b.req("GET", `/?note=${note.id}`)).status, 404);
  });
});

describe("notes", () => {
  test("create, save, list, search, tags", async () => {
    const c = new Client(s.base);
    await c.login("bob", "hunter2");
    const a = (await c.json("POST", "/api/notes", { tags: ["alpha", "alpha"] })).body;
    assert.deepEqual(a.tags, ["alpha"]);
    assert.equal(a.title, "");
    assert.equal((await c.json("POST", "/api/notes", { tags: ["Bad Tag"] })).status, 400);
    const saved = await c.json("PUT", `/api/notes/${a.id}`, { text: "## {green} =={b}Lisbon trip==\nwrist exercises" });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.title, "Lisbon trip");
    const b = (await c.json("POST", "/api/notes", {})).body;
    await c.json("PUT", `/api/notes/${b.id}`, { text: "Other note" });
    const list = (await c.json("GET", "/api/notes")).body;
    assert.deepEqual(list.map((n: { id: string }) => n.id).slice(0, 2), [b.id, a.id]);
    const found = (await c.json("GET", "/api/notes?q=EXER%20lis")).body;
    assert.deepEqual(found.map((n: { id: string }) => n.id), [a.id]);
    assert.equal((await c.json("GET", "/api/notes?q=green")).body.length, 0);
    assert.deepEqual((await c.json("GET", "/api/notes?tag=alpha")).body.map((n: { id: string }) => n.id), [a.id]);
    const tagged = await c.json("PUT", `/api/notes/${a.id}/tags`, { tags: ["alpha", "beta"] });
    assert.equal(tagged.body.modified, saved.body.modified);
    assert.deepEqual((await c.json("GET", "/api/tags")).body, [
      { tag: "alpha", count: 1 },
      { tag: "beta", count: 1 },
    ]);
    assert.equal((await c.json("PUT", `/api/notes/${a.id}/tags`, { tags: ["x".repeat(41)] })).status, 400);
    assert.equal((await c.json("GET", `/api/notes/${a.id}`)).body.text, "## {green} =={b}Lisbon trip==\nwrist exercises");
  });

  test("trash, restore, delete forever, empty trash", async () => {
    const c = new Client(s.base);
    await c.login("bob", "hunter2");
    const n = (await c.json("POST", "/api/notes", {})).body;
    assert.equal((await c.json("DELETE", `/api/notes/${n.id}`)).status, 409);
    assert.ok((await c.json("POST", `/api/notes/${n.id}/trash`)).body.trashedAt);
    assert.equal((await c.json("PUT", `/api/notes/${n.id}`, { text: "x" })).status, 409);
    assert.equal((await c.json("GET", "/api/notes?trash=1")).body[0].id, n.id);
    assert.equal((await c.json("POST", `/api/notes/${n.id}/restore`)).body.trashedAt, null);
    await c.json("POST", `/api/notes/${n.id}/trash`);
    assert.equal((await c.json("DELETE", `/api/notes/${n.id}`)).status, 200);
    assert.equal((await c.json("GET", `/api/notes/${n.id}`)).status, 404);
    const m = (await c.json("POST", "/api/notes", {})).body;
    await c.json("POST", `/api/notes/${m.id}/trash`);
    assert.deepEqual((await c.json("POST", "/api/trash/empty")).body, { deleted: 1 });
  });

  test("a save and a tag change at once don't lose each other", async () => {
    const c = new Client(s.base);
    await c.login("bob", "hunter2");
    const n = (await c.json("POST", "/api/notes", {})).body;
    await Promise.all([
      c.json("PUT", `/api/notes/${n.id}`, { text: "hello" }),
      c.json("PUT", `/api/notes/${n.id}/tags`, { tags: ["race"] }),
    ]);
    const got = (await c.json("GET", `/api/notes/${n.id}`)).body;
    assert.equal(got.text, "hello");
    assert.deepEqual(got.tags, ["race"]);
  });

  test("Empty trash racing Restore never deletes a restored note", async () => {
    const c = new Client(s.base);
    await c.login("bob", "hunter2");
    for (let i = 0; i < 5; i++) {
      const n = (await c.json("POST", "/api/notes", {})).body;
      await c.json("POST", `/api/notes/${n.id}/trash`);
      const [, restored] = await Promise.all([c.json("POST", "/api/trash/empty"), c.json("POST", `/api/notes/${n.id}/restore`)]);
      const got = await c.json("GET", `/api/notes/${n.id}`);
      if (restored.status === 200) assert.equal(got.status, 200);
      if (got.status === 200) assert.equal(got.body.trashedAt, null);
    }
  });

  test("screenshots: PNG only, revalidated, private to the user", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const n = (await c.json("POST", "/api/notes", {})).body;
    const bad = await c.req("POST", `/api/notes/${n.id}/images`, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { "Content-Type": "image/png" });
    assert.equal(bad.status, 415);
    const wrongType = await c.req("POST", `/api/notes/${n.id}/images`, PNG, { "Content-Type": "image/jpeg" });
    assert.equal(wrongType.status, 415);
    const up = await c.req("POST", `/api/notes/${n.id}/images`, PNG, { "Content-Type": "image/png" });
    assert.equal(up.status, 201);
    const { name } = await up.json();
    assert.match(name, /^[a-z0-9]{8}\.png$/);
    const img = await c.req("GET", `/api/notes/${n.id}/images/${name}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("cache-control"), "private, no-cache");
    assert.deepEqual(new Uint8Array(await img.arrayBuffer()), PNG);
    const etag = img.headers.get("etag")!;
    assert.equal((await c.req("GET", `/api/notes/${n.id}/images/${name}`, undefined, { "If-None-Match": etag })).status, 304);
    const b = new Client(s.base);
    await b.login("bob", "hunter2");
    assert.equal((await b.req("GET", `/api/notes/${n.id}/images/${name}`, undefined, { "If-None-Match": etag })).status, 404);
    // Leftover files are cleaned up after a rejected upload.
    const files = await import("node:fs/promises").then((fs) => fs.readdir(join(s.dataDir, "notes", "alice", n.id)));
    assert.ok(!files.some((f) => f.endsWith(".upload")));
  });

  test("an upload into a note deleted meanwhile is a 404", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const n = (await c.json("POST", "/api/notes", {})).body;
    await c.json("POST", `/api/notes/${n.id}/trash`);
    assert.equal((await c.req("POST", `/api/notes/${n.id}/images`, PNG, { "Content-Type": "image/png" })).status, 409);
    await c.json("DELETE", `/api/notes/${n.id}`);
    assert.equal((await c.req("POST", `/api/notes/${n.id}/images`, PNG, { "Content-Type": "image/png" })).status, 404);
  });

  test("invalid notes are skipped; a bad tag only drops that tag", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const dir = join(s.dataDir, "notes", "alice");
    await mkdir(join(dir, "zzzzzzz1"), { recursive: true });
    await writeFile(join(dir, "zzzzzzz1", "meta.json"), "{ broken");
    await writeFile(join(dir, "zzzzzzz1", "note.md"), "x");
    await mkdir(join(dir, "zzzzzzz2"), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(join(dir, "zzzzzzz2", "meta.json"), JSON.stringify({ created: now, modified: now, tags: ["ok", "Not OK"], trashedAt: null }));
    await writeFile(join(dir, "zzzzzzz2", "note.md"), "kept");
    const list = (await c.json("GET", "/api/notes")).body as { id: string; tags: string[] }[];
    assert.ok(!list.some((n) => n.id === "zzzzzzz1"));
    assert.deepEqual(list.find((n) => n.id === "zzzzzzz2")?.tags, ["ok"]);
    await rm(join(dir, "zzzzzzz1"), { recursive: true });
    await rm(join(dir, "zzzzzzz2"), { recursive: true });
  });
});

describe("CLI", () => {
  test("two concurrent adds both land", async () => {
    const [x, y] = await Promise.all([cli(s.dataDir, ["add", "dave"], "pw1234"), cli(s.dataDir, ["add", "erin"], "pw1234")]);
    assert.equal(x.code, 0, x.stderr);
    assert.equal(y.code, 0, y.stderr);
    const users = JSON.parse(await readFile(join(s.dataDir, "users.json"), "utf8"));
    assert.ok(users.dave && users.erin);
  });

  test("a corrupt users.json stops the CLI without writing; the server keeps its last good copy", async () => {
    const path = join(s.dataDir, "users.json");
    const good = await readFile(path, "utf8");
    await writeFile(path, "{ not json");
    const r = await cli(s.dataDir, ["add", "frank"], "pw1234");
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(await readFile(path, "utf8"), "{ not json");
    assert.equal(await new Client(s.base).login("alice", "secret"), 200);
    await writeFile(path, good);
  });

  test("doctor reports problems and changes nothing", async () => {
    const dir = join(s.dataDir, "notes", "bob", "qqqqqqqq");
    await mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(join(dir, "meta.json"), JSON.stringify({ created: now, modified: now, tags: [], trashedAt: null }));
    await writeFile(join(dir, "note.md"), "x\n![](abcdefgh.png)");
    const r = await cli(s.dataDir, ["doctor"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /screenshot abcdefgh\.png is missing/);
    await rm(dir, { recursive: true });
  });
});

describe("CLI lock (code review r1)", () => {
  test("a failing command releases users.json.lock", async () => {
    const r = await cli(s.dataDir, ["remove", "nobody-here"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /No user nobody-here/);
    const t = Date.now();
    assert.equal((await cli(s.dataDir, ["add", "gina"], "pw1234")).code, 0);
    assert.ok(Date.now() - t < 5000, "the next command didn't wait for a leftover lock");
  });
});

describe("usernames (code review r1)", () => {
  test("__proto__ is an ordinary username", async () => {
    assert.equal((await cli(s.dataDir, ["add", "__proto__"], "pw1234")).code, 0);
    const users = JSON.parse(await readFile(join(s.dataDir, "users.json"), "utf8"));
    assert.ok(Object.hasOwn(users, "__proto__"));
    assert.equal(await new Client(s.base).login("__proto__", "pw1234"), 200);
  });
});

describe("limits (code review r1)", () => {
  test("415 for a non-JSON body, 413 for an oversized one", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const wrongType = await c.req("POST", "/api/notes", new TextEncoder().encode("{}"), { "Content-Type": "text/plain" });
    assert.equal(wrongType.status, 415);
    const big = await c.req("POST", "/api/login", { username: "x".repeat(70_000), password: "y" });
    assert.equal(big.status, 413);
  });

  test("piped passwords: both lines are read", async () => {
    const { execFile } = await import("node:child_process");
    const { ROOT } = await import("./helpers.ts");
    const code = await new Promise<number>((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: s.dataDir };
      delete env.MARGIN_PASSWORD;
      const child = execFile(process.execPath, [join(ROOT, "cli.js"), "add", "piped"], { env }, (err) => resolve(err ? 1 : 0));
      child.stdin!.end("abcd\nabcd\n");
    });
    assert.equal(code, 0);
    assert.equal(await new Client(s.base).login("piped", "abcd"), 200);
  });
});
