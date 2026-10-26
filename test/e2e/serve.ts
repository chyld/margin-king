// The server the browser tests run against: a fresh data folder, two users, its own port.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../src/server/main.ts";
import { acquireLock, hashPassword, releaseLock, updateUsers } from "../../src/server/users.ts";

const dataDir = await mkdtemp(join(tmpdir(), "margin-e2e-"));
for (const [name, password] of [
  ["alice", "secret"],
  ["bob", "hunter2"],
]) {
  const hashed = await hashPassword(password);
  const token = await acquireLock(dataDir);
  await updateUsers(dataDir, token, (users) => {
    users[name] = { uid: randomBytes(16).toString("hex"), ...hashed, created: new Date().toISOString() };
  });
  await releaseLock(dataDir, token);
}
const app = await createApp({
  dataDir,
  port: Number(process.env.E2E_PORT || 5793),
  host: "127.0.0.1",
  production: true,
  publicDir: resolve(import.meta.dirname, "../../dist/public"),
});
await app.listen();
console.log(`e2e server on ${process.env.E2E_PORT}, data in ${dataDir}`);
const stop = async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
