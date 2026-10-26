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
