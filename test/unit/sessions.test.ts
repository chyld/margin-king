import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESSION_MS, SessionStore } from "../../src/server/sessions.ts";

const users = { alice: { uid: "u1" } } as never;

test("sessions: sliding renewal after an hour, expiry, user removal, hashed tokens on disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-sessions-"));
  let now = 1_000_000;
  const store = new SessionStore(dir, () => now);
  const token = store.create("alice", "u1");
  assert.equal(store.lookup(token, users)?.renewed, false);
  now += 30 * 60 * 1000;
  assert.equal(store.lookup(token, users)?.renewed, false);
  now += 31 * 60 * 1000;
  const renewed = store.lookup(token, users);
  assert.equal(renewed?.renewed, true);
  assert.equal(renewed?.session.expires, now + SESSION_MS);
  now += SESSION_MS + 1;
  assert.equal(store.lookup(token, users), null);
  const t2 = store.create("alice", "u1");
  assert.equal(store.lookup(t2, { alice: { uid: "other" } } as never), null);
  const t3 = store.create("alice", "u1");
  await store.flush();
  const disk = await readFile(join(dir, "sessions.json"), "utf8");
  assert.ok(!disk.includes(t3), "the raw token never reaches the disk");
  await rm(dir, { recursive: true, force: true });
});
