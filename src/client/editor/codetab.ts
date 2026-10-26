// Tab / Shift+Tab in code blocks (README §3.7): indent or outdent the selected code lines by two
// spaces, skipping fence lines. Elsewhere Tab moves focus as usual.

import { Transaction, type ChangeSpec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { analysisField, bypass } from "./fields.ts";

function codeLines(view: EditorView): number[] | null {
  const a = view.state.field(analysisField);
  const sel = view.state.selection.main;
  const first = view.state.doc.lineAt(sel.from).number - 1;
  const last = view.state.doc.lineAt(sel.to).number - 1;
  const out: number[] = [];
  for (let i = first; i <= last; i++) {
    const kind = a.doc.lines[i].kind;
    if (kind === "code") out.push(i);
    else if (kind !== "fence-open" && kind !== "fence-close") return null;
  }
  return out.length ? out : null;
}

function shift(view: EditorView, dir: 1 | -1): boolean {
  if (view.state.readOnly) return false;
  const lines = codeLines(view);
  if (!lines) return false;
  const a = view.state.field(analysisField);
  const changes: ChangeSpec[] = lines.flatMap((i): ChangeSpec[] => {
    const line = a.doc.lines[i];
    if (dir > 0) return [{ from: line.from, insert: "  " }];
    const n = /^ {0,2}/.exec(line.text)![0].length;
    return n ? [{ from: line.from, to: line.from + n }] : [];
  });
  if (changes.length) view.dispatch({ changes, annotations: [bypass.of(true), Transaction.userEvent.of(dir > 0 ? "input.indent" : "delete.dedent")] });
  return true;
}

export const codeTabKeymap = keymap.of([{ key: "Tab", run: (v) => shift(v, 1), shift: (v) => shift(v, -1) }]);
