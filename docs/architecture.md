# Margin: architecture

Status: **revised after beta review round 1** (findings and how each was handled:
[`reviews/architecture-r1.md`](reviews/architecture-r1.md)), with the **owner's decisions** recorded
in §12, §13 and §15 (2026-10-25). Nothing is built yet.

This document says how Margin will be built. *What* Margin does is defined by the original README,
copied verbatim to [`original-readme.md`](original-readme.md) (from `chyld/note-mvp` at
`7a53085`). Section numbers written as "README §x" point into that file.

## 0. Scope

- **Requirements** are README §2 (running, including the development commands), §3 (features),
  §4 (design), §6 (decisions) and §7 (accepted limitations). The app must behave and look as those
  sections say.
- **README §5** describes how the original was built. This design is independent of it. §11 says
  where it lands on the same choice and where it differs, and why.
- **No new features** beyond the two the owner approved (§15). Anything else a user could notice that
  the README doesn't ask for is listed in §12 with the owner's approval. Gaps where the README is
  silent, with the default the owner confirmed, are in §13.

## 1. Principles

1. **The raw text is the note.** The editor's document is always exactly the text saved to
   `note.md`. Render mode is a view over that text; raw mode is the same document without the view.
2. **One model for formatting and structural edits.** A line is turned into a list of *styled
   visible characters* (§6.3). The formatting popup and the render-mode editing rules are pure
   operations on that list. Results are serialized back to syntax, **re-parsed and checked, both the
   line and the whole document's structure**, before they reach the editor.
3. **Commands carry intent, a filter guarantees invariants.** Keys like Backspace and Enter run
   commands that implement README §3.7. Because text also arrives by other paths (Android DOM
   changes, cut, drag-and-drop, paste, word deletion, IME), a single transaction filter enforces the
   same invariants on every render-mode edit, whatever its source (§7.7).
4. **Pure core, thin shells.** Parsing, the line model, all operations, titles and search text live
   in `src/shared/` as pure functions with no DOM and no I/O. The server and the client both import
   them, and they're unit-tested without a browser.
5. **Few dependencies.** The server has **zero runtime dependencies** (Node built-ins only). The
   client depends only on CodeMirror 6.
6. **Writes are atomic and serialized.** Every file write is write-temp-then-rename, and writes to the
   same file are queued, never concurrent.
7. **Tested from the start** (§9).

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 26** (Docker `node:26-alpine`; it becomes LTS this month). Code also runs on Node 24 LTS. | Same language as the client, so the parser is shared (principle 4). |
| Language | **TypeScript**, strict, *erasable syntax only* (no enums, namespaces or parameter properties), `.ts` import specifiers, `package.json` `"type": "module"` | Node runs it directly (type stripping), so the server, the CLI and the tests need **no build step**. `tsc --noEmit` type-checks. Without `"type": "module"`, Node refuses the `import` statements. |
| HTTP | `node:http` plus a small router and helpers (`src/server/http.ts`) | The surface is ~15 routes and a fixed set of static files. No framework to update or audit. |
| Passwords | `node:crypto` scrypt | Built in; no native modules. |
| Editor | **CodeMirror 6** (`@codemirror/state`, `view`, `commands`) | Its document is plain text with decorations, atomic ranges and transaction filters on top: an exact fit for principle 1. ProseMirror and Lexical keep a rich-text tree, which would need a lossless two-way mapping to raw text with no escape character. |
| UI | Plain TypeScript and DOM, no framework | The UI is small and the editor is CodeMirror anyway. One store plus components that own their DOM subtree (§7.1). |
| Client build | **esbuild**: two bundles (`app`, `login`) and one CSS file (which includes the generated palette CSS) | Fast and simple. |
| Tests | `node:test` (unit, server); **Playwright** (browser) | Built in, plus the standard browser runner. |

Dev dependencies: `typescript`, `esbuild`, `@types/node`, `@playwright/test`.

## 3. Repository layout

```
compose.yaml  Dockerfile  .dockerignore  .gitignore  package.json  tsconfig.json
cli.js                          `node cli.js …` (README §2 development); imports src/cli/margin-user.ts
bin/margin-user                 container wrapper: exec node /app/src/cli/margin-user.ts "$@"
data/.gitkeep                   so a fresh clone has a ./data the user owns (§10)
scripts/build.ts                esbuild bundles + palette CSS + copies src/public/ → dist/public/
src/
  shared/                       pure, no DOM, no I/O; imported by server and client
    palette.ts                  the 12 hues × light/deep, color names
    colors.ts                   dark shade (HSL), tag-name hash → hue
    syntax.ts                   parseDoc (lines, code blocks, sections), parseInline (tokens)
    model.ts                    styled-character line model: toModel, serialize, verify, positions
    ops.ts                      formatting ops, targets, formatState, edit ops
    text.ts                     stripInline, visibleText, noteTitle
    rules.ts                    validators: username, tag, note id, image name, URL normalize
  server/
    main.ts                     config from env, data-dir check, start, graceful shutdown
    http.ts                     router, JSON body, cookies, static files, errors, headers
    pages.ts                    GET / → login / app / 404
    api.ts                      the JSON API
    store.ts                    notes on disk, per-note locks
    fsx.ts                      atomic write, exclusive create, keyed async locks, file lock, write queue
    users.ts                    users.json read/write (shared with the CLI), password hashing
    sessions.ts                 session store
  cli/margin-user.ts            add / passwd / remove / list
  client/
    app.ts  login.ts            entry points
    state.ts                    app state and store
    api.ts                      fetch wrapper
    actions.ts                  everything that changes state: open, save, trash, tags, …
    url.ts  prefs.ts            address bar sync; localStorage
    ui/                         sidebar, note list, tag filter, search, menu bar, save button,
                                switches, tag chips + box + suggestions, trash banner,
                                empty state, toasts, drawer, small DOM helpers
    editor/
      editor.ts                 EditorView setup, compartments, open/mode/font/read-only
      analysis.ts               StateField: parse result (both modes)
      render.ts                 StateField: decorations + hidden ranges (render mode)
      widgets.ts                fold toggle, ⋯ pill, image, Copy button, end-of-file marker
      caret.ts                  caret placement rules (render mode)
      guard.ts                  render-mode intent keymap + invariant filter
      codetab.ts                Tab / Shift+Tab in code blocks (both modes)
      collapse.ts               collapsed-sections field + persistence
      popup.ts                  formatting popup / bar
      links.ts  paste.ts  copy.ts   Ctrl/Cmd+click, link chip; paste and uploads; copy/cut
    styles/*.css
  public/                       index.html, login.html, 404.html, favicon.svg
test/
  unit/  server/  e2e/
docs/
```

## 4. Data on disk

