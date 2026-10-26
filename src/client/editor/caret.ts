// Caret rules (architecture §7.7, part 2), for transactions that change only the selection.

import { EditorSelection, EditorState, Transaction, type SelectionRange } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Hidden } from "../../shared/analysis.ts";
import { analysisField, bypass, composition, motion } from "./fields.ts";
import { renderField } from "./render.ts";

function strictlyInside(hidden: Hidden[], pos: number): Hidden | undefined {
  return hidden.find((h) => h.from < pos && pos < h.to);
}

/** Apply the caret rules to a selection; `pulled` says whether the outer-edge rule applies. */
export function fixSelection(state: EditorState, sel: EditorSelection, prevHead: number, pulled: boolean): EditorSelection {
  const { hidden } = state.field(renderField);
  const a = state.field(analysisField);
  let changed = false;
  const ranges = sel.ranges.map((r): SelectionRange => {
    if (r.empty) {
      let pos = r.head;
      const inside = strictlyInside(hidden, pos);
      if (inside) pos = pos >= prevHead ? inside.to : inside.from;
      if (pulled) {
        // A caret at the outer edge of a closing marker goes to its inner edge, so typing extends.
        const close = hidden.find((h) => h.kind === "close" && h.to === pos);
        if (close) pos = close.from;
      }
      const line = a.doc.lines[state.doc.lineAt(pos).number - 1];
      if (line?.kind === "heading" && pos === line.from) pos = line.from + line.prefixLen!;
      if (pos === r.head) return r;
      changed = true;
      return EditorSelection.cursor(pos, pos === r.head ? r.assoc : -1);
    }
    let { anchor, head } = r;
    const ia = strictlyInside(hidden, anchor);
    const ih = strictlyInside(hidden, head);
    if (ia) anchor = anchor <= head ? ia.from : ia.to;
    if (ih) head = head >= anchor ? ih.to : ih.from;
    if (anchor === r.anchor && head === r.head) return r;
    changed = true;
    return EditorSelection.range(anchor, head);
  });
  return changed ? EditorSelection.create(ranges, sel.mainIndex) : sel;
}

export const caretFilter = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection || tr.annotation(bypass) || composition.active) return tr;
  const pulled = tr.isUserEvent("select.pointer") || (tr.isUserEvent("select") && motion.label !== "");
  const fixed = fixSelection(tr.startState, tr.selection, tr.startState.selection.main.head, pulled);
  if (fixed === tr.selection) return tr;
  return {
    selection: fixed,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    annotations: tr.annotation(Transaction.userEvent) ? [Transaction.userEvent.of(tr.annotation(Transaction.userEvent)!)] : [],
  };
});

/** Undo and redo skip filters (they must restore text exactly); fix their selection afterwards. */
export const caretAfterHistory = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (!u.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return;
      const view = u.view;
      queueMicrotask(() => normalizeCaret(view));
    }
  },
);

/** Dispatch the caret rules once (after undo/redo, or on entering render mode). */
export function normalizeCaret(view: EditorView): void {
  if (!view.state.field(renderField, false)) return;
  const sel = view.state.selection;
  const fixed = fixSelection(view.state, sel, sel.main.head, false);
  if (fixed !== sel) {
    view.dispatch({ selection: fixed, annotations: [bypass.of(true), Transaction.addToHistory.of(false)] });
  }
}
