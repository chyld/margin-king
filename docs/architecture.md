# Margin: architecture

Status: **draft for review**. Nothing is built yet.

This document says how Margin will be built. *What* Margin does is defined by the original README,
copied verbatim to [`original-readme.md`](original-readme.md) (from `chyld/note-mvp` at
`7a53085`). Section numbers written as "README §x" point into that file.

## 0. Scope

- **Requirements** are README §2 (running), §3 (features), §4 (design), §6 (decisions) and §7
  (accepted limitations). The app must behave and look as those sections say.
- **README §5** describes how the original was built. This design is independent of it. Where it
  arrives at the same choice, §11 says why; where it differs, §11 says why too.
- **No new features.** Anything in this design that a user could notice and that the README doesn't
  ask for is listed in §12 and needs the owner's approval. Gaps where the README is silent, with
  the default this design takes, are in §13.

## 1. Principles

1. **The raw text is the note.** The editor's document is always exactly the bytes saved to
   `note.md`. Render mode is a view over that text. Raw mode is the same document with the view
   switched off.
2. **One model for formatting and structural edits.** A line is turned into a list of *styled
   visible characters* (§6.3). The formatting popup and the render-mode editing rules (Backspace,
   Delete, Enter, edits across hidden syntax) are pure operations on that list. The result is
   serialized back to syntax, **re-parsed and checked** before it reaches the editor.
3. **Pure core, thin shells.** Parsing, the line model, all operations, titles and search text live
   in `src/shared/` as pure functions with no DOM and no I/O. The server and the client both import
   them. They are unit-tested without a browser.
4. **Few dependencies.** The server has **zero runtime dependencies** (Node built-ins only). The
   client depends only on CodeMirror 6.
5. **Writes are atomic and serialized.** Every file write is write-temp-then-rename. All mutations
   of one note go through a per-note lock.
6. **Tested from the start.** Unit, server-integration and browser tests (§9).

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 26** (Docker `node:26-alpine`; it becomes LTS this month). Code also runs on Node 24 LTS. | Same language as the client, so the parser is shared (principle 3). |
| Language | **TypeScript**, strict, *erasable syntax only* (no enums, namespaces or parameter properties), `.ts` import specifiers | Node runs it directly (type stripping), so the server, the CLI and the tests need **no build step**. `tsc --noEmit` type-checks. |
| HTTP | `node:http` plus a ~150-line router and helpers (`src/server/http.ts`) | The surface is ~15 routes and a fixed set of static files. No framework to update or audit. |
| Passwords | `node:crypto` scrypt | Built in; no native modules. |
| Editor | **CodeMirror 6** (`@codemirror/state`, `view`, `commands`) | Its document is plain text with decorations, atomic ranges and transaction filters on top: an exact fit for principle 1. ProseMirror and Lexical keep a rich-text tree, which would need a lossless two-way mapping to raw text with no escape character. |
| UI | Plain TypeScript and DOM, no framework | The UI is small and the editor is CodeMirror anyway. A small store (§7.1) plus components that own their DOM subtree. |
| Client build | **esbuild**: two bundles (`app`, `login`) plus one CSS file | Fast and simple. |
| Tests | `node:test` (unit, server); **Playwright** (browser) | Built in, plus the standard browser runner. |

Dev dependencies: `typescript`, `esbuild`, `@types/node`, `@playwright/test`.

## 3. Repository layout