```
$DATA_DIR/
  users.json                    written only by the CLI (under a lock file)
  sessions.json                 written only by the server
  notes/<username>/<noteId>/
    note.md                     the raw text, byte-for-byte what raw mode shows
    meta.json                   { created, modified, tags, trashedAt }
    <imageId>.png               pasted screenshots
```

- The note-folder layout and the `meta.json` fields match the original (README §5.3), so notes can
  be copied between the two. `users.json` and `sessions.json` do not match.
- **One writer process per file.** The CLI writes `users.json`; the server writes `sessions.json`
  and `notes/`. Two CLI runs at once are serialized by `users.json.lock`, created with exclusive
  open; it holds the CLI's PID and is taken over if older than 10 s. Inside the server, writes to
  one file go through a single queue, so an older snapshot can never be renamed over a newer one.
- `users.json`:
  `{ "alice": { "uid": "<hex 16 B>", "salt": "<hex 16 B>", "hash": "<hex 64 B>", "N": 32768, "r": 8, "p": 3, "created": "<ISO>" } }`.
  `uid` is random per `add` and kept by `passwd`. The scrypt cost is stored per user so it can be
  raised later.
- `sessions.json`: `{ "<sha256(token) hex>": { "user", "uid", "expires", "renewed" } }`. Only the
  **hash** of the token is stored, so a copy of the data folder can't be used to log in.
- A missing `users.json` or `sessions.json` means "empty"; the file is created on first write.
- A note folder is valid if `meta.json` parses. `note.md` is written first, so a folder left
  without `meta.json` by a crash is skipped (and logged), never shown.
- IDs (notes and images): 8 characters of `a-z0-9` from `crypto.randomInt(36)` (unbiased).
  `notes/<username>/` is created (recursive, idempotent) when the user creates their first note;
  the note folder itself is created with a non-recursive `mkdir`, so an id collision fails with
  `EEXIST` and a new id is drawn. Images are created with exclusive open (`wx`).

## 5. Server

### 5.1 Process and configuration

- One Node process: `node src/server/main.ts`. Environment: `DATA_DIR` (default `./data`), `PORT`
  (default `5555`), `HOST` (default `0.0.0.0`), `NODE_ENV` (`production` in the image).
- On start: create `$DATA_DIR/notes` and check the data directory is writable. If not, exit with a
  message naming the directory and the process's UID/GID (so a root-owned `./data` is obvious).
  Load `users.json` and `sessions.json`, drop expired sessions, listen.
- `requestTimeout` is 0 (uploads have no size limit, README §3.11) and sockets idle for 120 s are
  closed instead.
- **Shutdown** on `SIGTERM` / `SIGINT` (Node is PID 1 in the container): stop accepting connections,
  wait up to 10 s for in-flight requests, flush `sessions.json` through its write queue, exit.

### 5.2 Request pipeline

1. Parse the URL. Set the security headers (5.3) on every response.
2. Refresh `users.json` if it changed (5.7). Resolve the session from the `margin_session` cookie
   (5.8) and renew it if due.
3. Match the route table: `{ method, path regex, access: "public" | "user", handler }`. `HEAD` is
   accepted wherever `GET` is.
4. `user` routes without a valid session → 401 `{ error }`. All `/api/*` responses carry
   `Cache-Control: no-store`.
5. Bodies: `readJson(req, limit)` requires `Content-Type: application/json` (415 otherwise) and a
   size limit (413 over it): 64 KB everywhere except note text (50 MB). Uploads are streamed (5.6).
6. Handlers throw `HttpError(status, message)` for expected errors, which become `{ error }`.
   Anything else is logged with a request id and becomes 500 `{ error: "Server error" }`.
7. Unknown `/api/*` paths → 404 `{ error: "Not found" }`. Any other unknown path → `404.html` with
   status 404.
8. Path parameters are validated against `rules.ts` (`^[a-z0-9]{8}$`, `^[a-z0-9]{8}\.png$`) before
   any filesystem access, so a path can never leave the user's notes folder.

### 5.3 Security headers and request forgery

Invisible to users:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
  (`'unsafe-inline'` for styles because CodeMirror injects its own style sheet).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Every non-GET `/api` request must carry the header `X-Margin: 1`.** A page on another origin
  can only send a custom header after a CORS preflight, which this server never approves, so
  cross-origin form posts and fetches can't act on a user's session. This matters because
  `SameSite=Lax` doesn't protect against other services on the same host (a different port on the
  same IP is "same-site"). It also works behind a TLS proxy that rewrites `Host`, unlike an
  `Origin`/`Host` comparison.
- External links open with `noopener,noreferrer`.

### 5.4 Pages and static files

- With `NODE_ENV=production`, every file in `dist/public/` is read into memory at startup, with its
  content type and an ETag; that set is the allowlist. Otherwise (development) files are read from
  `dist/public/` on each request (names validated, no path may leave the folder), so a rebuilt
  bundle shows on reload. Responses have `Cache-Control: no-cache` and answer `If-None-Match`
  with 304.
- `GET /favicon.ico` → the SVG favicon.
- `GET /` (the only page route), in this order:
  1. not logged in → `login.html`, status 200, same URL;
  2. any query parameter other than `note` or `tag`, both given, either given more than once or
     empty, a `note` that isn't one of the user's notes (trashed counts as existing), or a `tag`
     that none of the user's non-trashed notes use → `404.html`, status 404;
  3. otherwise → `index.html`.

### 5.5 API

All bodies and responses are JSON. `Summary` = `{ id, title, created, modified, tags, trashedAt }`.

