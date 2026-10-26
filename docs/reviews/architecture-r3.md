# Architecture review, round 3

2026-10-25. The same eight reviewers (see [`architecture-r1.md`](architecture-r1.md)) reviewed the
whole of [`../architecture.md`](../architecture.md) at commit `0da9fc8`, at high reasoning,
read-only. They had both earlier logs, the round-2 diff and their own unresolved objections. Owner
decisions were marked final.

Verdicts: GLM "ready to build"; the other seven "needs another revision". None asked for a redesign.
Almost every finding was a precise gap in the edit engine's rule list (§7.7), plus three hardening
items: the CLI lock, cross-account screenshot caching, and navigation racing uploads. Sol reproduced
the lock race, the Ctrl+T transpose and the composition caret conflict in scratch tests. Nobody
contested a closed item.

## Adopted

| Finding | Raised by | Change (architecture §) |
|---|---|---|
| A replacement deletes the token or heading before the new text arrives (retyping a highlighted word or a heading's only word, a spellcheck suggestion) | Sonnet, Grok | `replaceRange`: the new text takes the first selected character's style (**owner**), and the clean-up runs on the final text (§7.7, §13) |
| Heading clean-up (leading space dropped, emptied heading → empty line) only applied to range deletions | Muse, GLM, Grok | One clean-up after every deletion or replacement, caret ones included (§7.7) |
| At the start of a heading's text, the heading and token rules both match | MiniMax, Grok | Rules listed by precedence; headings first (§7.7) |
| A caret can rest at either edge of a screenshot line; "↓ moves past it" was wrong | Sonnet, DeepSeek | Explicit Backspace, Delete, Enter and typing rules at both edges (§7.6, §7.7) |
| A typed `=` before a closing `==` moves the marker; highlight text can't end with `=` | Sonnet, Kimi | Any insertion that changes the line's tokens splits the token, and a run of `=` at the split becomes plain; formatting that needs it is refused (§6.3, §7.7, §12) |
| Pasting formatting inside a token read as nesting; two paste rules disagreed; multi-line paste ambiguous | MiniMax, Kimi | One paste pipeline: line breaks as Enter; syntax segments raw at the top level, the token closed and reopened around them (§7.7) |
| Pasting a URL over a selection had no operation | MiniMax | §6.4 operation, verified, both modes (§6.4, §7.9) |
| Word and line-boundary deletion had no engine function; CodeMirror's commands delete markers | MiniMax, DeepSeek | `deleteUnit` over visible text; intent keys never run CodeMirror commands (§7.6, §7.7) |
| Caret and invariant filters had no order (CodeMirror runs filters in reverse registration) | MiniMax | They no longer overlap: caret rules only for selection-only transactions, the engine sets the caret for edits (§7.7) |
| Motion wrappers missing from the keymap list; Cmd+Arrow, Ctrl+Arrow and Emacs keys not covered | MiniMax, Grok | A wrapper for every vertical, page, line-boundary and document-boundary binding (§7.6) |
| Drag-and-drop is one transaction with two changes | Muse, Grok, Kimi | Whole-transaction classification; `drop` = delete, then paste the copy form at the mapped position (§7.7) |
| Other multi-change transactions undefined | Muse | Handled in document order, each mapped through earlier results, combined into one change set (§7.7) |
| A drag selection ending at a closing marker hit two contradictory caret rules | Muse | The pull-inside rule is for empty carets only (§7.7) |
| Collapsed section: selection from mid-heading through the ⋯ pill | Muse | Hidden content inside a selection goes with it; only a unit deletion from an empty caret expands (§7.6, §7.7) |
| "Always join if either line is empty" vs "never with a fence/screenshot/heading" | Grok, DeepSeek | An empty line is simply removed; refusals apply when both lines have text (§7.7) |
| A range deletion could join a line onto a fence, screenshot or heading lying outside the range | DeepSeek | The caret join rule applies to range joins; a joined heading loses its prefix (§12.2) (§7.7) |
| Fence lines had no edit rules | GLM, DeepSeek | Fence and code lines edit as literal text (§7.7) |
| Tab indents fence lines and breaks the block | Grok | Tab indents `code` lines only (§7.6) |
| macOS Ctrl+T moves hidden characters | Sol (reproduced) | `transpose` swaps visible graphemes; `move.character` classified (§7.6, §7.7) |
| macOS Ctrl+O isn't Enter | Kimi | `splitLine` leaves the caret before the break (§7.7) |
| Caret rules still run during composition | Sol (reproduced) | Both filters suspended; corrections run together when it ends (§7.7) |
| Untouched-token rule ambiguous at a token's visible edge | DeepSeek | Surviving tokens with unchanged style keep their marker bytes whatever their text (§6.3) |
| Formatting across code, fence and screenshot lines; Section on a fence or screenshot | Muse, Sonnet, DeepSeek | Those lines are skipped; Section disabled on them (§6.4) |
| Copying part of a code line produced inline code | DeepSeek | Code, fence and screenshot lines copy raw (§7.9) |
| The pending-uploads field held one upload | Muse, Kimi | One entry per upload id (§7.9) |
| An upload finishing while another note loads inserts into the old state | Sol, Kimi | Insert only for the same note, same navigation generation, editable; navigating away cancels entries (§7.1, §7.9) |
| Home or logout didn't invalidate a pending note load | Sol | One navigation generation for every navigation (§7.1) |
| A failed newer search let an older response win | Kimi | Apply only the response to the latest request issued (§7.1) |
| Tag box: tags already on the note, and Enter taking the highlighted first entry | DeepSeek | §7.1 |
| Year-long screenshot caching can show one user's image to another in the same browser | Sol | `private, no-cache` + ETag; session checked before any 304 (§5.2, §5.5) |
| HEAD needed `X-Margin` | Kimi | GET and HEAD exempt (§5.3) |
| `POST /api/notes` didn't validate tags | MiniMax, GLM | Same check as the tags route (§5.5) |
| One bad tag hid a whole note | Sonnet | Invalid tag entries are ignored and reported by `doctor` (§5.6, §5.9) |
| Reclaiming a stale CLI lock by path is racy (reproduced); a lock is visible before its contents; a recreated container's lock never clears | Sol, Muse, DeepSeek, Grok, MiniMax | **Owner**: never reclaim; after 10 s stop with instructions; empty or unreadable lock = held; `doctor` reports leftover locks (§5.9, §13) |
| Corrupt `users.json` undefined | Sonnet | The CLI stops without writing; the server keeps its last good copy, and exits at startup (§5.9) |
| The CLI's data folder unstated | MiniMax | Uses `DATA_DIR` like the server (§5.9) |
| Upload racing Delete forever gave a 500 | Muse | `ENOENT` after the first check → 404 (§5.6) |
| `link()` isn't supported on every filesystem | Sonnet | Check, then rename, under the note's lock (§4, §5.6) |
| Renames weren't durable across a power cut | Muse | `fsync` the folder after each rename (§5.6) |
| Shutdown could outlast Docker's stop timeout | Sonnet | Up to 20 s in the server, `stop_grace_period: 30s` in compose (§5.1, §10) |
| A plain `import` of a type fails under Node's type stripping | Sonnet | `verbatimModuleSyntax` and `import type` (§2) |
| Identical heading texts share a collapsed state | GLM | Kept: README §3.8 keys by exact text; recorded in §13 (§7.6) |

## Not adopted

| Claim | Raised by | Why not |
|---|---|---|
| Reclaim a lock from another host automatically | Grok | A reviewer reproduced that path-based reclaiming loses changes; the owner chose to stop with instructions. |
| Publish the lock atomically with `link` | Muse, DeepSeek | With no reclaiming, a half-written lock is only ever read for the error message; and `link` isn't available everywhere. |
| Key collapsed sections by position | GLM | README §3.8 keys them by the heading line's exact text. |

## Owner decisions (2026-10-25)

| Question | Decision |
|---|---|
| A leftover CLI lock whose owner is gone? | Stop with instructions; never reclaim automatically |
| Typing over a selection of formatted text? | Keeps the formatting of the first selected character |