```
compose.yaml  Dockerfile  .dockerignore  package.json  tsconfig.json
bin/margin-user                 sh wrapper: exec node /app/src/cli/margin-user.ts "$@"
scripts/build.ts                esbuild bundles + palette.css + copies public/ → dist/public/
src/
  shared/                       pure, no DOM, no I/O; imported by server and client
    palette.ts                  the 12 hues × light/deep, color names
    colors.ts                   dark shade (HSL), tag-name hash → hue
    syntax.ts                   parseDoc (lines, code blocks, sections), parseInline (tokens)
    model.ts                    styled-character line model: toModel, serialize, verify
    ops.ts                      formatting ops and edit ops on line models
    text.ts                     stripInline, visibleText, noteTitle
    rules.ts                    validators: username, tag, note id, image name, URL normalize
  server/
    main.ts                     config from env, start, signal handling
    http.ts                     router, JSON body, cookies, static files, errors, headers
    pages.ts                    GET / → login / app / 404
    api.ts                      the JSON API
    store.ts                    notes on disk, per-note locks, stat-validated cache
    fsx.ts                      atomic write, exclusive create, keyed async locks
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
      guard.ts                  render-mode edit rules (transaction filter + keymap)
      codetab.ts                Tab / Shift+Tab in code blocks (both modes)
      collapse.ts               collapsed-sections field + persistence
      popup.ts                  formatting popup / bar
      links.ts  paste.ts        Ctrl/Cmd+click, link chip, modifier tracking; paste
    styles/*.css
  public/                       index.html, login.html, 404.html, favicon.svg
test/
  unit/  server/  e2e/
docs/
```

## 4. Data on disk

```
$DATA_DIR/
  users.json                    written only by the CLI
  sessions.json                 written only by the server
  notes/<username>/<noteId>/
    note.md                     the raw text, byte-for-byte what raw mode shows
    meta.json                   { created, modified, tags, trashedAt }
    <imageId>.png               pasted screenshots
```

- The note-folder layout and the `meta.json` fields match the original (README §5.3), so notes can
  be copied between the two. `users.json` and `sessions.json` do not match (below).
- **One writer per file.** The CLI only writes `users.json`. The server only writes
  `sessions.json` and `notes/`. No file is written by two processes, so no cross-process locking is
  needed.
- `users.json`:
  `{ "alice": { "salt": "<hex 16 B>", "hash": "<hex 64 B>", "N": 131072, "r": 8, "p": 1, "created": "<ISO>" } }`.
  The scrypt cost is stored per user so it can be raised later without breaking old hashes.
- `sessions.json`: `{ "<sha256(token) hex>": { "user", "userCreated", "expires", "renewed" } }`. Only
  the **hash** of the token is stored, so a copy of the data folder can't be used to log in.
- A note folder is valid if `meta.json` parses. A folder without it (a crash during creation) is
  skipped and logged, never shown.
- IDs (notes and images): 8 characters of `a-z0-9` from `crypto.randomInt(36)` (unbiased). Notes
  are created with a non-recursive `mkdir`, so an id collision fails with `EEXIST` and a new id is
  drawn. Images are created with exclusive open (`wx`).

## 5. Server

### 5.1 Process and configuration

- One Node process: `node src/server/main.ts`. Environment: `DATA_DIR` (default `./data`), `PORT`
  (default `5555`), `HOST` (default `0.0.0.0`).
- On start: create `$DATA_DIR/notes`, load `users.json` and `sessions.json`, drop expired sessions,
  load `dist/public/` into memory, listen.
- On `SIGTERM` / `SIGINT`: stop accepting connections, flush `sessions.json`, exit. (Node is PID 1
  in the container, so these handlers are required for `docker compose down` to be quick.)

### 5.2 Request pipeline

1. Parse the URL. Set the security headers (5.3) on every response.
2. Resolve the session from the `margin_session` cookie (5.8). Renew it if due.
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