| Method & path | Body | Response / errors |
|---|---|---|
| `POST /api/login` | `{ username, password }` | `{ user }` + cookie. Wrong → 401 `{ error: "Wrong username or password" }`, sent no sooner than 500 ms after the request arrived. |
| `POST /api/logout` | | `{ ok: true }`, session deleted, cookie cleared |
| `GET /api/session` | | `{ user }` |
| `GET /api/notes?tag=&q=&trash=1` | | `Summary[]` (5.6 *Listing*) |
| `GET /api/tags` | | `[{ tag, count }]` over non-trashed notes, alphabetical |
| `POST /api/notes` | `{ tags? }` | 201 `Summary` |
| `GET /api/notes/:id` | | `Summary & { text }` |
| `PUT /api/notes/:id` | `{ text }` ≤ 50 MB | `Summary` (sets `modified`); 409 if trashed |
| `PUT /api/notes/:id/tags` | `{ tags }` | `Summary` (doesn't touch `modified`); 400 unless every tag is `^[a-z0-9]{1,40}$`; de-duplicated, order kept |
| `POST /api/notes/:id/trash` | | `Summary` with `trashedAt` |
| `POST /api/notes/:id/restore` | | `Summary` with `trashedAt: null` |
| `DELETE /api/notes/:id` | | `{ ok: true }`; 409 unless trashed |
| `POST /api/trash/empty` | | `{ deleted: n }` |
| `POST /api/notes/:id/images` | raw bytes, `Content-Type: image/png` | 201 `{ name }`; 415 if not a PNG; 409 if trashed |
| `GET /api/notes/:id/images/:name` | | the PNG; `Cache-Control: private, max-age=31536000, immutable` |

Unknown or foreign note → 404 `{ error: "Note not found" }`.

### 5.6 Note store (`store.ts`)

**Locks.** An in-process async lock keyed by `user/noteId` (a promise chain per key). Saving text,
setting tags, trash, restore, delete and the final rename of an upload all take it, so a text save
and a tag change arriving together can't lose each other's `meta.json` update. Only the server
writes notes, so an in-process lock is enough.

**Atomic writes.** Write `<file>.tmp-<random>`, `fsync`, `rename`. Saving text writes `note.md`
first, then `meta.json`.

**Reading.** Listings read the user's note folders directly on every request, as README §7 accepts
for this scale (reads run in parallel, at most 32 at a time). There's no cache, so files changed on
disk while Margin runs (a backup restore, a manual edit) always show up. The server test suite
measures a listing over 2,000 notes; a cache is added only if that's too slow.

**Listing** (`GET /api/notes`): take non-trashed notes (or trashed ones with `trash=1`), keep those
with `tag` (if given), keep those whose search text contains every term of `q` (lowercased, split
on whitespace, empty terms dropped). Sort newest first by `modified` (or `trashedAt` in the trash),
then by `id`, so the order is stable. Search text is `visibleText(text).toLowerCase()` (§6.5).

**Uploads.** Check the note exists and isn't trashed. Pick a name, open `<name>.png.upload` with
`wx`, stream the request into it, checking the first 8 bytes against the PNG signature as they
arrive (abort, delete the temp file and send 415 on a mismatch). No size limit (README §3.11).
Then, under the note's lock, check again that the note still exists and isn't trashed, and rename
into place. The lock isn't held during the transfer, so a large upload doesn't block saves. If the
client disconnects mid-upload, the temp file is deleted.

**Delete forever / Empty trash.** Under the note's lock, remove the folder recursively (screenshots
included). Empty trash does this note by note and returns the count.

### 5.7 Users and passwords (`users.ts`)

- scrypt with **N = 2^15, r = 8, p = 3**, one of OWASP's equal-strength settings, chosen over
  N = 2^17 for its smaller memory (~32 MiB instead of ~128 MiB) on small home servers. **`maxmem` is
  set explicitly to 64 MiB on every call**, in the server and the CLI: Node's default ceiling is
  32 MiB and rejects these parameters. About 180 ms per hash on the development machine. A 16-byte
  random salt, a 64-byte key, compared with `timingSafeEqual`. Unknown usernames are hashed against
  a fixed dummy record, so timing doesn't reveal which names exist.
- At most **two** hashes run at once, with at most 16 waiting; a login beyond that gets 503 at
  once. Waiting logins are dropped if their client disconnects. This bounds memory and keeps
  libuv's thread pool free for file I/O during a login flood. It's invisible in normal use.
- The server keeps `users.json` in memory and re-reads it when its inode, size or mtime changes.
  The CLI always replaces the file by rename, so every change gets a new inode. The check (one
  `stat`) runs before every login and every session lookup, so `margin-user add` followed by a
  login works without a restart (README §2).

### 5.8 Sessions (`sessions.ts`)

- Token: 32 random bytes, hex. Cookie:
  `margin_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, plus **`Secure` when
  the request arrived with `X-Forwarded-Proto: https`** (Margin behind a TLS proxy, §15). The flag is
  decided per response, so the renewed and the cleared cookie match the request. A client that fakes
  the header only marks its own cookie Secure, which its browser then won't send over plain HTTP, so
  trusting the header can't weaken anyone else's session.
- Stored in memory keyed by `sha256(token)`, persisted to `sessions.json` 200 ms after a change
  through the file's write queue (each write takes the latest snapshot), and flushed on shutdown.
- **Valid** when it exists, hasn't expired, its user exists, and that user's `uid` equals the
  session's `uid`. So removing a user ends their sessions even if the same name is added again
  straight away.
- **Sliding expiry**: when more than an hour has passed since `renewed`, set
  `expires = now + 30 days`, `renewed = now`, and re-send the cookie.
- Expired sessions, and sessions whose user or `uid` no longer matches, are pruned on start, on
  every reload of `users.json`, and hourly.

### 5.9 CLI (`margin-user`)

`add <name>`, `passwd <name>`, `remove <name>`, `list`. Validates names
(`^[a-z0-9_-]{1,32}$`) and passwords (≥ 4 characters); reads the password twice with hidden input,
or once from `MARGIN_PASSWORD`. Takes `users.json.lock`, re-reads `users.json`, changes it, writes it
atomically, and releases the lock, using the same code the server reads it with. `add` gives the
user a new random `uid`; `passwd` keeps `uid` and `created`. `remove` leaves the user's notes on
disk. Installed in the image as `/usr/local/bin/margin-user`; in development, `node cli.js`.

**`margin-user doctor`** (§15) reports, per user, and **changes nothing**:
- note folders whose `meta.json` is missing or doesn't parse (the ones Margin skips);
- leftover temporary files: `*.png.upload` from interrupted uploads and `*.tmp-*` from interrupted
  writes;
- screenshot lines (`![](name.png)`, outside code blocks, found with the shared parser) whose PNG
  isn't in the note's folder.

It prints one line per problem with its path, and a summary. It exits 0 when it finds nothing and 1
otherwise, so it can be scripted. It reads files as they are and takes no locks, so it's safe to
run while Margin is running (`docker compose exec margin margin-user doctor`).

## 6. Shared core (`src/shared/`)

### 6.1 Palette and colors

- `palette.ts`: the 12 hues in README order, each `{ name, light, deep }`, and the 24 color names
  (`<hue>`, `<hue>-deep`).
- `colors.ts`: `darkShade(hex)` (HSL hue kept, saturation capped at 75 %, lightness 28 %) and
  `tagHue(name)` (README §4.4 hash, `% 12`).
- The build generates palette CSS (bundled into the one CSS file): a class per highlight color
  (`hl-<name>`, setting `--hl`), per section color (`sec-<name>`, setting `--sec` and `--heading`)
  and per tag hue (`hue-<0..11>`, setting `--light`, `--deep` and `--dark`). The DOM carries only
  class names, never inline colors, and the colors are defined in one place.

### 6.2 Parser (`syntax.ts`)

The grammar is exactly README §3.5. Offsets are UTF-16 code units, like CodeMirror's. Every entry
point first normalizes `\r\n` and `\r` to `\n`, as CodeMirror does when it loads text, so the
server's titles and search agree with the editor for files copied in from Windows. (Margin itself
always writes `\n`.)

**`parseDoc(text) → Doc`**: `lines`, `blocks` and `sections`.

1. **Code blocks.** Scan down. A line that **starts with** ```` ``` ```` (anything after it is ignored,
   README §3.5) opens a block, which closes at the next line that is exactly ```` ``` ```` plus optional
   trailing spaces or tabs. Lines between are `code`. If no closing line follows, scanning for blocks
   stops and the rest is ordinary lines (an unclosed fence is plain text).
2. **Headings**, among lines not in a block: `^## \{(<color>)\} (?=\S)` with a known color. Each
   heading starts a section that runs to the line before the next heading, or to the last line.
