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

## GPT-6.1 Sol — fix first (3 findings)

| # | Finding | Outcome |
|---|---|---|
| 1 | Esc after an undo mid-drag restores the width from before the drag, so the display disagrees with the line | Fixed: the widget records the line's width on its element (`setLineWidth`), and a drag's end always goes back to that |
| 2 | A drag whose widget goes away (mode switch, undo removing the screenshot) leaks the Esc listener; lost capture leaves the preview stuck | Already fixed (Sonnet #3: one `AbortController`, `lostpointercapture`, idempotent end); a mode-switch test added |
| 3 | The live preview doesn't make CodeMirror re-measure, so the drawn caret lags behind the text | Fixed: each move requests a measure, and while a drag is on the content drops its `min-height` so a short note's height change is seen (CodeMirror only re-measures lines when the content height changes) |

## Muse Wonder 1.0 — fix first (3 findings)

| # | Finding | Outcome |
|---|---|---|
| 1 | A natural-size screenshot narrower than 10% of the column jumps to 10% on the first move, even when dragged left | Fixed: it stays at its natural size (the label shows its real share) and nothing is written until the pointer passes 10%. Testing it also showed the handle's hit area covering a small image entirely (Sonnet noted this too); the handle now straddles the image's right edge with its hit area reaching outward |
| 2 | A second finger or a stylus can start a competing drag on the same handle | Fixed: only a primary pointer starts a drag, and not while one is running (pointer ids were already checked, Sonnet #3) |
| 3 | Missing tests | Added: an image under 10%, the second of two images, an image in a colored section, a missing image, and engine tests with a sized screenshot line; redo and a mode switch mid-drag were already added |

## Kimi K3.1 Pro — fix first (2 findings)

| # | Finding | Outcome |
|---|---|---|
| 1 | On a phone the invisible handle can be dragged without the activating tap, and blocks scrolling | Already fixed (Sonnet #1); tested |
| 2 | A drag whose widget is destroyed (Ctrl+E, a note replaced) leaks the capture-phase Esc listener | Already fixed (Sonnet #3, tested with Sol #2). Kimi's suggested belt-and-braces added too: the widget's `destroy` ends any drag running on it, so the cleanup doesn't depend on a browser firing `lostpointercapture`; tested with an undo that removes the screenshot mid-drag |

## Grok 4.7 — fix first (2 findings, reviewed at `d7d46ee`)

| # | Finding | Outcome |
|---|---|---|
| 1 | The invisible handle resizes on a phone without a tap, and a swipe from it doesn't scroll | Already fixed (Sonnet #1): a hidden handle is `pointer-events: none`; tested with a finger drag before any tap |
| 2 | A drag that loses its widget (Ctrl+E, scrolled out, `editor.clear()`) swallows the next Esc | Already fixed (Sonnet #3, Kimi #2): `lostpointercapture` and the widget's `destroy` both end the drag; tested for a mode switch, a note switch and an undo |
