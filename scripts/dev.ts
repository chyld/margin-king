// npm run dev: the client build in watch mode plus the server restarted on changes.
// Each child is stopped by its own PID on exit.

import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [
  spawn(process.execPath, ["scripts/build.ts", "--watch"], { stdio: "inherit" }),
  spawn(process.execPath, ["--watch-path=src", "src/server/main.ts"], { stdio: "inherit", env: { ...process.env, DATA_DIR: process.env.DATA_DIR ?? "./dev-data", PORT: process.env.PORT ?? "5556" } }),
];

const stop = () => {
  for (const c of children) if (c.pid && c.exitCode === null) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