3. **Screenshots**, among lines not in a block: `^!\[\]\(([a-z0-9]{8}\.png)\)$`.
4. Everything else is `text`.

Each line: `{ index, from, to, kind, block?, section?, heading?: { color, prefixLen }, image? }`.

**`parseInline(lineText) → Token[]`**: left to right; at each position the first match wins:

1. `` ` `` → **code** up to the next backtick, with at least one character inside;
2. `[` → **link** `[text](url)`: text non-empty, no `]`; url is `https?://` followed by characters
   other than whitespace, `<>()[]` and backticks;
3. `h` → **bare URL**, if the previous character isn't a letter, digit or `/`; same character set;
   trailing `. , ; : ! ? ' " * _ ~ =` trimmed;
4. `=={` → **highlight**, if `{…}` holds valid options (at most one color, `b` and `u` at most once
   each, joined by `+`) and the **first** `==` after it that isn't inside inline code or a
   `[text](url)` link leaves at least one character of content. Otherwise this `=` is literal and
   scanning moves on. Inside a highlight, code, links and bare URLs are parsed; highlights are not.
   (README §3.5 lists "links and bare URLs" separately, so bare URLs are *not* skipped when looking
   for the closing `==`.)
5. otherwise, move one character on.

Worked examples that the unit tests pin:

| Raw | Result |
|---|---|
| `=={green}=={b}abc==` | `=={green}` literal (its first `==` leaves it empty), then bold `abc` |
| ``=={green}a`==`b==`` | one green highlight containing `a`, inline code ``==`` and `b`: the `==` inside the code is skipped |
| `=={green}https://x.com?q=a==b==` | green `https://x.com?q=a`, then literal `b==` |
| `=={u+lime}x==` | lime + underline (Margin writes it back as `=={lime+u}x==` only if it rewrites that token) |
| `=={lime+lime}x==` | literal: a duplicated option is invalid |

Tokens carry `from/to` (with syntax) and `contentFrom/contentTo` (visible part), plus `opts`
(highlights) or `url` (links and bare URLs).

### 6.3 Line model (`model.ts`)

The core of this design. It applies to `text` lines and to a heading's text after its prefix.
`code` lines are literal and never modeled (an edit there is a plain text edit). Fence and
screenshot lines are handled by line rules (§7.7).

```ts
type Style = { color: string | null; b: boolean; u: boolean; code: boolean };
type LinkRef = { url: string; form: "md" | "bare"; id: number };  // id: which link it belongs to
type VChar = { ch: string; style: Style; link: LinkRef | null; raw: number }; // raw: -1 if new
type LineModel = { prefix: string; chars: VChar[] };                         // prefix: "## {color} " or ""
```

- **Units.** One `VChar` per UTF-16 code unit, so raw offsets map one-to-one to CodeMirror
  positions. Every operation first widens its range to grapheme-cluster boundaries
  (`Intl.Segmenter`), so a cluster is never split and a lone surrogate is never written.
- Hidden syntax is gone. Bare-URL characters carry `link` with `form: "bare"` (that's what makes the
  Link button and prompt work on them). Characters of a link never have `code`, because link text is
  plain. A heading's section color is not stored in `style`; `formatState` adds it (§6.4).
- **Positions.** A raw position maps to *(visible index, enclosing tokens)*. The two raw positions on
  either side of a hidden marker map to the same visible index but different enclosing tokens
  ("inside the highlight" and "after it"), so that distinction survives every operation and
  selection restore. Text inserted at a position takes the style of the tokens enclosing it.
- **Raw selections** (raw mode) map to visible ranges: an endpoint inside an opening marker or a
  heading prefix moves to the first visible character of what follows; an endpoint inside a closing
  marker moves to just after the last visible character before it. A selection covering only syntax
  has no target.

**`serialize(model) → string`**: runs of equal `(color, b, u)` become `=={opts}…==` (options written
color, `b`, `u`); inside a run, characters of the same link become `[…](url)`, or stay bare for
`form: "bare"`; otherwise runs of `code` become `` `…` ``. **Tokens the operation didn't touch are
copied byte-for-byte**, and runs are only merged where the operation created them: untouched tokens
are never merged, split or rewritten in canonical form.

**`verify`**: the result is checked twice before it's used.

1. **Line**: re-parse the line and rebuild its model. Visible characters, styles, link URLs and
   forms, and link extents must all match what the operation intended. A link or bare URL may only
   be split where the operation split it, and a bare URL must stay recognized: this catches
   `see=={b}https://u.com==` losing its link when the bold is removed.
2. **Document**: run `parseDoc` on the resulting document (O(lines), cheap) and compare line
   kinds. Lines outside the edit keep their kinds and block pairings, and edited lines get exactly
   the kinds the operation intended. This catches a stripped `` `![](a7p2xq9d.png)` `` becoming a
   screenshot, or a wrapped line that starts with ```` ``` ```` closing a new block early.

**When verification fails**: a **formatting** operation is refused, all-or-nothing across every line
it touches. The selection stays, and the popup's hint line says "Can't apply that here" (§12,
item 1). An **edit** is never refused. §7.7 says what happens instead.

**`diff(old, new) → { from, to, insert }`**: the smallest single change (common prefix and suffix).
Every rewrite reaches the editor as this minimal change, so CodeMirror maps the cursor and undo
groups with as little disturbance as possible.

### 6.4 Operations (`ops.ts`)

All pure: `(document, target, …) → new text + new selection`, or a refusal.

**Target** (README §3.6): a non-empty selection is its visible range, per line. With nothing
selected and the formatting bar pinned, the target is the **word at the cursor** (the maximal run of
letters, digits and `_` around it), and the cursor ends at the end of that word afterwards. Section
targets the first non-empty selected line, or the cursor's line. No target → hint "Select some text
first", and nothing changes.

- **B / U**: add to every target character if any lacks it, else remove from all. On part of a link,
  the link is split into adjacent links to the same address (§13).
- **A swatch**: set that color on the target, or remove it if every target character already has it.
  **Remove color**: remove the color, keep bold and underline. **Clear formatting**: remove color,
  bold, underline and inline code; links stay.
- **On a heading's text** (README §3.6): a swatch recolors the section (`## {color}`), and strips
  highlight colors inside the heading; picking the section's current color does nothing. Remove
  color strips highlight colors inside the heading and leaves the section color. Clear formatting
  strips bold, underline, code and colors inside the heading and leaves the section color. A heading
  always keeps a color.
