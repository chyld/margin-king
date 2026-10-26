# Code review: resizing screenshots (round 1)

Commit reviewed: `d7d46ee` (the owner's resize feature, architecture §15). One commit per review.

## Sonnet 5.5 — fix first (6 findings)

| # | Finding | Outcome |
|---|---|---|
| 1 | On touch screens the invisible handle still catches touches: a swipe from it doesn't scroll, and a flick resizes without a tap first | Fixed: a hidden handle has `pointer-events: none`; it only takes touches once the image is tapped (or hovered with a mouse) |
| 2 | A 2–3px jiggle (or a tap on a touch screen) writes a width | Fixed: a drag only counts past 3px with a mouse and 8px with a finger, measured at release |
| 3 | A drag whose widget goes away (note switch, scrolled out) leaks a capture-phase Esc listener | Fixed: listeners live on `window` under one `AbortController`; `lostpointercapture` (fired at the document when the handle is removed) ends the drag without writing |
| 4 | Double-click to reset may never fire on iOS | Fixed: a double tap on the handle is counted directly on touch screens |
| 5 | Missing tests | Added: hidden handle ignores a finger, jiggle, interrupted drag, redo, phone double tap; the phone drag now checks the exact width |
| 6 | Ctrl+Shift+Z empties the document | Not a defect: Playwright's `Control+Shift+z` sends a lowercase `z` with Shift, which CodeMirror reads as Ctrl+Z (undo). A real keyboard sends `Z`, and redo works (now tested). The text went away because the extra undo also undid the test's own programmatic setup; an opened note starts a fresh history, so its loaded text can't be undone |
