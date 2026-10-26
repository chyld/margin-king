# Architecture review, round 2

2026-10-25. The same eight reviewers (see [`architecture-r1.md`](architecture-r1.md)) reviewed
[`../architecture.md`](../architecture.md) at commit `59ae31f`, at high reasoning, read-only. Each
got the round-1 log, the diff since round 1 and their own unresolved objections. Owner decisions
were marked final. Each reviewer checked whether the round-1 fixes held, looked for problems the
revision introduced, and could contest a rejected finding with new evidence.

Every reviewer's verdict was "needs another revision", none for structural reasons: the findings are
rule clarifications, most of them in the editing contract (§6.3, §7.7).

**Withdrawn**: MiniMax confirmed in `@codemirror/view` that the "decorations that replace line breaks"
restriction applies only to plugin-provided decorations, so the collapsed-section design stands.
Sonnet re-checked scrypt and didn't contest it.

## Adopted

| Finding | Raised by | Change (architecture §) |
|---|---|---|
| Falling back to "the user's raw change" when an edit fails verification re-opens the hole the filter exists to close | Sonnet, MiniMax, GLM, Muse, Grok | Fallback removed. Edits apply the engine's result; side effects that come from the text are accepted as in raw mode (README §7); only joins are checked first (§6.3, §7.7) |
| Undo and redo run with filtering off, so caret rules never see them | Sonnet (source), Sol (reproduced) | An update listener corrects the restored selection, outside history; tests that undo and redo restore exact text (§7.7 part 2, §9) |
| Every motion is labelled `select`, so the caret rule can't tell → from ↓ or End | Sonnet | Margin's motion wrappers label `select.vertical` and `select.lineboundary` (§7.7 part 2) |
| A range covering a closing `==` deletes it while the token still has text | Sonnet, Grok | Token rule: hidden pieces stay while any visible character remains (§7.7 part 1) |
| Rules 3d and 3e overlap with no precedence | GLM | The filter classifies key-shaped changes first (§7.7 part 4) |
| "Delete one visible grapheme" is wrong beside a heading prefix, screenshot, fence or collapsed section; Android bypasses the keymap there | MiniMax, Muse, Grok, DeepSeek | One boundary-aware engine; intent keys and filter call the same functions (§7.7) |
| A leading space breaks a heading | Sonnet, Sol | **Owner**: the space is dropped (§7.7, §13) |
| A pasted line break isn't README's Enter; Shift+Enter and macOS Ctrl+O bypass it | Grok, DeepSeek | One Enter operation for all of them (§7.7) |
| `standardKeymap` binds Enter and Shift+Enter to `insertNewlineAndIndent` | Sonnet, Sol (reproduced), DeepSeek, Grok | Both overridden in both modes (§7.6) |
| Popup and intent keymaps both "highest" | Sonnet, Muse, Kimi, Grok | Explicit order: popup, intent, Tab, standard (§7.6) |
| Which popup option is focused, and what Enter does before an arrow key | Muse | **Owner**: nothing focused until an arrow key (§7.8, §13) |
| `pointerdown` plus `mousedown` applies a button twice with a mouse | GLM, Kimi | Act on `pointerdown` only (§7.8) |
| The model can't copy untouched tokens byte-for-byte: it has no source text | MiniMax, Muse | `LineModel` carries the original text and tokens; `VChar.tok` (§6.3) |
| A single replacement loses position mapping inside it | Sol (reproduced) | Change sets that keep retained characters in place (§6.3) |
| Enter inside a bare URL can't keep two links to the same address | Sol, Kimi | **Owner**: both halves become `[text](url)` links (§7.7, §13) |
| A word or line deletion from a caret beside a collapsed section deletes it whole (atomic skip) | Grok | The section expands and the deletion re-runs (§7.7) |
| Editing a collapsed heading's text: expand, or keep collapsed? | Muse | Heading text keeps it collapsed; edges and hidden content expand (§7.6, §13) |
| Composition repair had no pre-image and wasn't grouped with the composition in undo | Grok | Snapshot at composition start; one repair labelled `input.type.compose` (§7.7) |
| Typing `]`, a backtick or `==` inside a token breaks it | DeepSeek | **Owner**: the token is split around the character (§7.7, §13) |
| A pending upload isn't bound to the `EditorState`; no field holds its position | Muse, Kimi, DeepSeek, MiniMax | Pending-upload field in the note's state; context recomputed at insert (§7.6, §7.9) |
| Copy across lines undefined | GLM, Grok | Partial end lines balanced, full lines raw (§7.9) |
| Paste rules applied in raw mode too | Sol | Engine paste in render mode only (§7.9) |
| Color, Remove color or Clear formatting on part of a link | DeepSeek | Every style change splits a `[text](url)` link; bare URLs refused (§6.4, §13) |
| `</>` unwrap couldn't pass the document check | DeepSeek | Operations declare intended kinds; unwrap intends whatever the lines parse as (§6.3) |
| §12.1's "wrapping lines that contain a fence line" can't happen | DeepSeek | Reworded: a line that is exactly a closing fence (§6.4, §12) |
| Cancelling the Link prompt (`null`) vs an empty answer | Muse | Cancel does nothing (§6.4) |
| A heading's own color (README §3.6 says "removed") not in §13 | MiniMax | **Owner**: nothing happens (§13) |
| Two definitions of a touch device | MiniMax | **Owner**: docking follows the input used; recorded in §13 |
| The keystroke budget omitted verification | MiniMax | Typing runs no model; formatting has its own 30 ms budget (§8) |
| `no-store` on all `/api` responses conflicts with immutable screenshots | MiniMax | Screenshots excepted (§5.2) |
| A live CLI lock can be stolen after 10 s; release by path | Muse, Sol, Kimi | Owner token, PID liveness, atomic reclaim, token checked before write and release; hash before locking (§5.9) |
| Fixed `maxmem` breaks a later rise in N | Sonnet | Derived from the stored cost (§4, §5.7) |
| "Is it trashed" checks outside the lock let Empty trash delete a restored note | DeepSeek | Every check runs under the note's lock (§5.6) |
| A folder deleted mid-listing, or one with only `meta.json`, fails the request | Muse, DeepSeek | Skipped; validity needs both files; `doctor` reports them (§5.6, §5.9) |
| The final rename of an upload can overwrite an existing PNG | GLM | `link`, which fails on `EEXIST`; new name on collision (§5.6) |
| `doctor` reports work in progress | Sonnet | Items under 60 s old are left out (§5.9) |
| `npm ci` needs a committed lockfile | DeepSeek | `package-lock.json` committed (§3, §10) |
| `npm run watch` doesn't copy pages or build the palette | Sonnet | `watch` does the full build first (§10) |
| A Secure cookie blocks plain-HTTP login on the same host | Sonnet | Caveat for the README's security notes (§5.8) |
| A caret pushed out of a whole-line hidden range could bounce back | GLM | Moves in its direction of travel (§7.6, §7.7) |