- **`</>`**, in this order:
  1. if the selection touches a code block (any of its lines, fences included, and even within one
     line), remove the fences of every block it touches;
  2. otherwise, within one line, toggle inline code on the selected characters that aren't link
     text (link text is plain; links stay as they are);
  3. otherwise, wrap the touched lines in fences. Their inline syntax and heading prefixes are
     removed (code is literal); screenshot lines become literal text. Refused if a touched line
     itself starts with ```` ``` ````, because it would close the new block.
- **Link**: the browser prompt. `example.org` becomes `https://example.org`. The address must be
  something the parser recognizes as a link URL, else the hint says "That isn't a web address".
  - On a `[text](url)` link, the prompt shows its address; an empty answer removes the link and
    keeps the text.
  - On a bare URL, the prompt shows it. A new address replaces the URL text (the text *is* the
    address). An empty answer is refused ("Can't apply that here"), because a bare URL can't be
    unlinked without an escape character.
- **Section**: a plain line gets `## {blue-deep} ` (leading spaces removed); a heading loses its
  prefix. On an empty line → "Select some text first".
- **`formatState`**: which buttons are on, which swatch is ringed and which are disabled. Link is
  on for bare URLs too. A heading's characters count as having the section's color. Inside a code
  block, everything but `</>` is disabled.
- **Edit ops** used by render mode (§7.7): delete a visible range, insert text at a position, split
  a line at a position (Enter), join two lines.

### 6.5 Derived text (`text.ts`)

- `stripInline(line)`: the visible text of one line.
- `visibleText(text)`: what render mode shows. Heading prefixes, highlight syntax, link syntax and
  URL, fence lines and screenshot lines are removed; code content is kept. Used for search.
- `noteTitle(text)`: the first line's visible text, trimmed, without its heading prefix. A first line
  that is the opening fence of a *closed* block, or a screenshot, has no visible text, so the note
  is "Untitled" (§13). An unclosed fence is plain text, so its title is the literal text.

## 7. Client

### 7.1 State and actions

- `state.ts` holds one `AppState`:
  `{ user, view: { trash, tag, query }, notes, tags, open: { summary, savedDoc } | null, loading, save: "saved" | "unsaved" | "saving" | "failed", prefs: { mode, font, sidebar }, ui: { drawer, formatBar } }`,
  with `get()`, `update(fn)` and `subscribe(fn)`.
- **Only `actions.ts` changes state.** UI components render from state and call actions. An action
  is: ask (unsaved changes, confirmations), call the API, update state, then refresh the list.
- After any change, the list and the tag counts are **re-fetched** rather than patched locally, so
  the server stays the single source of truth. Every list request carries a sequence number, and a
  response older than the newest one applied is dropped, so typing fast in the search box can't show
  stale results.
- **Opening a note** is serialized the same way: each open gets a sequence number and only the
  newest is applied. While a different note is loading, the editor is read-only, so nothing typed
  in the old note can be lost when the new one replaces it.
- **Tags** save immediately through a per-note queue, so quick changes reach the server in order.
  Each request sends the whole tag list and carries its note id. A response is applied only if that
  note is still open, and the queue is drained before the app leaves the note.
- **Tag filter options** are the server's tags, plus the selected tag with a count of 0 if the
  server no longer returns it, until another filter is picked (README §3.13). **New note** sends the
  selected filter tag (README §3.1). **Tag suggestions** are ordered on the client as README §3.13
  says: tags starting with the typed text first, then by count, then alphabetically, at most 8, with
  "Add new tag …" last when the text isn't an existing tag.
- Components (`ui/*`) each own one DOM subtree and re-render it when their slice of state changes.
  All user data is inserted with `textContent` and attributes, never `innerHTML`.
- `prefs.ts`: `margin:mode`, `margin:font`, `margin:sidebar`, `margin:collapsed:<noteId>`.
- Global keys (Ctrl/Cmd+S, Ctrl/Cmd+E) are bound in `app.ts` and call actions.

### 7.2 API client and login

`api.ts` wraps `fetch`: JSON in and out, the `X-Margin: 1` header on writes, and errors turned into
toasts. On **401** it reloads the page (showing the login page at the same address) unless the open
note has unsaved changes, in which case it shows an error and doesn't reload, so the text can be
copied first (README §3.18). `login.ts` posts the form and, on success, **reloads the current
URL**, query included, so the user lands on the link they opened (README §3.17).

### 7.3 Address bar

`url.ts` derives the URL from state (`?note=`, else `?tag=`, else `/`) and writes it with
`history.replaceState` after every state change. At boot it reads it once. `?note=` opens the note
(the server has already returned 404 for one that doesn't exist); a trashed note opens read-only with
the trash list shown (§13). `?tag=` sets the filter.

### 7.4 Saving

- `dirty = !view.state.doc.eq(savedDoc)`, recomputed on document changes only. `savedDoc` is a
  CodeMirror `Text`, so undoing back to the saved text makes the note clean again.
- **Save** sends a snapshot of the current document. On success, `savedDoc` becomes that snapshot
  (not the current text, which may have changed during the request), and the state becomes `saved`
  or `unsaved` accordingly. On failure, `failed`.
- One save in flight per note: Ctrl+S during a save sets a flag, and one more save, with a fresh
  snapshot, runs when the current one finishes.
- **Before switching notes, creating, going home or logging out**, the action waits for an
  in-flight save, then asks "You have unsaved changes. Discard them?" if still dirty (README §3.2).
- **Trash** has its own single confirmation (README §3.16): `Move "<title>" to the trash?`, plus
  "Your unsaved changes will be lost." when dirty. The generic discard question isn't asked as well.
- `beforeunload` asks the browser to confirm while dirty.

### 7.5 UI

Sidebar, note cards, tag filter, search (200 ms debounce), menu bar, save button, switches, tag
chips, tag box and suggestions, trash banner, empty state, toasts and phone drawer: each is a
component built to README §3 and §4. Icons are SVG `<symbol>`s in `index.html`. Colors come from
the palette classes (§6.1). Confirmations and the Link prompt use the browser's own dialogs
(README §3.21).

### 7.6 Editor (`editor/`)

One `EditorView` for the app's lifetime. Opening a note installs a **new `EditorState`**, which
resets undo history (README §3.7), with the note id in a facet.

**Keys.** CodeMirror's `standardKeymap` (arrows, Home/End, Page Up/Down, word and line-boundary
deletion, select all; on macOS also the standard Emacs-style keys) plus `historyKeymap`, Margin's
own keys (README §3.20), and in raw mode Enter as a plain `insertNewline`. **Not** `defaultKeymap`:
its extra bindings (move or copy a line, delete a line, toggle comments, and more) aren't in the
README, and Enter in it copies the previous line's indentation (§13).

