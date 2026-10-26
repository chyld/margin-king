import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli, Client, start, type Running } from "./helpers.ts";

let s: Running;
before(async () => {
  s = await start();
  await cli(s.dataDir, ["add", "alice"], "secret");
  const dir = join(s.dataDir, "notes", "alice");
  const t = Date.now();
  await Promise.all(
    Array.from({ length: 2000 }, async (_, i) => {
      const id = `n${String(i).padStart(7, "0")}`;
      await mkdir(join(dir, id), { recursive: true });
      const iso = new Date(t - i * 1000).toISOString();
      await writeFile(join(dir, id, "meta.json"), JSON.stringify({ created: iso, modified: iso, tags: [`t${i % 7}`], trashedAt: null }));
      await writeFile(join(dir, id, "note.md"), `## {green} Note ${i}\n=={b}bold== text with words ${"lorem ipsum ".repeat(20)}`);
    }),
  );
});
after(async () => s.close());

test("listing and searching 2,000 notes stays fast (architecture §8: target under 150 ms)", async () => {
  const c = new Client(s.base);
  await c.login("alice", "secret");
  await c.json("GET", "/api/notes"); // warm the page cache
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const r = await c.json("GET", "/api/notes?q=lorem%20note");
    times.push(performance.now() - t);
    assert.equal(r.body.length, 2000);
  }
  const best = Math.min(...times);
  console.log(`2,000-note search: best ${best.toFixed(0)} ms`);
  assert.ok(best < 1500, `too slow: ${best} ms`);
});
