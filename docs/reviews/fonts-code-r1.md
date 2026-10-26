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