Other extensions, always on: `history`, `drawSelection`, line wrapping, the **analysis field**, the
collapsed field, the end-of-file marker, Tab in code, the popup, link handling, paste and copy,
spellcheck (§13), an update listener (dirty state, collapse persistence, link chip), and two
compartments:

- **mode**: render = render field, atomic ranges, caret rules, guard, class `mode-render`; raw =
  class `mode-raw`. Switching reconfigures this compartment only, so the document, the selection and
  undo history carry over. Entering render mode dispatches the caret rules once (§7.7), so a raw-mode
  cursor inside syntax is moved out.
- **read-only** (trashed notes, and while another note loads): `EditorState.readOnly` and
  `EditorView.editable` false.

**Two fields, so a cursor move doesn't re-parse:**

| Field | Recomputed when | Holds |
|---|---|---|
| `analysis` (both modes) | the document changes | the `parseDoc` result and each line's inline tokens. Used by render, caret rules, guard, popup, links and Tab. |
| `render` (render mode) | analysis changes, the collapsed set changes, or a caret enters or leaves a fence line | decorations, the **hidden ranges** and the atomic ranges built from them |

**Hidden ranges, and so atomic ranges, are the hidden syntax pieces only**: an opening `=={…}`, a
closing `==`, a backtick, `[` and `](url)`, a heading prefix (replaced by the fold toggle), a hidden
fence line's text, a whole screenshot line, a collapsed section's content. Never a whole token, so
→ walks through visible text one character at a time. CodeMirror stops carets at the edges of an
atomic range, never inside one. A caret at either end of a fence line counts as being on that line,
so a hidden fence is reachable from the keyboard, and it reveals itself as soon as the caret lands.

**Decorations** follow README §3.8–§3.12 and §4:
- the title line gets a class;
- a heading prefix becomes the fold widget (⌄), the heading text is drawn in the dark shade, and
  highlight colors inside it are suppressed;
- content lines get a section-color class (the bar is a `::before`);
- a collapsed section is one replace decoration from the end of its heading line to the end of the
  section, showing the ⋯ widget, provided from a `StateField`. That's the same mechanism as
  CodeMirror's own folding, a non-block replace that spans line breaks; a browser test confirms it
  early (§9);
- fences are hidden unless a caret is on them, with the Copy widget on the opening fence;
- a screenshot line becomes an image widget. It re-measures the editor when the image loads, and
  shows *Missing screenshot* in italics if the image fails to load;
- highlight, code and link marks, with links titled "`<url>` · Ctrl+click to open" ("Cmd+click" on
  a Mac);
- the end-of-file marker, a block widget at the document end, in both modes.

**Collapsed sections.** A `StateField<Set<string>>` of heading-line texts, changed by a
`toggleSection` effect, loaded from and saved to `margin:collapsed:<noteId>`. It isn't part of the
document, so collapsing never makes a note unsaved. When a collapsed heading's own text is edited,
its entry follows the new text. Any edit that touches a collapsed section's hidden content or its
edges expands that section first (§13), as CodeMirror's own folding does.

### 7.7 Render-mode editing (`caret.ts`, `guard.ts`)

README §3.7, built on the line model. Three parts.

**1. Caret rules.** A transaction filter that runs on every transaction, including mode switches,
undo and programmatic selections:
- a caret strictly inside hidden syntax moves to its nearest edge; a range's endpoints move
  outward;
- a caret placed by the pointer, by vertical motion or by Home/End at the *outer* edge of a closing
  marker (of a highlight, inline code or link) moves to its inner edge. So typing at the end of a
  highlighted word extends it, and "→ once more" (README §3.7) is the only way to step out;
- a caret at the very start of a heading line moves to the start of the heading text, after the
  prefix. (Otherwise typing there would break the heading.)

**2. Intent commands.** A highest-precedence keymap implementing README §3.7 with the line-model
edit ops: Backspace, Delete and Enter, including the heading, screenshot, code and join rules.
Deletions step by grapheme cluster. These keys reach the keymap on desktop and iOS. On Android,
CodeMirror only re-dispatches some deletions as key events (when the DOM change is exactly one
character before the cursor), so part 3 must produce the same results on its own.

**3. Invariant filter.** A transaction filter on every user transaction in render mode except
Margin's own (which carry a `bypass` annotation). For each change:

- a. A **single-line insertion into visible text** passes through untouched: typing, IME,
  autocorrect. Its style follows the caret's enclosing tokens.
- b. An **insertion containing a line break, or pasted text containing syntax**, splits the
  enclosing highlight, code and link at that point (as Enter does) and inserts the raw text between
  the halves. Pasted formatting is therefore interpreted, not shown as literal characters.
- c. **Edges.** Text inserted at a screenshot line's edge goes on a new line before or after it. Any
  change touching a collapsed section expands it first.
