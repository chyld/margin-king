# Fonts spec review, round 1

2026-10-26. Reviewed the "Fonts" part of [`../architecture.md`](../architecture.md) §15 at commit
`a49009f`, before any code was written. Every reviewer ran at high reasoning, read-only, with its
own scratch folder and port.

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

MiniMax, Sol, Kimi and Grok checked the folder rules against real release zips (Fira Code 6.2,
JetBrains Mono 2.304, Nerd Fonts JetBrainsMono, Inter 4.1, Adobe Source Sans / Source Code Pro).
Sol reproduced the `fixEquals` and late-font-load problems in scratch copies.

## Adopted

| Finding | Raised by | Change |
|---|---|---|
| Real zips don't have one folder per font: Fira Code unzips to `ttf/ woff/ woff2/ variable_ttf/`, JetBrains Mono to `fonts/`, Inter to `web/ extras/`, Adobe adds `__MACOSX/`; folder names carry versions (`JetBrainsMono-2.304`) that would end up in the stored id | MiniMax, DeepSeek, Kimi, Sonnet, Grok | **Owner decision**: fonts are identified by the metadata inside each file (`name`, `OS/2`, `fvar`, `head`, `post`); files are grouped by family name, so any layout works and ids survive upgrades and renames |
| Filename rules misread weights and styles: Adobe `-It` italics, Ubuntu `-B`, `Semibold`, `Black Ops One`, `VF` variable files, loose `Inter-Bold` declared 400 | Sonnet, Sol, Grok, Muse, DeepSeek, Kimi, GLM, MiniMax | Weight, italic and variable range come from the file; regular/bold chosen by weight; a variable face declares its real `wght` range |
| Same-face ties used an undefined "path order"; Nerd Fonts' Mono/Propo/NL cuts competed as one font | GLM, Muse, Grok, Sonnet | Nerd Fonts cuts are separate families in their metadata, so separate fonts; ties go by format, then code-unit path order |
| `__MACOSX/._*` files and dotfiles at depth could compete as faces | Muse, MiniMax | Skipped at every depth; files are checked by their first bytes |
| `.ttc` and `.zip` disappear without a trace | GLM, Sonnet | One log line each; other non-font files counted in one line per folder |
| A font-only run isn't `styled()`, so it serializes as plain text; `sameOpts`, `sameVisible`, `openingMarker`, `makeChar` know only color/b/u | Muse, GLM, Sonnet, MiniMax, DeepSeek, Grok, Kimi | Model bullet lists every function that must carry the font |
| `fixEquals` would leave a font on an `=` that must turn plain (reproduced) | Sol, Muse, GLM, DeepSeek | `fixEquals` clears the font too |
| The edit engine's `templateAt`/`PLAIN`/`settleRow` drop the font when typing | Sonnet, DeepSeek, MiniMax, Grok, Kimi, Sol | Engine named in the spec; typing extends a font like a color |
| The block operation can't reach code lines through `resolveTarget`; selection restore and `formatState` return early | Muse, GLM, Sonnet, DeepSeek, Sol, MiniMax, Grok | Own branch before target resolution, like `</>`; a cursor in a block targets it; selection ends in code are mapped through the change set |
| A selection touching a block refused an "other" font for the whole selection | MiniMax, Grok | A font applies to everything in the target it's allowed on: text takes any font, inline code and blocks only monospace |
| Default's `mono` value was undefined, so Default could be refused on a block | Kimi, Sol, Sonnet, DeepSeek | `font: null` is allowed anywhere |
| `formatState.font` was mixed forever after an "other" font skipped inline code; check marks for code-only targets undefined | Sonnet, Muse | `font` is taken from the target's text characters, or from its code for a `codeOnly` target; effective font defined |
| Picking an "other" font on code alone looked like success | Muse | `codeOnly` targets list only monospace fonts |
| Block font word: the spellings and the parse rule seemed to disagree | MiniMax, Sonnet | Info string defined as the text after the first three backticks; only valid `font-<id>` words count; trailing spaces trimmed before appending |
| No re-measure after a late font load: caret and selection stay at the fallback's widths (reproduced) | Sol, Kimi, Grok, Sonnet, DeepSeek | `requestMeasure()` on `loadingdone`/`loadingerror` and after the style is added; the popup re-positions |
| Streaming from disk after hashing at startup can serve other bytes under an immutable URL | Sol, Sonnet, DeepSeek, Muse | Chosen faces are read into memory at startup |
| Symlinks could expose files outside the font folders | Sol, Kimi, DeepSeek | Only regular files and real directories; symlinks skipped and logged |
| Any scan error could stop the server | Kimi, Muse, DeepSeek | Scanning never stops the server; every error is logged and skipped |
| The font route needs to escape the API's `no-store` | GLM, MiniMax, DeepSeek, Sonnet | Stated; the opt-out becomes a route flag |
| `FONTS_DIR` isn't set in the image; `.dockerignore` misses `fonts`; `Config` literal in tests | MiniMax, DeepSeek, Sonnet | `ENV FONTS_DIR=/fonts`, ignore files, optional `Config.fontsDir` |
| `weight`/`format` shapes undefined; file extensions aren't CSS format keywords | Muse, GLM | `weight` is a CSS string, `format` the CSS keyword |
| The `hash.ext` route parameter and exact matching unspecified | Muse | Exact `<id>/<hash>.<ext>` lookup in the startup table |
| Truncating after trimming can leave an id ending in `-` | Muse, Sonnet, Sol, Kimi, MiniMax | Trim, cut, trim again, check against the grammar |
| The list's own-font rule was never generated; `--note-font` didn't exist | Muse, GLM, MiniMax, Kimi | Both defined |
| Own-font previews download every font, contradicting "unused fonts cost nothing" | Sonnet, Sol, DeepSeek, Kimi | **Owner decision**: keep previews; the cost (one download per font, then cached) is stated |
| The popup's `pointerdown` handler would also activate list entries; height change not re-positioned; list state on selection change undefined | GLM, MiniMax, DeepSeek, Sonnet | Entries live outside the cells, act on click; re-position on open/close; any selection change closes the list |
| The Font button arrives after the popup is built | MiniMax | Always built, hidden until needed; the ring skips it |
| Hiding Font with no fonts installed makes a missing font unremovable | Sol | Shown when the target's font isn't installed |
| The docked list is taller than the swatch rows it replaces | Sonnet | About 4 entries docked, 6 floating; `overscroll-behavior: contain` |
| Ligatures are off editor-wide, so Fira Code / JetBrains Mono lose them | Sonnet, Grok | **Owner decision**: on for code in a picked monospace font |
| Removing padding from all colorless highlights changes existing bold/underline text | all eight | **Owner decision**: only `cm-hl-font` highlights without a color lose side padding |
| Missing tests: engine paths, fuzz alphabet, real layouts, route edge cases, late loads, tap vs swipe | all eight | Test plan rewritten |
| Fold-in list missed §5.2, §7.6, §7.7, §9 and the README deviations | MiniMax | Added; README deviations listed in the spec |

## Not adopted

| Finding | Raised by | Why |
|---|---|---|
| Cancelling `pointerdown` suppresses `click` and touch panning, so the list can't be tapped or scrolled | Grok | Checked in Chromium with real touch input (CDP): with `pointerdown` prevented, a tap fires `click` and a swipe scrolls the list without one. Pointer Events only suppress the compatibility *mouse* events, and panning is governed by `touch-action`. iOS Safari couldn't be checked here |
| Render should add `ff-<id>` only for installed fonts | GLM | Classes come from the syntax alone, so rendering doesn't wait for the list; only installed fonts have rules, so an unknown class does nothing |
| Refuse fonts in `monospace/` that aren't fixed-pitch | (Sonnet, Muse, as an option) | `post.isFixedPitch` is unreliable in ligature and patched fonts; a warning is logged instead |
| Accept `.ttc` with its first face | GLM | Browsers don't reliably load collections through `@font-face`; logged instead |