## Not adopted

| Claim | Raised by | Why not |
|---|---|---|
| The invariant filter would rewrite undo and redo (DeepSeek: blocker) | DeepSeek, Muse | CodeMirror's history dispatches undo and redo with `filter: false` (Sonnet read it in `@codemirror/commands` 6.11.1; Sol reproduced it), so no transaction filter sees them. The real consequence, the caret, is handled, and tests check exact restoration. |
| Joining a heading has two different rules | MiniMax | README §3.7's "never … if the line is a heading" means the line being joined. Backspace at the start of a plain line after a heading joins it into the heading, the same result as a selection delete. Both now use one join function, as suggested. |
| On a failed edit check, keep the old text and move the caret (Grok), or compare token sets before and after (MiniMax) | Grok, MiniMax | Superseded: edits are no longer checked, except joins, which keep README §3.7's own rule. |

## Owner decisions (2026-10-25)

Asked one at a time; every answer was the recommended option.

| Question | Decision |
|---|---|
| When should the popup dock on a touchscreen laptop? | When the selection is made by touch (or on screens ≤ 760 px) |
| Clicking a heading's own section color? | Does nothing |
| Popup focus and Enter before an arrow key? | Nothing focused; Enter edits the note |
| Enter inside a bare URL? | Two `[text](url)` links to the original address |
| An edit that leaves a space at the start of a heading's text? | The space is dropped |
| Typing a syntax character inside a token? | The token is split around it |
