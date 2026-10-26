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