Invisible to users (§12 lists nothing here):

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`.
  (`'unsafe-inline'` for styles because CodeMirror injects its own style sheet.)
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Every non-GET `/api` request must carry the header `X-Margin: 1`.** A page on another origin
  can only send a custom header after a CORS preflight, which this server never approves, so
  cross-origin form posts and fetches can't act on a user's session. This matters because
  `SameSite=Lax` doesn't protect against other services on the same host (a different port on the
  same IP is "same-site"). A header check also works unchanged behind a TLS proxy, unlike an
  `Origin`/`Host` comparison, which breaks when a proxy rewrites `Host`.
- External links open with `noopener,noreferrer`.

### 5.4 Pages and static files

- At startup every file in `dist/public/` is read into memory with its content type and an ETag.
  This set is the allowlist; nothing else is served. Responses have `Cache-Control: no-cache` and
  answer `If-None-Match` with 304, so a rebuilt image is picked up on the next load without asset
  hashing.
- `GET /favicon.ico` → the SVG favicon.
- `GET /` (the only page route), in this order:
  1. not logged in → `login.html`, status 200, same URL;
  2. any query parameter other than `note` or `tag`, both given, either given more than once, a
     `note` that isn't one of the user's notes (trashed counts as existing), or a `tag` that none of
     the user's non-trashed notes use → `404.html`, status 404;
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
and a tag change arriving together can't lose each other's `meta.json` update. (Only the server
writes notes, so an in-process lock is enough.)

**Atomic writes.** Write `<file>.tmp-<random>`, `fsync`, `rename`. Saving text writes `note.md`
first, then `meta.json`.

**Stat-validated cache.** Per user: `id → { stats of note.md and meta.json (mtime + size), Summary,
searchText }`.

- A listing reads the user's notes directory, `stat`s both files of every note (in parallel, at
  most 32 at a time), and re-reads only notes whose stats changed. Notes that vanished are dropped.
- The store's own writes update the cache directly.
- This keeps two things true: files changed on disk while Margin runs (for example a backup
  restore) still show up, as they would with a plain re-read; and a listing over a few thousand
  notes costs a few thousand `stat` calls, not a few thousand file reads and parses.

**Listing** (`GET /api/notes`): take non-trashed notes (or trashed ones with `trash=1`), keep those
with `tag` (if given), keep those whose `searchText` contains every term of `q` (lowercased, split
on whitespace, empty terms dropped). Sort newest first by `modified` (or `trashedAt` in the trash),
then by `id` so the order is stable.

**searchText** = `visibleText(text).toLowerCase()` (§6.5), computed when a note is read or saved.

**Uploads.** Check the note exists and isn't trashed. Pick a name, open `<name>.png.upload` with
`wx`, stream the request into it, checking the first 8 bytes against the PNG signature as they
arrive (abort, delete the temp file and send 415 on a mismatch). No size limit (README §3.11).
Then, under the note's lock, check again that the note still exists and isn't trashed, and rename
into place. The lock isn't held during the transfer, so a large upload doesn't block saves. If the
client disconnects mid-upload, the temp file is deleted.

**Delete forever / Empty trash.** Under the note's lock, remove the folder recursively (screenshots
included). Empty trash does this note by note and returns the count.

### 5.7 Users and passwords (`users.ts`)

- scrypt with N = 2^17, r = 8, p = 1 (OWASP's minimum), 16-byte random salt, 64-byte key,
  compared with `timingSafeEqual`. Unknown usernames are hashed against a fixed dummy record, so
  timing doesn't reveal which names exist.
- Each hash needs ~128 MB of memory, so at most **two** scrypt calls run at once (a small queue).
  This bounds memory if someone floods the login endpoint. It's invisible in normal use.
- The server keeps `users.json` in memory and re-reads it when its mtime or size changes (one
  `stat` per authenticated request), so CLI changes apply immediately.

### 5.8 Sessions (`sessions.ts`)

- Token: 32 random bytes, hex. Cookie:
  `margin_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`.
- Stored in memory keyed by `sha256(token)`, persisted to `sessions.json` 200 ms after a change
  (atomic write), and flushed on shutdown.
- **Valid** when it exists, hasn't expired, its user exists, and that user's `created` equals the
  session's `userCreated`. The last check means removing a user ends their sessions even if a user
  with the same name is added again before the server notices.
- **Sliding expiry**: when more than an hour has passed since `renewed`, set
  `expires = now + 30 days`, `renewed = now`, and re-send the cookie.
- Expired sessions, and sessions of users that no longer exist, are pruned on start, on every
  reload of `users.json`, and hourly.

### 5.9 CLI (`margin-user`)

`add <name>`, `passwd <name>`, `remove <name>`, `list`. Validates names
(`^[a-z0-9_-]{1,32}$`) and passwords (≥ 4 characters); reads the password twice with hidden input,
or once from `MARGIN_PASSWORD`. Writes `users.json` atomically with the same code the server reads
it with. `remove` leaves the user's notes on disk. Installed in the image as
`/usr/local/bin/margin-user`.

## 6. Shared core (`src/shared/`)

### 6.1 Palette and colors

- `palette.ts`: the 12 hues in README order, each `{ name, light, deep }`, and the 24 color names
  (`<hue>`, `<hue>-deep`).
- `colors.ts`: `darkShade(hex)` (HSL hue kept, saturation capped at 75 %, lightness 28 %) and
  `tagHue(name)` (README §4.4 hash, `% 12`).
- The build turns the palette into `palette.css`: one class per highlight color (`hl-<name>`,
  setting `--hl`), one per section color (`sec-<name>`, setting `--sec` and `--heading`), and one per
  tag hue (`hue-<0..11>`, setting `--light`, `--deep` and `--dark`). The DOM then carries **only
  class names, never inline colors**, and the colors are defined in one place.

### 6.2 Parser (`syntax.ts`)

The grammar is exactly README §3.5. Offsets are UTF-16 code units, like CodeMirror's.

**`parseDoc(text) → Doc`**: `lines`, `blocks` and `sections`.

1. **Code blocks.** Scan down. A line matching `` ^```[^`]*$ `` opens a block, which closes at the
   next line matching `` ^```\s*$ ``. Lines between are `code`. If no closing line follows, scanning
   for blocks stops and the rest is ordinary lines.
2. **Headings**, among lines not in a block: `^## \{(<color>)\} (?=\S)` with a known color. Each
   heading starts a section that runs to the line before the next heading, or to the last line.
3. **Screenshots**, among lines not in a block: `^!\[\]\(([a-z0-9]{8}\.png)\)$`.
4. Everything else is `text`.

Each line: `{ index, from, to, kind, block?, section?, heading?: { color, prefixLen }, image? }`.
The whole scan is O(lines) and cheap. Inline parsing is per line and is done lazily, with a cache
(below).

**`parseInline(lineText) → Token[]`**: left to right; at each position the first match wins:

1. `` ` `` → **code** up to the next backtick, with at least one character inside;
2. `[` → **link** `[text](url)`: text non-empty, no `]`; url is `https?://` followed by characters
   other than whitespace, `<>()[]` and backticks;
3. `h` → **bare URL**, if the previous character isn't a letter, digit or `/`; same character set;
   trailing `. , ; : ! ? ' " * _ ~ =` trimmed;
4. `=={` → **highlight**, if `{…}` holds valid options (at most one color, `b` and `u` at most once
   each, joined by `+`) and a closing `==` follows with at least one character between. The search
   for the closing `==` skips inline code and `[text](url)` links. Inside a highlight, code, links
   and bare URLs are parsed; highlights are not.
5. otherwise, move one character on.

Tokens carry `from/to` (with syntax) and `contentFrom/contentTo` (visible part), plus `opts`
(highlights) or `url` (links).

**Cache.** `parseInline` results are memoized by line text (an LRU of a few thousand entries).
Typing changes one line, so re-analysing after a keystroke re-tokenizes that line only.

### 6.3 Line model (`model.ts`)

The core idea of this design. A line (plain, or a heading's text after its prefix) becomes:

```ts
type Style = { color: string | null; b: boolean; u: boolean; code: boolean; link: string | null };
type VChar = { ch: string; style: Style; raw: number };  // raw: offset in the old line, -1 if new
type LineModel = { prefix: string; chars: VChar[] };      // prefix: "## {color} " or ""
```

Hidden syntax is gone. Bare URLs are plain characters (they're recognized again on re-parse).
Characters of a link have `link = url` and never `code` (link text is plain).

**`serialize(model) → string`**: group runs of equal `(color, b, u)` into `=={opts}…==` (options
written color, `b`, `u`); inside a run, group equal `link` into `[…](url)`, otherwise group `code`
into `` `…` ``. Two refinements:

- **Untouched tokens are copied byte-for-byte.** A token of the old line whose characters and
  styles the operation didn't change is emitted as its original text. An edit therefore never
  rewrites unrelated parts of the line (option order, adjacent highlights).
- **Verify.** The result is parsed again and turned back into a model. If its visible characters
  and styles differ from the intended model (there's no escape character, so a plain backtick
  next to new code, or a `==` next to a highlight, can pair up), serialization is retried without
  the byte-for-byte copying. If that also fails, the operation is **rejected** (§12, item 1).

**`diff(old, new) → { from, to, insert }`**: the smallest single change (common prefix and suffix).
Every rewrite reaches the editor as this minimal change, so CodeMirror maps the cursor, undo groups
and in-progress keyboard composition with as little disturbance as possible.

**Selections** map through the model: positions become visible-character indices before an
operation and raw offsets in the new text after it.

### 6.4 Operations (`ops.ts`)

All pure: `(line text(s), selection in visible indices, …) → new text + new selection`.

- **Formatting**: bold, underline (add to all if any selected character lacks it, else remove),
  set or remove color, clear formatting, inline code (one line), link set / edit / remove.
- **Line-level**: code across lines (wrap the lines in fences, dropping their inline formatting;
  or remove the fences of a block the selection touches); section (add `## {blue-deep} `, or remove
  a heading prefix). On a heading, a color recolors the section and strips highlight colors inside
  the heading text (README §3.6).
- **`formatState(selection)`**: which buttons are on and which swatch is ringed. A heading's
  characters count as having the section's color.
- **Edit ops** used by render mode (§7.7): delete a visible range, insert text with a given style,
  split a line at a visible index (Enter), join two lines (Backspace/Delete at a line edge).

### 6.5 Derived text (`text.ts`)

- `stripInline(line)`: the visible text of one line.
- `visibleText(text)`: what render mode shows: heading prefixes, highlight syntax, link syntax and
  URL, fence lines and screenshot lines removed; code content kept. Used for search.
- `noteTitle(text)`: the first line's visible text, trimmed, with its heading prefix removed. A
  first line that is a fence or a screenshot has no visible text, so the note is "Untitled" (§13).

## 7. Client

### 7.1 State and modules

- `state.ts` holds one `AppState`:
  `{ user, view: { trash, tag, query }, notes, tags, open: { summary, savedDoc } | null, save: "saved" | "unsaved" | "saving" | "failed", prefs: { mode, font, sidebar }, ui: { drawer, formatBar } }`,
  with `get()`, `update(fn)` and `subscribe(fn)`.
- **Only `actions.ts` changes state.** UI components render from state and call actions. An action
  is: ask (unsaved changes, confirmations), call the API, update state, then refresh the list.
- After any change, the list and the tag counts are **re-fetched** rather than patched locally:
  the server is the single source of truth, and with the stat cache it's cheap. Every list request
  carries a sequence number; a response older than the newest one already applied is dropped, so
  fast typing in the search box can't show stale results.
- Components (`ui/*`) each own one DOM subtree and re-render it when their slice of state changes.
  All user data is inserted with `textContent` and attributes, never `innerHTML`.
- `prefs.ts`: `margin:mode`, `margin:font`, `margin:sidebar`, `margin:collapsed:<noteId>`.

### 7.2 API client

`api.ts` wraps `fetch`: JSON in and out, the `X-Margin: 1` header on writes, and errors turned into
toasts. On **401** it reloads the page (showing the login page at the same address) unless the open
note has unsaved changes, in which case it shows an error and doesn't reload, so the text can be
copied first (README §3.18).

### 7.3 Address bar

`url.ts` derives the URL from state (`?note=`, else `?tag=`, else `/`) and writes it with
`history.replaceState` after every state change. At boot it reads it once: `?note=` opens the note
(the server has already returned 404 for one that doesn't exist), `?tag=` sets the filter.

### 7.4 Saving

- `dirty = !view.state.doc.eq(savedDoc)`, recomputed on document changes only. `savedDoc` is a
  CodeMirror `Text`, so undoing back to the saved text makes the note clean again.
- **Save** sends the current document as a snapshot. On success, `savedDoc` becomes that snapshot
  (not the current text, which may have changed during the request) and the state becomes `saved`
  or `unsaved` accordingly. On failure, `failed`.
- One save in flight per note: Ctrl+S during a save sets a flag, and one more save runs when the
  current one finishes.
- Before switching notes, creating, going home, trashing or logging out, the action waits for an
  in-flight save to finish, then asks "You have unsaved changes. Discard them?" if still dirty.
  `beforeunload` asks the browser to confirm while dirty.
- **Tags** save immediately, through a per-note queue so quick changes reach the server in order.
  Each request sends the whole tag list.

### 7.5 UI

Sidebar, note cards, tag filter, search (200 ms debounce), menu bar, save button, switches, tag
chips, tag box and suggestions, trash banner, empty state, toasts and phone drawer: each is a
component built to README §3 and §4. Icons are SVG `<symbol>`s in `index.html`. Colors come from
the `palette.css` classes (§6.1). Confirmations and the Link prompt use the browser's own dialogs
(README §3.21).

### 7.6 Editor (`editor/`)

One `EditorView` for the app's lifetime. Opening a note installs a **new `EditorState`**, which
resets undo history (README §3.7).

Extensions, always on: `history`, `drawSelection`, line wrapping, the default and history keymaps,
the **analysis field**, the collapsed field, the end-of-file marker, Tab in code, the popup, link
handling, paste, spellcheck on (autocorrect and autocapitalize off), an update listener (dirty
state, collapse persistence, link chip) and two compartments:

- **mode**: render = render field + atomic ranges + guard + class `mode-render`; raw = class
  `mode-raw`. Switching modes reconfigures this compartment only, so the document, selection and
  undo history carry over.
- **read-only** (trashed notes): `EditorState.readOnly` and `EditorView.editable` false.

**Two fields, so a cursor move doesn't re-parse:**

| Field | Recomputed when | Holds |
|---|---|---|
| `analysis` (both modes) | the document changes | `parseDoc` result plus cached inline tokens. Used by render, guard, popup, links and Tab. |
| `render` (render mode) | analysis, the cursor's line set, or the collapsed set changes | decorations, the list of **hidden ranges** (each tagged `marker`, `heading`, `fence`, `image` or `fold`) and the atomic ranges built from them |

Decorations follow README §3.8–§3.12 and §4: title line class; heading prefix → fold widget (⌄),
heading text in the dark shade and highlight colors suppressed; a section-color class on content
lines (the bar is a `::before`); a collapsed section → one replace decoration from the end of its
heading line to the end of the section, showing the ⋯ widget (which must come from a `StateField`,
because it spans line breaks); fences hidden unless the cursor is on them, with the Copy widget on
the opening fence; screenshot lines → image widget (it re-measures the editor when the image
loads); highlight, code and link marks. The end-of-file marker is a block widget at the document
end, in both modes.

**Collapsed sections.** A `StateField<Set<string>>` of heading-line texts, changed by a
`toggleSection` effect, loaded from and saved to `margin:collapsed:<noteId>`. It isn't part of the
document, so collapsing never makes a note unsaved.

### 7.7 Render-mode editing (`guard.ts`)

The README §3.7 rules, built on the line model:

1. **Cursor movement.** Atomic ranges from the hidden ranges, so the cursor steps over hidden
   syntax as a unit. A cursor at the end of a highlight sits *inside* its closing marker, so typing
   extends the highlight; → crosses the (invisible) marker to step out.
2. **Plain insertions pass through untouched**, including typing, IME composition and
   autocorrect. Most keystrokes never reach the model.
3. **Backspace, Delete and Enter** are a highest-precedence keymap that runs the line-model edit ops
   (§6.4) and the line-kind rules of README §3.7 (joins, headings, screenshots, code). Deletions
   step by grapheme cluster (`findClusterBreak`). CodeMirror routes Android's backspace through the
   keymap too.
4. **Any other user change that overlaps a hidden range** (a selection across syntax replaced by
   typing, cut, drag-and-drop) is caught by a **transaction filter** and recomputed: the affected
   lines become models, the visible characters in the range are removed, the inserted text takes
   the style at the start of the range, and the result is serialized, verified and applied as a
   minimal change (§6.3). Edits that only touch visible text pass through.
5. **Multi-line changes** join the first line's part before the range with the last line's part
   after it, keeping the **first line's kind**. Screenshot lines and collapsed sections are either
   fully inside the range or not at all (they're atomic). A code block's fences are deleted only
   when both are inside the range; otherwise only its selected code lines lose their content
   (§12, items 2 and 3).
6. All of Margin's own transactions (formatting, guard rewrites, uploads) carry a `bypass`
   annotation so the filter ignores them, and a user-event name so undo treats them as one step.

### 7.8 Formatting popup and bar (`popup.ts`)

A view plugin that owns one DOM element and computes its contents from `formatState` (§6.4) on
every selection change. Placements: **selection** (under the selection end, flipped above if
there's no room, clamped to the window), **pinned** (under the palette button) and **docked** (fixed
at the bottom, raised by the on-screen keyboard's height from `visualViewport`) when
`(max-width: 760px), (pointer: coarse)` matches. Its keymap has the highest precedence and only
takes keys while it's visible (and not pinned with an empty selection). Buttons act on `mousedown`
with `preventDefault`, so the editor keeps focus and selection. The popup works in both modes.

### 7.9 Links, paste, copy

- **Ctrl/Cmd+click** hit-tests the analysis tokens at the click position, so it works in raw mode
  too, and opens the URL with `noopener,noreferrer`. A class on the editor while Ctrl/Cmd is held
  gives links the pointer cursor and solid underline. On touch screens, a chip above the cursor
  shows the link's address when the cursor is in a link.
- **Paste**: if the clipboard holds a file, take the first one; a PNG is uploaded (toast "Uploading
  screenshot…") and `![](name.png)` is inserted on its own line; anything else shows "Only PNG
  screenshots are allowed". A URL pasted over a one-line selection becomes a link (a line-model
  op). Otherwise the default paste.
- **Copy** copies the raw document slice (CodeMirror's default), so formatting survives pasting
  into another note. The code-block Copy button uses `navigator.clipboard` when available and a
  hidden-textarea fallback over plain HTTP.

### 7.10 Phones and touch

CSS breakpoint at 760 px: drawer sidebar, two-row menu bar, 16 px text and inputs, `100dvh`,
safe-area insets. `(pointer: coarse)`: docked popup, link chip, Copy always visible. All of it per
README §3.19.

## 8. Performance

- Keystroke: the analysis field re-tokenizes only changed lines (cache); the block and section scan
  is O(lines); the render field rebuilds decorations. Target: under 8 ms per keystroke on a
  2,000-line note on a laptop, measured by a benchmark in `test/unit`.
- Cursor movement re-runs neither the parser nor, unless the cursor enters or leaves a fence line,
  the decoration build.
- Server: listings cost `stat` calls (5.6); search is a substring scan over cached lowercased text.
- If very large notes turn out to be slow, the render field can be limited to the visible ranges.
  That is deliberately left out for now.

## 9. Testing

- **Unit** (`node --test`, TypeScript run directly): the grammar, rule by rule, with negative cases
  for every "stays literal" rule in README §3.5; line-model round trips (parse → model → serialize
  → parse gives the same model, over a table of cases and randomly generated lines); every row of
  the README §3.6 table; every README §3.7 editing rule on a headless `EditorState`; titles,
  `visibleText`, colors, validators.
- **Server** (`node --test`): starts the server in-process on **port 0** with a temporary
  `DATA_DIR`, then covers every route and error code, the `GET /` 404 rules, sliding expiry,
  removing a user (and re-adding the same name), concurrent save + tag change, and the CLI via a
  child process with `MARGIN_PASSWORD`.
- **Browser** (Playwright, Chromium; desktop, and iPhone 12 Pro size with touch): log in; create,
  edit, save and the unsaved prompts; render-mode typing at highlight edges; popup keyboard
  navigation; PNG paste; collapse persistence; trash flows; 404 pages; the drawer.
- Every test uses its own port and temporary directory and only stops processes it started.

## 10. Build, development and deployment

- `npm run build` (`scripts/build.ts`): esbuild bundles `src/client/app.ts` and `login.ts` (ESM,
  minified, source maps) and the CSS; writes `palette.css`; copies `src/public/`; output in
  `dist/public/`.
- `npm run dev`: esbuild in watch mode plus `node --watch src/server/main.ts`, with `PORT` and
  `DATA_DIR` from the environment.
- `npm test`, `npm run test:e2e`, `npm run check` (`tsc --noEmit`).
- **Dockerfile**, two stages on `node:26-alpine`: (1) `npm ci` and `npm run build`; (2) copy `src/`
  (server, shared, cli), `bin/margin-user` and `dist/public/`. There are no runtime dependencies,
  so the runtime stage has no `node_modules`. `ENV DATA_DIR=/data PORT=5555`,
  `CMD ["node", "src/server/main.ts"]`.
- **compose.yaml**: service `margin`, `restart: unless-stopped`, port `5555:5555`, volume
  `./data:/data`, user `${MARGIN_UID:-1000}:${MARGIN_GID:-1000}`. The commands in README §2 work
  unchanged.

## 11. Comparison with the original's architecture (README §5)

| Area | Original | This design | Why |
|---|---|---|---|
| Server | Express 5 | `node:http`, zero runtime dependencies | Small fixed surface; nothing to update. |
| Language | JavaScript | TypeScript, run directly by Node | Types across the shared parser and both sides, no server build step. |
| Editor | CodeMirror 6 | CodeMirror 6 (same) | Raw text plus decorations is the right fit (§2). |
| Render-mode edits | change filter that keeps hidden pieces, a filter that removes emptied tokens, plus key handlers | one styled-character line model for all rewrites, serialized, verified, applied as a minimal change | One engine for formatting and editing; results are checked; fixes the README §7 heading-break limitation. |
| Parse on keystroke | whole note re-parsed; decorations rebuilt on selection changes too | inline parse cached per line; parse and decorations in separate fields | Keeps typing fast in long notes. |
| Listing | reads every note on each request | stat-validated cache | Same freshness, far fewer reads. |
| Concurrent writes | none mentioned | per-note lock | A save and a tag change can't overwrite each other's `meta.json`. |
| Sessions | plain tokens on disk; removal ends sessions | hashed tokens; sessions bound to the user's creation time | A data-folder copy can't log anyone in; remove-then-re-add can't revive old sessions. |
| Forgery | `SameSite=Lax` | plus a required custom header, plus CSP | Lax doesn't cover other services on the same host. |
| Password cost | Node's default scrypt (N = 2^14) | N = 2^17, at most two at once | OWASP minimum; memory stays bounded. |
| Asset caching | not specified | ETag + `no-cache` | An update is never hidden by a stale cached bundle. |
| Tests | none | unit, server, browser | — |

## 12. Changes a user could notice (need approval)

None of these adds a feature. They change what happens in edge cases where the original's
behavior is a listed limitation or unspecified.

1. **A formatting op that can't be written down safely does nothing**, instead of producing text
   that renders differently from what was asked (README §7: "an unmatched backtick next to new
   inline code can pair up unexpectedly"). The popup hint line says "Can't apply that here".
2. **Deleting a selection that runs from ordinary text into a heading no longer breaks the
   heading** into visible raw syntax (README §7). The joined line keeps the first line's kind.
3. **Deleting a selection that covers only one fence of a code block keeps both fences** and
   empties only the selected code lines, so a block never loses half its fences.

## 13. Gaps in the README, and the default taken

| Question | Default |
|---|---|
| Does the formatting popup work in raw mode? | Yes; the README doesn't limit it to render mode. |
| Does `margin-user passwd` end the user's other sessions? | No (the README says only that *remove* does). |
| Title of a note whose first line is a fence or a screenshot? | "Untitled": that line has no visible text. |
| Pasting several files at once? | The first file is used. |
| Ctrl+S while a save is in flight? | One more save runs after the current one. |
| Unknown `/api/…` path? | JSON 404 instead of the 404 page (no user ever sees it). |

## 14. Risks

- **The guard's transaction filter vs. input methods.** Plain insertions pass through untouched,
  but a composition (mobile keyboard, IME) that replaces text across hidden syntax gets rewritten
  mid-composition. Mitigation: minimal changes (§6.3), and a browser test with composition events.
  Touch behavior can't be fully tested without a real device (README §7).
- **Serialization without an escape character** can't represent every model. Verification turns
  that into a safe no-op (§12, item 1) rather than a silent corruption.
- **Decoration rebuild cost on very long notes.** Measured by the benchmark (§8); visible-range
  limiting is the fallback.
- **No framework in the UI** means the components' re-render discipline is by convention. Kept
  manageable by the single store and actions-only state changes (§7.1).
