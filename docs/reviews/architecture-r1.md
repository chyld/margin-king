# Architecture review, round 1

2026-10-25. Reviewed [`../architecture.md`](../architecture.md) at commit `2383cc4` against
[`../original-readme.md`](../original-readme.md). Every reviewer ran at high reasoning, read-only.

| Reviewer | Provider | Model |
|---|---|---|
| Sonnet | Claude | `claude-sonnet-5-5` |
| Sol | Codex | `gpt-6.1-sol` |
| Grok | Grok | `grok-4.7` |
| Muse | Muse Code | `muse-wonder-1.0` |
| DeepSeek | OpenCode Go | `opencode-go/deepseek-v4.1-flash` |
| MiniMax | OpenCode Go | `opencode-go/minimax-m3.1-flash` |
| GLM | OpenCode Go | `opencode-go/glm-5.3-flash` |
| Kimi | OpenCode Go | `opencode-go/kimi-k3.1-pro` |

alpha checked the disputed claims against CodeMirror's source (`@codemirror/view` 6.43.15,
`commands` 6.11.1, `language` 6.13.1) and Node 26.12.1 before deciding.

## Adopted

| Finding | Raised by | Change (architecture §) |
|---|---|---|
| scrypt at N = 2^17 throws without `maxmem` (Node's default is 32 MiB) | all eight | N = 2^15, r = 8, p = 3 (OWASP), `maxmem` 64 MiB on every call (§5.7) |
| The login queue had no length limit | Muse, Sonnet, Sol, MiniMax | 2 running, 16 waiting, then 503; abandoned waits dropped (§5.7) |
| Deleting exactly a token's visible text leaves `=={b}==`, `` ` ` `` or `[](url)` | Sonnet, Sol, Kimi, MiniMax | Emptied tokens disappear on every deletion path (§7.7 3d) |
| Android deletions only sometimes reach the keymap; CodeMirror's delete commands delete atomic markers whole | Sonnet, MiniMax, Grok (GLM: the routing exists) | Commands for intent plus one invariant filter for every input path; hidden-only deletions reinterpreted (§1.3, §7.7) |
| Typing at a heading line's start, or beside a screenshot or a collapsed section, breaks it | Sonnet, GLM | Caret rules and edge rules (§7.7 1, 3c) |
| Caret affinity at a token's end is undefined; the line model loses it | Muse, Sonnet | Positions carry enclosing tokens (§6.3); pointer and vertical carets go inside (§7.7 1) |
| "The cursor sits *inside* its closing marker" is wrong: atomic ranges never hold a caret | GLM, MiniMax | Reworded; atomic ranges are hidden pieces only, never whole tokens (§7.6) |
| The model's character unit is undefined | Muse | UTF-16 units, operations widened to grapheme clusters (§6.3) |
| Code lines are literal but would be modeled | Muse | Code lines never modeled (§6.3, §7.7) |
| "Keep the first line's kind" contradicts "keep both fences" in multi-line deletes | Muse, Sonnet | Partition at protected lines; never join across a kept fence (§7.7 3f) |
| A selection can cover part of a collapsed section | Muse, GLM | Edits touching a collapsed section expand it first (§7.6, §7.7 3c) |
| Bare URLs lose link identity unnoticed; the Link button can't see them | Sol, Sonnet, DeepSeek, Grok | `LinkRef` with `form: "bare"`; verify checks URL forms and extents (§6.3, §6.4) |
| Inline verification misses document-level changes (a new screenshot, a fence closing early) | Sol, Kimi, DeepSeek | Verify also runs `parseDoc` and compares line kinds (§6.3) |
| Rejecting *edits* would make keys dead (an emptied heading can't serialize) | DeepSeek, Grok | Only formatting can be refused; edits fall back (§6.3, §7.7); emptied heading → empty line |
| Pasting raw syntax into a token was treated as literal text | Sol | Pasted syntax splits the enclosing token and is inserted raw (§7.7 3b) |
| A pasted line break inside a highlight, code or link breaks it | Grok | Same rule as Enter (§7.7 3b) |
| Mode switch, undo and programmatic selections can leave the caret inside syntax | Sol | Caret rules run on every transaction; once on entering render mode (§7.6, §7.7 1) |
| Copying part of a formatted word loses formatting, against README §3.7 | Sol | Balanced-syntax copy, **pending owner approval** (§12.4) |
| Rewritten transactions lose their user event and annotations | DeepSeek | Kept on output (§7.7 3h) |
| A filter rewrite mid-composition can break IMEs | DeepSeek, GLM, Grok | Composition passes through; repaired at its end (§7.7 3g) |
| Upload completion isn't bound to the note or position it started in | Muse, Sol, Kimi, Grok | Note id + mapped position; line-model insert; after a code block (§7.9) |
| A one-line `</>` inside a code block must remove the fences; no precedence for mixed selections | Muse, Grok | `</>` precedence rules (§6.4) |
| `</>` over link text can't set code on it | Grok | Code is set only on non-link characters (§6.4) |
| Heading cases for remove color, current swatch, clear formatting, Section on an empty line | Sonnet | Heading rules (§6.4) |
| Raw-mode selections inside syntax have no mapping | Muse, DeepSeek, MiniMax | Mapping rules (§6.3) |
| Popup rules missing: word at cursor, hint line, dimming, focus, mouseup, Esc, read-only | DeepSeek, GLM, Grok, MiniMax | §6.4 targets, §7.8 visibility and hints |
| Multi-line formatting can half-apply | Sonnet, GLM | All-or-nothing (§6.3) |
| Untouched tokens could be merged or canonicalized | Muse, Sonnet | Only runs the operation created are merged (§6.3) |
| Open-note races: typing during a load, out-of-order opens | Sol | Serialized opens, editor read-only while loading (§7.1) |
| Tag responses not bound to their note; queue not drained | Grok | Note id on each request; drained before leaving (§7.1) |
| A selected tag with count 0 vanishes from the filter | DeepSeek, MiniMax, Grok | Kept as an option (§7.1) |
| New note while filtered must get the tag; suggestion order unspecified | MiniMax | §7.1 |
| Logging in must reload the same URL | DeepSeek, Grok | §7.2 |
| Trash asked two questions | DeepSeek, GLM, Grok | Trash's own single confirmation (§7.4) |
| `notes/<user>/` never created | DeepSeek, Grok | Created on first note (§4) |
| `users.json` refresh missed logins; missing file undefined | Sol, Grok | Stat before login and session lookup; missing = empty (§4, §5.7) |
| mtime + size misses `users.json` changes | MiniMax | Inode, size and mtime (§5.7) |
| Remove + re-add within one millisecond revives sessions | Muse | Random per-user `uid` (§4, §5.8) |
| `passwd` must keep `created` | Sonnet | `passwd` keeps `uid` and `created` (§5.9) |
| Two concurrent CLI writes can lose a user | Sol | `users.json.lock` (§4, §5.9) |
| Overlapping `sessions.json` writes can resurrect a session | Kimi | Per-file write queue (§4, §5.8) |
| Fresh install: Docker creates `./data` as root | Sol, Kimi, Grok | `data/.gitkeep` plus a startup writability check (§5.1, §10) |
| `"type": "module"` is required for Node to run the `.ts` files | GLM | §2, §10; the image copies `package.json` |
| README §2 development commands missing | Kimi, Grok | `start`, `watch`, root `cli.js` (§10) |
| Dev server serves a stale bundle | Muse, DeepSeek | Static files read per request outside production (§5.4) |
| SIGTERM drops in-flight requests; 300 s request timeout cuts large uploads | Sonnet | Graceful shutdown; `requestTimeout` 0 plus a 120 s idle timeout (§5.1) |
| CRLF text breaks server-side titles and search | Sonnet | Normalized in the parser (§6.2) |
| The opening-fence regex is narrower than README §3.5 | Sol, GLM | README §3.5 wording, listed in §13 |
| Ambiguous highlight closing with empty content | MiniMax | Pinned with worked examples (§6.2) |
| Missing "Missing screenshot" fallback | GLM | §7.6 |
| Link hover tooltip missing; palette CSS vs "one CSS file" | Sonnet | §7.6, §2 |
| Render-field trigger contradicts §8 | Sonnet, DeepSeek, GLM, MiniMax | Rebuild only when a caret crosses a fence line (§7.6, §8) |
| The per-line inline cache isn't needed | Sonnet, DeepSeek | Dropped; first fallback if the benchmark fails (§8) |
| `defaultKeymap` brings unlisted shortcuts and auto-indent | Sonnet | `standardKeymap` only (§7.6, §13) |
| `pointer: coarse` misses touchscreen laptops | Kimi | Docking and link chip follow the actual pointer type (§7.8, §7.10) |
| Touch popup buttons and `visualViewport` details | Sonnet, MiniMax | `pointerdown` + `preventDefault`; `resize` + `scroll`, `offsetTop + height` (§7.8) |
| Spellcheck was on without being listed | GLM | Listed in §13 |
| Stat cache freshness: mtime + size miss restores; the cache is premature | Muse, DeepSeek, Sol, Kimi, MiniMax | **Cache removed**; direct reads, measured (§5.6, §8) |

## Not adopted

| Claim | Raised by | Why not |
|---|---|---|
| A non-block replace decoration spanning line breaks crashes CodeMirror | MiniMax | CodeMirror's own folding (`foldState` in `@codemirror/language` 6.13.1) is exactly that: `Decoration.replace({ widget })` over multi-line ranges, from a `StateField`. A browser test confirms it early anyway (§9). |
| Hidden fences can't be reached from the keyboard | Muse | `skipAtomicRanges` only moves a caret *strictly inside* a range; a caret at either end of the fence line is allowed, is on that line, and reveals the fence. |
| Bold on part of inline code can't be written | MiniMax | It can: `` =={b}`a`==`bc` `` is a bold code `a` followed by code `bc`. The stray-backtick case is real and is in §12.1. |
| Skip bare URLs when looking for a highlight's closing `==` | Grok | README §3.5 lists "links and bare URLs" separately and ends a highlight at the first `==` not inside "inline code or a link". |
| Use `navigator.virtualKeyboard` for the keyboard height | MiniMax | Chromium-only and opt-in; `visualViewport` with `resize` and `scroll` is the cross-browser mechanism. |
| A root entrypoint that `chown`s `/data` and drops privileges | Grok | `data/.gitkeep` solves the fresh-clone case without changing compose's `user:` or running as root. |
| Keep scrypt at the default cost and drop the queue | Sonnet | The data folder is what the hash protects; OWASP's lower-memory setting costs ~180 ms here. The queue also keeps the thread pool free for file I/O. |
| Start with one editor field | DeepSeek | The analysis/render split is two small fields and is what makes cursor movement cheap; the cache was dropped instead. |
| Patch the list locally after a save instead of re-fetching | MiniMax | A save can change search matches; at README scale a re-fetch is simpler and always right. |

## Feature suggestions

| Suggestion | Raised by | Owner |
|---|---|---|
| `margin-user passwd` ends the user's other sessions | DeepSeek, Grok | declined |
| `Secure` cookie flag when behind a TLS proxy (`X-Forwarded-Proto`) | Sonnet | **approved** (architecture §5.8) |
| Rate-limit failed logins | Sonnet | declined |
| Opt-in conflict detection on save (two tabs) | DeepSeek | declined |
| A "delete unused screenshots" action | DeepSeek | declined |
| `margin-user doctor`: check the data folder for orphans and missing files | GLM | **approved** (architecture §5.9) |
| A switch that turns the render-mode guard off for very long notes | GLM | declined |

## Owner decisions (2026-10-25)

- architecture §12 items 1–4: all approved as proposed (refuse with a hint; the first line's kind
  wins; keep both fences; copy partial lines as balanced syntax).
- architecture §13: every default confirmed.
- Features: the two above approved, the rest declined (architecture §15).
- Next: a second beta review round.
