# Code review, round 1

2026-10-25, of commit `ece70b0`. The same eight beta reviewers (see
[`architecture-r1.md`](architecture-r1.md)), at high reasoning. Each built and tested in its own
scratch copy on its own port. Fixes land as one commit per review; reproductions that hold up
become regression tests in `test/e2e/regressions.spec.ts`, the unit tests and the server tests.

## GPT-6.1 Sol — fix first (12 findings, all reproduced)

| # | Finding | Outcome |
|---|---|---|
| 1 | A late Trash or Delete-forever response closes whichever note is open by then | Fixed: close only if the navigation and the note are unchanged |
| 2 | New note leaves the old note editable while the POST is pending; typed text is lost | Fixed: read-only while creating; editability restored on failure |
| 3 | Empty trash counts the searched list but deletes the whole trash | Fixed: confirm with the unfiltered trash count |
| 4 | A delayed composition repair can change the next note | Fixed: the snapshot is bound to the note's state; a new composition cancels the timer |
| 5 | An older tag response overwrites newer tags; the next edit drops one | Fixed: per-note tag revisions; only the latest is applied |
| 6 | `margin-user` exits inside the lock callback and leaves `users.json.lock` | Fixed: errors thrown inside the lock are reported after it's released |
| 7 | B / U / color toggles are decided line by line after earlier lines changed | Fixed: decided once for the whole selection |
| 8 | Formatting part of a link is refused (contradicts §13) | Fixed: links are split at style boundaries before verification |
| 9 | Toggling the trash view during a note load leaves the editor read-only and loading | Fixed: every navigation cancels a pending load and restores editability |
| 10 | Any deletion ending at the caret is treated as one Backspace | Fixed: key-shaped only for at most one visible grapheme |
| 11 | Typing at a collapsed heading's end doesn't expand it (rename ran before the expansion) | Fixed: expansions apply before heading renames |
| 12 | Unwrapping a code block collapses the selection | Fixed: the selection is mapped through the fence removal; unit test corrected |

## Muse Wonder 1.0 — fix first (10 findings)

| # | Finding | Outcome |
|---|---|---|
| 1 | Empty trash count is the filtered list | Already fixed (Sol #3) |
| 2 | Failed `margin-user remove` leaves the lock | Already fixed (Sol #6) |
| 3 | Trash / Delete-forever completion closes another note | Already fixed (Sol #1) |
| 4 | A load superseded by the trash view leaves the editor read-only | Already fixed (Sol #9) |
| 5 | After Enter applies a popup option, the focus ring is lost and a second Enter replaces the selection | Fixed: the ring survives the popup's own formatting |
| 6 | Space and comma in the tag box add the highlighted suggestion | Fixed: only Enter takes the suggestion; space and comma add what was typed (README §3.13) |
| 7 | `margin-user add __proto__` reports success but stores nothing | Fixed: users are kept in a null-prototype object |
| 8 | Deleting a collapsed heading collapses the next section | Fixed: only edits that keep the heading prefix count as renames |
| 9 | Unwrapping a code block drops the selection | Already fixed (Sol #12) |
| 10 | A first-line heading doesn't get the title size | Not adopted: README §5.7 gives the title size to a plain first line only; the unused CSS rule was removed |

## Sonnet 5.5 — fix first (9 findings; ~100k fuzzed operations found nothing else)

| # | Finding | Outcome |
|---|---|---|
| 1 | Empty trash count is the filtered list | Already fixed (Sol #3) |
| 2 | `margin-user remove <unknown>` leaves the lock | Already fixed (Sol #6) |
| 3 | Deleting the space before a highlight lets a bare URL swallow it | Fixed: such a URL is written as an explicit `[url](url)` link, which looks the same and keeps both tokens |
| 4 | Multi-character deletes at the caret cut to one character | Already fixed (Sol #10) |
| 5 | A right-click applies a popup option; a mouseup outside the window leaves the popup hidden | Fixed: primary button only; `pointerup` and window blur also end the press |
| 6 | Piped `margin-user add` loses the second password line | Fixed: piped stdin is read once and handed out a line per prompt |
| 7 | The abandoned-login abort listens on the request (fires after the body), not the response | Fixed: it listens on the response's `close` |
| 8 | New note leaves the old note writable during the request | Already fixed (Sol #2) |
| 9 | Test gaps | Added: session renewal, expiry and on-disk hashing; 413 and 415; piped passwords; the earlier regressions |
