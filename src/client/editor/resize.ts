// Resizing a screenshot (owner decision, architecture §15): drag the handle on its right edge; the
// width is written into the line as `![60%](name.png)`, a share of the text column. The PNG never
// changes. Double-clicking the handle goes back to the natural size.

import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { imageLine, MAX_IMAGE_WIDTH, MIN_IMAGE_WIDTH } from "../../shared/syntax.ts";
import { analysisField, bypass } from "./fields.ts";

/** Shows a width on the image's wrapper: a share of the column, or the natural size. */
export function applyWidth(wrap: HTMLElement, width: number | null): void {
  wrap.style.width = width === null ? "" : `${width}%`;
  wrap.classList.toggle("is-sized", width !== null);
}

/** Writes the width into the screenshot line the wrapper shows: one undo step of its own. */
export function setImageWidth(view: EditorView, wrap: HTMLElement, width: number | null): void {
  if (view.state.readOnly) return;
  const pos = view.posAtDOM(wrap);
  const line = view.state.field(analysisField).doc.lines[view.state.doc.lineAt(pos).number - 1];
  const name = wrap.dataset.name;
  if (!name || line?.kind !== "image" || line.image !== name) return;
  const insert = imageLine(name, width);
  if (insert === line.text) return;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    annotations: [bypass.of(true), Transaction.userEvent.of("input.resize"), isolateHistory.of("full")],
  });
}

/** A drag on the handle: the image follows the pointer; letting go writes the width. Esc cancels. */
export function startResize(view: EditorView, wrap: HTMLElement, handle: HTMLElement, e: PointerEvent): void {
  if (e.button !== 0 || view.state.readOnly) return;
  const line = wrap.closest<HTMLElement>(".cm-line");
  if (!line) return;
  e.preventDefault();
  e.stopPropagation();
  const style = getComputedStyle(line);
  const column = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const startX = e.clientX;
  const startPx = wrap.getBoundingClientRect().width;
  const before = { width: wrap.style.width, sized: wrap.classList.contains("is-sized") };
  const clamp = (n: number) => Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, n));
  let width = clamp(Math.round((startPx / column) * 100));
  let moved = false;

  const label = document.createElement("span");
  label.className = "cm-shot-size";
  label.textContent = `${width}%`;
  wrap.appendChild(label);
  wrap.classList.add("is-resizing");
  handle.setPointerCapture(e.pointerId);

  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - startX) < 2) return;
    moved = true;
    width = clamp(Math.round(((startPx + ev.clientX - startX) / column) * 100));
    applyWidth(wrap, width);
    label.textContent = `${width}%`;
  };
  const finish = (commit: boolean) => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    label.remove();
    wrap.classList.remove("is-resizing");
    // Back to what the line says; a committed width comes back through the new line's widget.
    wrap.style.width = before.width;
    wrap.classList.toggle("is-sized", before.sized);
    if (commit && moved) setImageWidth(view, wrap, width);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    handle.releasePointerCapture(e.pointerId);
    finish(false);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}
