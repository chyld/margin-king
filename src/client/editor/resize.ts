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

/** The width the line says (set by the widget), shown; a drag's preview goes back to it. */
export function setLineWidth(wrap: HTMLElement, width: number | null): void {
  wrap.dataset.width = width === null ? "" : String(width);
  applyWidth(wrap, width);
}

function lineWidth(wrap: HTMLElement): number | null {
  return wrap.dataset.width ? Number(wrap.dataset.width) : null;
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

/** When each screenshot's handle was last tapped (touch screens have no reliable dblclick). */
const lastTap = new WeakMap<HTMLElement, number>();

/** How to end the drag running on each screenshot, so the widget can end it when it goes away. */
const running = new WeakMap<HTMLElement, () => void>();

/** Ends a drag on this screenshot without writing (the widget is being removed). */
export function cancelResize(wrap: HTMLElement): void {
  running.get(wrap)?.();
}

/**
 * A drag on the handle: the image follows the pointer; letting go writes the width. Esc cancels.
 * Moves under a few pixels (more for a finger) don't count, so a tap or a jiggle writes nothing; a
 * double tap (two taps, no drag between) on a touch screen goes back to the natural size. If the widget goes away mid-drag (a
 * note switch, or scrolled out of the rendered range), the drag ends without writing.
 */
export function startResize(view: EditorView, wrap: HTMLElement, handle: HTMLElement, e: PointerEvent): void {
  // One drag at a time: a second finger or a stylus on the same handle doesn't start another.
  if (e.button !== 0 || !e.isPrimary || view.state.readOnly || wrap.classList.contains("is-resizing")) return;
  const line = wrap.closest<HTMLElement>(".cm-line");
  if (!line) return;
  e.preventDefault();
  e.stopPropagation();
  const touch = e.pointerType !== "mouse";
  const threshold = touch ? 8 : 5;
  const style = getComputedStyle(line);
  const column = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const startX = e.clientX;
  const startPx = wrap.getBoundingClientRect().width;
  const clamp = (n: number) => Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, n));
  // A natural-size screenshot can be narrower than the smallest width: it stays as it is (and
  // nothing is written) until it's dragged past that, rather than jumping to it.
  const startPct = (startPx / column) * 100;
  const below = (pct: number) => pct < MIN_IMAGE_WIDTH && startPct < MIN_IMAGE_WIDTH;
  let width: number | null = below(startPct) ? null : clamp(Math.round(startPct));
  let dx = 0;
  let moved = false;

  const label = document.createElement("span");
  label.className = "cm-shot-size";
  label.textContent = `${width ?? Math.max(1, Math.round(startPct))}%`;
  wrap.appendChild(label);
  wrap.classList.add("is-resizing");
  handle.setPointerCapture(e.pointerId);

  const done = new AbortController();
  const finish = (commit: boolean) => {
    if (done.signal.aborted) return;
    done.abort();
    running.delete(wrap);
    label.remove();
    wrap.classList.remove("is-resizing");
    // Back to what the line says now (an undo mid-drag may have changed it); a committed width
    // comes back through the new line's widget.
    applyWidth(wrap, lineWidth(wrap));
    view.requestMeasure();
    if (!commit || !wrap.isConnected) return;
    if (moved) {
      // A drag is never half of a double tap.
      lastTap.delete(wrap);
      // Back where it started, or a natural-size screenshot left at its own size: nothing to write.
      const unchanged = Math.abs(dx) < threshold || width === null || (lineWidth(wrap) === null && width === Math.round(startPct));
      if (!unchanged) setImageWidth(view, wrap, width);
    } else if (touch) {
      const now = performance.now();
      if (now - (lastTap.get(wrap) ?? -Infinity) < 400) {
        lastTap.delete(wrap);
        setImageWidth(view, wrap, null);
      } else {
        lastTap.set(wrap, now);
      }
    }
  };
  running.set(wrap, () => finish(false));
  const mine = (ev: PointerEvent) => ev.pointerId === e.pointerId;
  const opts = { signal: done.signal, capture: true };
  const follow = (ev: PointerEvent) => {
    dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < threshold) return;
    moved = true;
    const pct = Math.round(((startPx + dx) / column) * 100);
    width = below(pct) ? null : clamp(pct);
    applyWidth(wrap, width ?? lineWidth(wrap));
    // Below 10% the image can't follow, but the label does, so the drag visibly counts.
    label.textContent = `${width ?? Math.max(1, pct)}%`;
    // The lines below move: CodeMirror's height map and drawn caret follow.
    view.requestMeasure();
  };
  window.addEventListener("pointermove", (ev) => mine(ev) && follow(ev), opts);
  // Where the pointer is released counts, even if the browser coalesced the last move away.
  window.addEventListener(
    "pointerup",
    (ev) => {
      if (!mine(ev)) return;
      follow(ev);
      finish(true);
    },
    opts,
  );
  window.addEventListener("pointercancel", (ev) => mine(ev) && finish(false), opts);
  // Fired at the document when the handle is removed while it holds the capture.
  document.addEventListener("lostpointercapture", (ev) => mine(ev) && finish(false), opts);
  window.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    },
    opts,
  );
}
