// Copy and cut in render mode (§7.9): partial lines as balanced syntax, whole lines raw.

import { EditorSelection, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { copyText, deleteRange } from "./engine.ts";
import { bypass, ctxOf } from "./fields.ts";

function write(e: ClipboardEvent, view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty || !e.clipboardData) return false;
  e.clipboardData.setData("text/plain", copyText(ctxOf(view.state), sel.from, sel.to));
  e.preventDefault();
  return true;
}

export const copyHandlers = EditorView.domEventHandlers({
  copy: (e, view) => write(e, view),
  cut(e, view) {
    if (!write(e, view)) return false;
    if (view.state.readOnly) return true;
    const sel = view.state.selection.main;
    const r = deleteRange(ctxOf(view.state), sel.from, sel.to);
    view.dispatch({
      changes: r.changes,
      selection: EditorSelection.cursor(r.head),
      annotations: [bypass.of(true), Transaction.userEvent.of("delete.cut")],
      scrollIntoView: true,
    });
    return true;
  },
});
