// margin-user: manage Margin's users (add, passwd, remove, list) and check the data folder (doctor).

import { randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isImageName, isNoteId, isTag, isUsername, MIN_PASSWORD_LENGTH } from "../shared/rules.ts";
import { parseDoc } from "../shared/syntax.ts";
import { parseMeta } from "../server/store.ts";
import {
  acquireLock,
  hashPassword,
  lockPath,
  LockedError,
  readUsers,
  releaseLock,
  updateUsers,
  UsersFileError,
} from "../server/users.ts";

const dataDir = resolve(process.env.DATA_DIR || "./data");

const USAGE = `Usage: margin-user <command>

  add <name>      add a user (asks for a password)
  passwd <name>   change a user's password
  remove <name>   remove a user (their notes stay on disk)
  list            list users
  doctor          check the data folder for problems (changes nothing)

Set MARGIN_PASSWORD to give the password without being asked.
The data folder is DATA_DIR (default ./data); now ${dataDir}.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** An error raised while holding the lock: reported after the lock is released. */
class CliError extends Error {}

/** Read a line from the terminal without echoing it. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolvePrompt, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    if (!stdin.isTTY) {
      // Not a terminal: read one line from stdin.
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          stdin.off("data", onData);
          stdin.pause();
          process.stdout.write("\n");
          resolvePrompt(buf.slice(0, nl).replace(/\r$/, ""));
        }
      };
      stdin.on("data", onData);
      stdin.on("end", () => resolvePrompt(buf));
      stdin.resume();
      return;
    }
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onKey = (key: string) => {
      for (const ch of key) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onKey);
          process.stdout.write("\n");
          resolvePrompt(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onKey);
  });
}

async function getPassword(): Promise<string> {
  const fromEnv = process.env.MARGIN_PASSWORD;
  if (fromEnv !== undefined) {
    if (fromEnv.length < MIN_PASSWORD_LENGTH) fail(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return fromEnv;
  }
  const first = await askHidden("Password: ");
  if (first.length < MIN_PASSWORD_LENGTH) fail(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const second = await askHidden("Repeat password: ");
  if (first !== second) fail("The passwords don't match.");
  return first;
}

async function withUsersLock(change: Parameters<typeof updateUsers>[2]): Promise<void> {
  let token: string;
  try {
    token = await acquireLock(dataDir);
  } catch (err) {
    if (err instanceof LockedError) fail(err.message);
    throw err;
  }
  try {
    await updateUsers(dataDir, token, change);
  } finally {
    await releaseLock(dataDir, token);
  }
}

function needName(name: string | undefined): string {
  if (!name) fail(USAGE);
  if (!isUsername(name)) fail("Usernames are 1–32 characters of a-z, 0-9, _ and -.");
  return name;
}

async function add(nameArg: string | undefined): Promise<void> {
  const name = needName(nameArg);
  const before = await readUsers(dataDir);
  if (Object.hasOwn(before, name)) fail(`User ${name} already exists.`);
  const hashed = await hashPassword(await getPassword());
  await withUsersLock((users) => {
    if (Object.hasOwn(users, name)) throw new CliError(`User ${name} already exists.`);
    users[name] = { uid: randomBytes(16).toString("hex"), ...hashed, created: new Date().toISOString() };
  });
  console.log(`Added ${name}.`);
}

async function passwd(nameArg: string | undefined): Promise<void> {
  const name = needName(nameArg);
  if (!Object.hasOwn(await readUsers(dataDir), name)) fail(`No user ${name}.`);
  const hashed = await hashPassword(await getPassword());
  await withUsersLock((users) => {
    const old = Object.hasOwn(users, name) ? users[name] : undefined;
    if (!old) throw new CliError(`No user ${name}.`);
    users[name] = { ...old, ...hashed };
  });
  console.log(`Changed the password of ${name}.`);
}

async function remove(nameArg: string | undefined): Promise<void> {
  const name = needName(nameArg);
  await withUsersLock((users) => {
    if (!Object.hasOwn(users, name)) throw new CliError(`No user ${name}.`);
    delete users[name];
  });
  console.log(`Removed ${name}. Their notes stay in ${join(dataDir, "notes", name)}.`);
}

async function list(): Promise<void> {
  const users = await readUsers(dataDir);
  const names = Object.keys(users).sort();
  if (!names.length) console.log("No users yet. Add one with: margin-user add <name>");
  for (const name of names) console.log(`${name}  (added ${users[name].created})`);
}

// ---------------------------------------------------------------------------------------------
// doctor (architecture §5.9): reports problems, changes nothing.

const FRESH_MS = 60_000;

async function ageMs(path: string): Promise<number> {
  try {
    return Date.now() - (await stat(path)).mtimeMs;
  } catch {
    return Infinity;
  }
}

async function doctor(): Promise<void> {
  const problems: string[] = [];
  const lock = lockPath(dataDir);
  if ((await ageMs(lock)) !== Infinity && (await ageMs(lock)) > FRESH_MS) {
    const contents = (await readFile(lock, "utf8").catch(() => "")).trim();
    problems.push(`${lock}: leftover lock (${contents || "empty"}); delete it if no margin-user is running`);
  }
  try {
    await readUsers(dataDir);
  } catch (err) {
    if (err instanceof UsersFileError) problems.push(err.message);
    else throw err;
  }
  const notesDir = join(dataDir, "notes");
  let users: string[] = [];
  try {
    users = (await readdir(notesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    users = [];
  }
  for (const user of users.sort()) {
    const userDir = join(notesDir, user);
    for (const entry of (await readdir(userDir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const dir = join(userDir, entry.name);
      if (!entry.isDirectory()) continue;
      if (!isNoteId(entry.name)) continue;
      const fresh = (await ageMs(dir)) < FRESH_MS;
      const metaText = await readFile(join(dir, "meta.json"), "utf8").catch(() => null);
      const noteText = await readFile(join(dir, "note.md"), "utf8").catch(() => null);
      if (metaText === null) {
        if (!fresh) problems.push(`${dir}: meta.json is missing (Margin skips this note)`);
      } else {
        const meta = parseMeta(metaText);
        if (!meta) problems.push(`${dir}/meta.json: malformed (Margin skips this note)`);
        else {
          const raw = (JSON.parse(metaText) as { tags?: unknown[] }).tags ?? [];
          const bad = raw.filter((t) => typeof t !== "string" || !isTag(t));
          if (bad.length) problems.push(`${dir}/meta.json: invalid tags ignored: ${JSON.stringify(bad)}`);
        }
      }
      if (noteText === null && !fresh) problems.push(`${dir}: note.md is missing or unreadable (Margin skips this note)`);
      const files = await readdir(dir);
      for (const f of files) {
        if ((f.endsWith(".png.upload") || f.includes(".tmp-")) && (await ageMs(join(dir, f))) > FRESH_MS) {
          problems.push(`${join(dir, f)}: leftover temporary file`);
        }
      }
      if (noteText !== null) {
        const present = new Set(files.filter(isImageName));
        for (const line of parseDoc(noteText).lines) {
          if (line.kind === "image" && !present.has(line.image!)) problems.push(`${dir}: screenshot ${line.image} is missing (line ${line.index + 1})`);
        }
      }
    }
  }
  for (const p of problems) console.log(p);
  console.log(problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"} found in ${dataDir}.` : `No problems found in ${dataDir}.`);
  process.exitCode = problems.length ? 1 : 0;
}

async function main(): Promise<void> {
  const [command, name] = process.argv.slice(2);
  try {
    switch (command) {
      case "add":
        return await add(name);
      case "passwd":
        return await passwd(name);
      case "remove":
        return await remove(name);
      case "list":
        return await list();
      case "doctor":
        return await doctor();
      default:
        fail(USAGE);
    }
  } catch (err) {
    if (err instanceof CliError) fail(err.message);
    if (err instanceof UsersFileError) fail(`${err.message}\nNothing was changed.`);
    fail(`margin-user: ${(err as Error).message}`);
  }
}

await main();
