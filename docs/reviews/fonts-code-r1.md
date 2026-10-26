# Fonts code review, round 1

2026-10-26, of commit `d787ee0` (the owner's fonts feature, architecture §15 Fonts; its spec was
reviewed first, see [`fonts-spec-r1.md`](fonts-spec-r1.md)). The same eight beta reviewers, at high
reasoning, each building and testing in its own scratch copy on its own port. Fixes land as one
commit per review, each with tests that fail without it.

## GPT-6.1 Sol — 6 findings, all reproduced

| # | Finding | Outcome |
|---|---|---|
| 1 | Decompression has no output limit, and files are read without a size limit: a 16 KB WOFF unpacked to 16 MB | Fixed: files over 64 MB are skipped unread; a table Margin reads may claim at most 4 MB (a WOFF2 file's tables 256 MB together); unpacking stops at the declared size and must reach exactly it; a WOFF table longer packed than unpacked is refused |
| 2 | A symlinked `monospace/` or `other/` folder is followed | Fixed: both are checked with `lstat` and must be real folders; files are opened with `O_NOFOLLOW` |
| 3 | A selection ending at the start of the next line loses the code block it covered after a font is picked | Fixed: only an end on a line whose characters were targeted comes from the serializer's carets; others are mapped through the changes |
| 4 | With no fonts installed, the Font button hides when a missing font is mixed with plain text, so it can't be removed | Fixed: `formatState.fonts` lists every font stored in the target; the button shows if any isn't installed |
| 5 | Mac Roman names are decoded as Latin-1 (`Café` became `Caf\u008e`, id `caf`) | Fixed: a Mac Roman table for the upper half |
| 6 | The browser tests' "loaded" check (`document.fonts.check`) is true for a family with no faces | Fixed: `document.fonts.load` must return a loaded face |

## Muse Wonder 1.0 — 8 findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Unbounded decompression and reads (a 93-byte Brotli stream became 50 MB) | Already fixed (Sol #1) |
| 2 | A symlinked `monospace/` folder is followed | Already fixed (Sol #2) |
| 3 | The second read of a chosen face checks only the family; a file replaced mid-startup could be served as another format or style | Fixed: the family, weight, style, axis and format must all match. No test: it needs a file to change between the two reads |
| 4 | Removing a first font word leaves a space: `` ```font-a python `` → `` ``` python `` | Fixed: a first font word takes the space after it; the operation also checks the rest of the line is unchanged |
| 5 | A font whose regular face fails the second read is skipped silently | Fixed: logged. No test, as for #3 |
| 6 | Mac Roman names decoded as Latin-1 | Already fixed (Sol #5) |
| 7 | A font list opened before the installed fonts arrive stays without them | Fixed: rebuilt when they arrive, keeping its focus; tested with the list request held back |
| 8 | The ligature tests check CSS only | Fixed: a Fira Code fixture; the test draws a code line with and without ligatures and requires a difference, and none for default code |

## Kimi K3.1 Pro — 4 findings

| # | Finding | Outcome |
|---|---|---|
| 1 | No size ceiling on files or decompressed tables | Already fixed (Sol #1) |
| 2 | A symlinked `monospace/` or `other/` folder is followed | Already fixed (Sol #2) |
| 3 | An inflated WOFF table's length isn't checked against its declared length | Already fixed (Sol #1: it must unpack to exactly its declared length, and a table longer packed than unpacked is refused) |
| 4 | Mac Roman names decoded as Latin-1 | Already fixed (Sol #5) |

## Sonnet 5.5 — 5 findings (and a 40,000-case fuzz of the operations that found nothing)

| # | Finding | Outcome |
|---|---|---|
| 1 | No decompression or file-size cap (a 2.2 KB WOFF2 took 3 GB) | Already fixed (Sol #1) |
| 2 | No hostile-file tests; no browser test of the Font button hidden with no fonts, or of the pinned bar picking a font | Added: a table past the end of the file, garbage and cut-short WOFF2 data, counts larger than their tables, the button hidden with an empty list (and shown for a missing font), and the pinned bar setting a block's font |
| 3 | `formatState` builds the target's rows twice (a 20,000-line select-all went from 162 to 338 ms) | Fixed: the font's target is the same range, so its rows are reused (238 → 177 ms here) |
| 4 | The second read of a chosen face only re-checks the family | Already fixed (Muse #3) |
| 5 | Names from font files go unsanitized into the log and the API | Fixed: control characters and line breaks become spaces; at most 100 characters |

Sonnet also noted that in the browser tests, Ctrl+Shift+Z right after Ctrl+Z empties the note. That
is Playwright sending a lowercase `z` with Shift, which CodeMirror reads as a second undo (code
review resize-r1, Sonnet #6), not a font problem.

## MiniMax M3.1 Flash — 11 findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Unbounded decompression (a 200 KB WOFF reached 403 MB) | Already fixed (Sol #1) |
| 2 | A symlinked `monospace/` or `other/` folder is followed | Already fixed (Sol #2) |
| 3 | With the list opened by mouse, Enter replaces the selected text with a line break | Fixed: Enter moves the ring into the list, onto the checked entry |
| 4 | The ring is an index into the visible buttons, so the Font button appearing moves it (Remove color → Font) | Fixed: the ring remembers the option itself |
| 5 | A missing font mixed with plain text hides the Font button | Already fixed (Sol #4) |
| 6 | A selection ending at the next line's start loses its block | Already fixed (Sol #3) |
| 7 | Mac Roman names decoded as Latin-1 | Already fixed (Sol #5) |
| 8 | Windows symbol name records (3/0) rank with 3/1 and 3/10, against the spec | Fixed: ranked last; the ranking is tested |
| 9 | `formatState` builds the target's rows twice | Already fixed (Sonnet #3) |
| 10 | The "loaded" check is true for a family with no faces | Already fixed (Sol #6) |
| 11 | No tests of a font on a heading, of Section keeping a font, or of typing inside a font run | Added the first two; typing inside a run was already tested (`=={lime+font-inter}wo‸rd==`) |

## DeepSeek V4.1 Flash — 8 findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Unbounded decompression (a 164 KB WOFF2 took 256 MB) | Already fixed (Sol #1) |
| 2 | Names from font files can forge log lines | Already fixed (Sonnet #5) |
| 3 | `formatState` builds the rows twice | Already fixed (Sonnet #3) |
| 4 | An open list keeps stale check marks when the note changes under it (an undo) | Fixed: the list is built again when the target's fonts change (with Muse #7's rebuild for the installed fonts arriving) |
| 5 | A stored font the list doesn't offer shows nowhere: an "other" font on code alone, or missing fonts in a mixed selection | Fixed: every font in the target that isn't offered is listed after Default, disabled: "(not installed)" or "(not for code)" |
| 6 | The path-traversal route test is vacuous: `fetch` resolves the dots before sending | Fixed: those paths are sent raw with `http.request`, with encoded variants |
| 7 | No browser test of mixed selections | Added: text plus inline code, and text plus a block, with both kinds of font, the computed fonts and the kept selection |
| 8 | `fontable` and `fonts` aren't in the docs | Fixed (§15 Fonts, `formatState`) |

## Grok 4.7 — 12 findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Unbounded decompression and reads | Already fixed (Sol #1) |
| 2 | Symlinked `monospace/` or `other/`, and file symlinks followed when read | Already fixed (Sol #2) |
| 3 | A selection ending at the next line's start (or starting on a line with nothing selected) loses the block | Already fixed (Sol #3; both cases are in the unit tests) |
| 4 | Enter in a list opened by mouse replaces the selection with a line break | Already fixed (MiniMax #3) |
| 5 | Mac Roman names decoded as Latin-1 | Already fixed (Sol #5) |
| 6 | With no fonts installed, a mixed selection hides the Font button | Already fixed (Sol #4) |
| 7 | Code alone, stored in an "other" font: nothing is checked, and the ring opens on Default, where Enter removes the font | Fixed: that font is listed, checked and disabled (DeepSeek #5), and the ring now opens on it; Enter does nothing there |
| 8 | A first font word leaves a space; the rest of the fence line isn't checked | Already fixed (Muse #4) |
| 9 | A list opened before the fonts arrive isn't rebuilt | Already fixed (Muse #7) |
| 10 | The second read checks only the family | Already fixed (Muse #3) |
| 11 | Windows symbol names rank ahead of Mac Roman | Already fixed (MiniMax #8) |
| 12 | `document.fonts.check` passes with no faces | Already fixed (Sol #6) |

## GLM-5.3 Flash — 6 findings (and about 50 adversarial probes of the operations and the reader)

| # | Finding | Outcome |
|---|---|---|
| 1 | No `maxOutputLength` on either decompressor (a 421-byte stream became 256 MB) | Already fixed (Sol #1) |
| 2 | Code alone in an installed "other" font: nothing is checked, not even Default | Already fixed (DeepSeek #5: listed as "(not for code)", checked) |
| 3 | Opened from the keyboard, the ring skips a checked "(not installed)" entry and lands on Default | Already fixed (Grok #7) |
| 4 | With the ring in the list, Left and Right do nothing: the ring is trapped | Fixed: Up from the first entry, Left or Right go back to the Font button (the list stays open); Down from the second button row goes in |
| 5 | The no-fonts case isn't tested in the browser | Mostly already added (Sonnet #2: the button hidden with an empty list, and the ring skipping it in MiniMax #4's test); now the missing font is also removed there |
| 6 | `formatState` prepares twice; `pickFont` closes the list `apply` already closed | The first already fixed (Sonnet #3); the redundant close removed |

## Round 1 summary

All eight reviewed. Fixed across seven commits: bounded reads and decompression, symlinked font
folders, Mac Roman names, sanitized names, the second read checking the whole face, a block's
selection kept, fonts the list can't offer shown, the list following the note and the font list
arriving, the ring (an option, not a position; Enter and the arrows in the list), the fence's info
string kept byte for byte, symbol names ranked last, `formatState` building its rows once, and
stronger tests (real face loading, drawn ligatures, raw traversal paths, malformed files, mixed
selections, the no-fonts case). No finding was declined.