- d. **Deletions and replacements** are recomputed through the line model. The visible characters in
  the range are removed, hidden syntax that is only partly covered stays, and inserted text follows
  rules a–b. Tokens left with no visible characters disappear, even when the change touched no hidden
  syntax (cutting exactly a word's visible text, Android deletions, word deletion). A heading whose
  text becomes empty becomes an empty line (README §3.7).
- e. A **deletion that removes hidden syntax but no visible character**, such as CodeMirror's
  delete commands skipping over an atomic marker, or an Android DOM change beside one, is
  reinterpreted as deleting one visible grapheme in that direction, with the §3.7 rules.
- f. **Multi-line deletions** are split at protected lines. A fence line whose partner fence lies
  outside the range is kept, and screenshot lines are whole. Within each part, fully covered lines
  are deleted, and the partial first and last lines are joined; the joined line keeps the first
  line's kind. Nothing is joined across a kept fence. Code lines inside a block whose fences are
  kept lose only their selected text, or disappear if fully covered (§12, items 2 and 3).
- g. **Composition** (`input.type.compose`, or while the view is composing): changes pass through
  untouched, so the input method's session is never interrupted. When the composition ends, the
  touched lines get one repair pass with rules d and f, as a `bypass` transaction.
- h. **Output.** The result is verified (§6.3) and applied as a minimal change that keeps the
  original transaction's user event and annotations, so undo grouping and `isUserEvent` checks keep
  working.

**When an edit's result fails verification**: a join that can't keep both lines intact doesn't
happen; the cursor moves to the end of the previous line (README §3.7's own rule). Any other edit is
applied as the user's raw change. An edit is never silently dropped.

### 7.8 Formatting popup and bar (`popup.ts`)

A view plugin that owns one DOM element, built from `formatState` (§6.4) on every selection change.

- **Visible** (README §3.6) when the editor is focused, no mouse button is held (it waits for
  mouseup), the target is non-empty or the bar is pinned, the note isn't read-only, and Esc hasn't
  hidden it for this selection (a new selection brings it back). The bar opens and closes as README
  §3.6 says.
- **Hint line**: "Enter applies · Esc closes" by default, or "Select some text first", "That isn't a
  web address" or "Can't apply that here".
- **Placement**: under the selection end (flipped above if there's no room, clamped to the window);
  pinned under the palette button; or **docked** at the bottom. Docked placement is used on screens
  760 px wide or less, or when the selection was made by touch (the last `pointerdown` was `touch`
  or `pen`). So a touchscreen laptop docks for a finger and floats for a mouse.
- **Above the keyboard**: listens to `visualViewport` `resize` and `scroll` and sets
  `bottom = innerHeight − (offsetTop + height)` plus 8 px.
- **Buttons** act on `pointerdown` and `mousedown` with `preventDefault`, so the editor keeps focus
  and selection, with touch too. The popup's keymap has the highest precedence and only takes keys
  while the popup is visible (and not pinned with an empty selection, when the arrows and Enter keep
  working in the note).
- Works in both modes; raw selections map to targets as §6.3 says.

### 7.9 Links, paste, copy

- **Ctrl/Cmd+click** hit-tests the analysis tokens at the click position, so it works in raw mode
  too, and opens the URL with `noopener,noreferrer`. A class on the editor while Ctrl/Cmd is held
  gives links the pointer cursor and solid underline. When a touch places the caret in a link, a chip
  above it shows the address, and tapping the chip opens it.
- **Paste**:
  - If the clipboard holds a file, take the first one. Anything but a PNG shows "Only PNG screenshots
    are allowed".
  - A PNG uploads (toast "Uploading screenshot…"). At paste time, the note id and the paste position
    are recorded, and the position is mapped through later edits. When the upload finishes,
    `![](name.png)` is inserted on its own line only if that note is still open and editable. The
    line goes through the line model, so a highlight or link around the position is split, as Enter
    does. A position inside a code block puts the line after the block (§13). If the note was closed,
    nothing is inserted, and the PNG stays in the note's folder, like any screenshot whose line was
    deleted.
  - A URL pasted over a one-line selection becomes a link.
  - Text follows §7.7 3a–3b.
- **Copy and cut** in render mode (§12, item 4): the selected visible text of a partial line is
  written as balanced syntax, so selecting "rist" in a green highlight copies `=={green}rist==`.
  Whole lines are copied raw. Raw mode copies the raw selection as it is. The code-block Copy button
  uses `navigator.clipboard` when available, and a hidden-textarea fallback over plain HTTP.

### 7.10 Phones and touch

CSS breakpoint at 760 px: drawer sidebar, two-row menu bar, 16 px text and inputs, `100dvh`,
safe-area insets. `(any-pointer: coarse)` keeps code-block Copy buttons visible. Docking and the
link chip follow the input actually used (§7.8, §7.9). All of it per README §3.19.

## 8. Performance

- **Keystroke**: re-parse the document (an O(lines) block scan plus the inline parse of each line) and
  rebuild decorations. Target: under 8 ms per keystroke on a 2,000-line note, measured by a benchmark
  in `test/unit`. If it's missed, the first steps are a per-line inline-token cache, then limiting
  decorations to the visible ranges.
- **Cursor movement** re-runs neither the parser nor, unless a caret enters or leaves a fence line, the
  decoration build.
- **Server**: listings read every note (README §7 accepts this). The server tests measure 2,000 notes,
  target under 150 ms.

## 9. Testing

- **Unit** (`node --test`, TypeScript run directly):
  - the grammar, rule by rule, with negative cases for every "stays literal" rule in README §3.5 and
    the §6.2 worked examples;
  - line-model round trips over a table of cases and randomly generated lines: parse → model →
    serialize → parse gives the same model, and untouched tokens are byte-identical;
  - **every refusal**: a table of URL, backtick and `==` adjacencies, so each case where a
    formatting op says "Can't apply that here" is known and listed;
  - every row of README §3.6 and every rule of README §3.7, run on a headless `EditorState` through
    **each input path**: the keymap, `input.type` deletions shaped like Android's, `delete.cut`,
    `move.drop`, `input.paste`, composition, and word deletion;
  - caret rules after a mode switch and after undo; CRLF input; titles, `visibleText`, colors,
    validators.
- **Server** (`node --test`): starts the server in-process on **port 0** with a temporary `DATA_DIR`,
  then covers every route and error code, the `GET /` 404 rules, sliding expiry, `add` then login with
  no restart, removing and re-adding the same name, concurrent save + tag change, two concurrent CLI
  `add`s, the session write queue, the login queue limit, the `Secure` flag with and without
  `X-Forwarded-Proto: https`, `doctor` on a data folder seeded with each kind of problem (and an
  unchanged folder afterwards), and a 2,000-note listing benchmark. The CLI runs as a child process
  with `MARGIN_PASSWORD`.
- **Browser** (Playwright, Chromium; desktop, and iPhone 12 Pro size with touch):
  - log in through a `?note=` link;
  - create, edit, save, and the unsaved prompts;
  - typing at highlight edges and clicking at the end of a highlighted word;
  - collapsed sections render and toggle (this confirms the multi-line replace early);
  - popup keyboard navigation and the word-at-cursor bar;
  - PNG paste, including switching notes during an upload;
  - copy and paste between notes, trash flows, 404 pages, the drawer.
- Every test uses its own port and temporary directory, and only stops processes it started.
- **Not covered by automation**: a real phone keyboard (README §7). The composition test replays
  events; a real-device check stays on the release checklist.

## 10. Build, development and deployment

- `package.json`: `"type": "module"`. Scripts:
  - `start`: `node src/server/main.ts`;
  - `watch`: esbuild in watch mode into `dist/public/`;
  - `build`: one-off build (`scripts/build.ts`);
  - `dev`: `watch` plus `node --watch src/server/main.ts`;
  - `test`, `test:e2e`, `check` (`tsc --noEmit`).
- README §2 development commands work as written: `npm install`, `npm run watch`,
  `DATA_DIR=./dev-data PORT=5556 npm start`, and `MARGIN_PASSWORD=secret DATA_DIR=./dev-data node cli.js add dev`.
- The build bundles `src/client/app.ts` and `login.ts` (ESM, minified, source maps) and the CSS,
  including the generated palette, and copies `src/public/` into `dist/public/`.
- **Dockerfile**, two stages on `node:26-alpine`:
  1. `npm ci` and `npm run build`;
  2. copy `package.json`, `src/` (server, shared, cli), `bin/margin-user` and `dist/public/`. There are
     no runtime dependencies, so this stage has no `node_modules`. It sets
     `ENV NODE_ENV=production DATA_DIR=/data PORT=5555` and runs `CMD ["node", "src/server/main.ts"]`.
- **compose.yaml**: service `margin`, `restart: unless-stopped`, port `5555:5555`, volume
  `./data:/data`, user `${MARGIN_UID:-1000}:${MARGIN_GID:-1000}`.
- **Data directory**: the repo contains `data/.gitkeep` (`.gitignore` has `data/*` and
  `!data/.gitkeep`), so `git clone` creates `./data` owned by the user who cloned it. Docker then
  doesn't create it as root, and the README §2 install commands work unchanged. If the folder still
  isn't writable, the server exits with a message saying so (§5.1).

## 11. Comparison with the original's architecture (README §5)

| Area | Original | This design | Why |
|---|---|---|---|
| Server | Express 5 | `node:http`, zero runtime dependencies | Small fixed surface; nothing to update. |
| Language | JavaScript | TypeScript, run directly by Node | Types across the shared parser and both sides, no server build step. |
| Editor | CodeMirror 6 | CodeMirror 6 (same) | Raw text plus decorations is the right fit (§2). |
| Render-mode edits | a change filter that keeps hidden pieces, a filter that removes emptied tokens, key handlers | intent commands plus one invariant filter over a styled-character line model; results verified at line and document level | Every input path gets the same guarantees; fixes the README §7 heading-break limitation. |
| Keymap | CodeMirror's default keymap | the standard keymap only | No unlisted shortcuts (§13). |
| Parse on keystroke | whole note; decorations also rebuilt on selection changes | whole note; decorations rebuilt only when a caret crosses a fence line | Cheaper cursor movement. |
| Listing | reads every note per request | same, measured | README §7 accepts it; no cache to go stale. |
| Concurrent writes | none mentioned | per-note lock; per-file write queue; CLI lock file | No lost `meta.json`, session or user updates. |
| Sessions | plain tokens; removal ends sessions | hashed tokens; sessions bound to a per-user random id | A data-folder copy can't log anyone in; remove-then-re-add can't revive old sessions. |
| Forgery | `SameSite=Lax` | plus a required custom header, plus CSP | Lax doesn't cover other services on the same host. |
| Password cost | scrypt N = 2^14 | scrypt N = 2^15, r = 8, p = 3 (OWASP), explicit `maxmem`, bounded queue | Stronger; memory stays bounded. |
| Asset caching | not specified | ETag + `no-cache` | An update is never hidden by a stale cached bundle. |
| Tests | none | unit, server, browser | — |

## 12. Changes a user could notice (approved by the owner)

None of these adds a feature. Each changes an edge case where the original's behavior is a listed
limitation, or where the README promises something the original's approach didn't deliver. The
owner approved all four on 2026-10-25.

1. **A formatting action that can't be written down safely does nothing, and says so.** The hint
   line shows "Can't apply that here", where the original would produce text that renders
   differently from what was asked (README §7: "an unmatched backtick next to new inline code can pair
   up unexpectedly"). The cases, all enumerated by unit tests (§9):
   - formatting *part* of a bare URL (the URL would swallow the `==` markers);
   - inline code next to a stray backtick;
   - unlinking a bare URL;
   - wrapping lines that contain a fence line;
   - any other result that fails verification.

   Edits (typing, deleting, Enter) are never refused.
2. **Deleting a selection that runs from ordinary text into a heading no longer breaks the heading**
   into visible raw syntax (README §7). The joined line keeps the first line's kind, so the rest of
   the heading's text becomes ordinary text, like a paragraph merge in a word processor.
3. **Deleting a selection that covers only one fence of a code block keeps both fences**, and only
   the selected code text goes. `</>` still removes a block's fences as README §3.6 says, and fences
   can still be edited directly when the caret is on them.
4. **Copying part of a formatted word keeps its formatting.** README §3.7 says copying keeps
   formatting when pasting into another note. Copying the raw text under a selection does that only
   when the selection happens to include the hidden markers, which a double-click doesn't. So render
   mode copies partial lines as balanced syntax (§7.9). The difference shows when pasting into
   another app: copying "rist" from a green highlight pastes as `=={green}rist==`. Whole lines were
   already copied with their syntax.

## 13. Gaps in the README, and the default taken

The owner confirmed every default below on 2026-10-25.

| Question | Default |
|---|---|
| Does the formatting popup work in raw mode? | Yes; the README doesn't limit it. Raw selections map to targets per §6.3. |
| Does `margin-user passwd` end the user's other sessions? | No; the README says only *remove* does. |
| Title of a note whose first line is a (closed) fence or a screenshot? | "Untitled": that line shows no text. |
| Pasting several files at once? | The first file is used. |
| Ctrl+S while a save is in flight? | One more save runs after it. |
| Unknown `/api/…` path? | JSON 404 instead of the 404 page (no user ever sees it). |
| An opening fence line with more backticks or other text after the first three? | Opens a block: README §3.5 says an opening line *starts with* three backticks and anything after is ignored. |
| Bold, underline or color on part of a link? | The link becomes adjacent links to the same address; they look and act as one. |
| Typing at the end of inline code or link text? | Extends it, the same as a highlight (README §3.7 describes highlights only). |
| Editing at or inside a collapsed section? | The section expands first. |
| Screenshot pasted while the caret is in a code block? | Inserted after the block (inside it, it would be literal text). |
| New address for a bare URL? | Replaces the URL text. |
| Opening a trashed note from a link? | Read-only with the trash list shown, so Restore "returns to the normal list" (README §3.16). |
| Spellcheck in notes? | On, with autocorrect and autocapitalize off (as the original did). |
| Keyboard shortcuts beyond README §3.20? | Only standard text editing (motion, selection, word and line deletion, select all). Enter doesn't auto-indent. |
| Logging in while the server is at its login-queue limit (a flood)? | 503 at once instead of a slow wait. |

## 14. Risks

- **Input methods.** The filter lets composition through untouched and repairs afterwards. A
  composition that crosses hidden syntax could still leave a line needing that repair. Touch
  behavior can't be fully tested without a real device (README §7).
- **Refusals.** The set of formatting actions that are refused is enumerated by tests, not by
  argument. A surprising entry in that table goes to the owner before release.
- **Android deletions.** Reinterpreting DOM deletions beside hidden markers (§7.7 3e) depends on how
  each keyboard reports them. The unit tests replay the shapes CodeMirror documents; real devices may
  differ.
- **Decoration rebuild cost on very long notes.** Measured (§8), with two fallbacks ready.
- **No framework in the UI.** Re-render discipline is by convention, kept manageable by one store and
  actions-only state changes (§7.1).

## 15. Features beyond the README (owner decisions)

From the reviewers' suggestions, the owner approved two on 2026-10-25:

| Feature | Where |
|---|---|
| The session cookie is marked `Secure` behind an HTTPS proxy (`X-Forwarded-Proto: https`) | §5.8 |
| `margin-user doctor`, a read-only check of the data folder | §5.9 |

Declined, and so not built: ending other sessions on `margin-user passwd`, rate-limiting failed
logins, conflict detection on save, a "delete unused screenshots" action, and a switch that turns
off render-mode protection for long notes.
