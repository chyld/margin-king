// Render-mode editing glue (architecture §7.7, parts 3 and 4): intent keys, motion wrappers, the
// invariant filter and composition repair. All edit logic lives in the engine.

import { ChangeSet, EditorSelection, EditorState, Prec, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";
import {
  cursorDocEnd,
  cursorDocStart,
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  cursorPageDown,
  cursorPageUp,
  selectDocEnd,
  selectDocStart,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  selectLineDown,
  selectLineEnd,
  selectLineStart,
  selectLineUp,
  selectPageDown,
  selectPageUp,
  standardKeymap,
} from "@codemirror/commands";
import { applyChanges, type Change } from "../../shared/model.ts";
import {
  backspace,
  copyText,
  del,
  deleteRange,
  deleteUnit,
  enter,
  graphemeCount,
  insertText,
  visibleSlice,
  makeCtx,
  transpose,
  type EditResult,
} from "./engine.ts";
import { bypass, collapsedField, composition, ctxOf, expandSections, motion, noteFacet, type NoteInfo } from "./fields.ts";

function specOf(r: EditResult, userEvent: string): TransactionSpec {
  return {
    changes: r.changes,
    selection: EditorSelection.single(r.anchor, r.head),
    effects: r.expand.length ? expandSections.of(r.expand) : [],
    annotations: [bypass.of(true), Transaction.userEvent.of(userEvent)],
    scrollIntoView: true,
  };
}

function run(view: EditorView, r: EditResult | null, userEvent: string): boolean {
  if (!r) return true;
  view.dispatch(specOf(r, userEvent));
  return true;
}

const withSelection =
  (fn: (view: EditorView, from: number, to: number) => boolean): Command =>
  (view) => {
    if (view.state.readOnly) return false;
    const { from, to } = view.state.selection.main;
    return fn(view, from, to);
  };

const cmdBackspace = withSelection((view, from, to) =>
  run(view, from === to ? backspace(ctxOf(view.state), from) : deleteRange(ctxOf(view.state), from, to), from === to ? "delete.backward" : "delete.selection"),
);
const cmdDelete = withSelection((view, from, to) =>
  run(view, from === to ? del(ctxOf(view.state), from) : deleteRange(ctxOf(view.state), from, to), from === to ? "delete.forward" : "delete.selection"),
);
const cmdEnter = withSelection((view, from, to) => run(view, enter(ctxOf(view.state), from, to), "input"));
const cmdSplitLine = withSelection((view, from, to) => run(view, enter(ctxOf(view.state), from, to, true), "input"));
const cmdTranspose = withSelection((view, from, to) => (from === to ? run(view, transpose(ctxOf(view.state), from), "move.character") : true));
const unit = (u: "word" | "line", dir: "backward" | "forward"): Command =>
  withSelection((view, from, to) =>
    run(view, from === to ? deleteUnit(ctxOf(view.state), from, u, dir) : deleteRange(ctxOf(view.state), from, to), dir === "backward" ? "delete.backward" : "delete.forward"),
  );

/** The intent keys (§7.6, item 2). Each runs the engine; none runs a CodeMirror command. */
export const intentKeymap: KeyBinding[] = [
  { key: "Backspace", run: cmdBackspace, shift: cmdBackspace },
  { key: "Delete", run: cmdDelete },
  { key: "Enter", run: cmdEnter, shift: cmdEnter },
  { key: "Mod-Backspace", mac: "Alt-Backspace", run: unit("word", "backward") },
  { key: "Mod-Delete", mac: "Alt-Delete", run: unit("word", "forward") },
  { mac: "Mod-Backspace", run: unit("line", "backward") },
  { mac: "Mod-Delete", run: unit("line", "forward") },
  { mac: "Ctrl-k", run: unit("line", "forward") },
  { mac: "Ctrl-d", run: cmdDelete },
  { mac: "Ctrl-h", run: cmdBackspace },
  { mac: "Ctrl-o", run: cmdSplitLine },
  { mac: "Ctrl-t", run: cmdTranspose },
];

// Motion wrappers (§7.6, item 3): the same commands, with their transactions labelled. Matched by
// identity (a minified build renames functions).
const VERTICAL = new Set<Command>([cursorLineUp, cursorLineDown, selectLineUp, selectLineDown, cursorPageUp, cursorPageDown, selectPageUp, selectPageDown]);
const BOUNDARY = new Set<Command>([
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  cursorDocStart,
  cursorDocEnd,
  selectDocStart,
  selectDocEnd,
  cursorLineStart,
  cursorLineEnd,
  selectLineStart,
  selectLineEnd,
]);

function labelled(cmd: Command | undefined, label: typeof motion.label): Command | undefined {
  if (!cmd) return undefined;
  return (view) => {
    motion.label = label;
    try {
      return cmd(view);
    } finally {
      motion.label = "";
    }
  };
}

function labelFor(cmd: Command | undefined): typeof motion.label {
  if (!cmd) return "";
  if (VERTICAL.has(cmd)) return "select.vertical";
  if (BOUNDARY.has(cmd)) return "select.lineboundary";
  return "";
}

export const motionKeymap: KeyBinding[] = standardKeymap
  .filter((b) => labelFor(b.run) !== "")
  .map((b) => ({ ...b, run: labelled(b.run, labelFor(b.run)), shift: labelled(b.shift, labelFor(b.shift) || labelFor(b.run)) }));

// ---------------------------------------------------------------------------------------------
// The invariant filter (§7.7, part 4)

interface RawChange {
  fromA: number;
  toA: number;
  text: string;
}

function rawChanges(tr: Transaction): RawChange[] {
  const out: RawChange[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => out.push({ fromA, toA, text: inserted.toString() }));
  return out;
}

function sameAsRaw(r: EditResult, raw: RawChange, tr: Transaction): boolean {
  if (r.changes.length !== 1 || r.expand.length) return false;
  const c = r.changes[0];
  if (c.from !== raw.fromA || c.to !== raw.toA || c.insert !== raw.text) return false;
  const head = tr.newSelection.main.head;
  return r.head === head && r.anchor === tr.newSelection.main.anchor;
}

function classify(state: EditorState, tr: Transaction, raw: RawChange): EditResult | null {
  const ctx = ctxOf(state);
  const sel = state.selection.main;
  const { fromA, toA, text } = raw;
  // Shaped like a key at the caret: at most one visible grapheme (plus hidden syntax) next to it.
  if (sel.empty && !text && graphemeCount(visibleSlice(ctx, fromA, toA)) <= 1) {
    if (toA === sel.head && fromA < toA) {
      const r = backspace(ctx, sel.head);
      if (r) return r;
    }
    if (fromA === sel.head && toA > fromA) {
      const r = del(ctx, sel.head);
      if (r) return r;
    }
  }
  if (sel.empty && text === "\n" && fromA === toA && fromA === sel.head) return enter(ctx, fromA, fromA);
  const paste = tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop");
  if (!text) return deleteRange(ctx, fromA, toA);
  return insertText(ctx, fromA, toA, text, paste ? "paste" : "type");
}

function dropSpecs(state: EditorState, tr: Transaction, raws: RawChange[]): TransactionSpec[] | null {
  const del_ = raws.find((r) => r.toA > r.fromA && !r.text);
  const ins = raws.find((r) => r.text && r.fromA === r.toA);
  if (!ins) return null;
  const ctx = ctxOf(state);
  if (!del_) {
    const r = insertText(ctx, ins.fromA, ins.fromA, ins.text, "paste");
    return [specOf(r, "input.drop")];
  }
  // A move: delete the source, then paste its copy form at the drop position mapped through that.
  const dragged = copyText(ctx, del_.fromA, del_.toA);
  const r1 = deleteRange(ctx, del_.fromA, del_.toA);
  const text2 = applyChanges(ctx.text, r1.changes);
  const ctx2 = makeCtx(text2, state.field(collapsedField));
  const dst = mapPos(ins.fromA, r1.changes, ctx.text.length);
  const r2 = insertText(ctx2, dst, dst, dragged, "paste");
  const insertedFrom = mapPos(dst, r2.changes, text2.length, -1);
  return [
    { changes: r1.changes, annotations: [bypass.of(true), Transaction.userEvent.of("move.drop")] },
    {
      changes: r2.changes,
      selection: EditorSelection.single(insertedFrom, r2.head),
      sequential: true,
      scrollIntoView: true,
    },
  ];
}

function mapPos(pos: number, changes: Change[], docLength: number, assoc = 1): number {
  return ChangeSet.of(changes, docLength).mapPos(pos, assoc);
}

export const invariantFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(bypass) || composition.active) return tr;
  if (!tr.annotation(Transaction.userEvent)) return tr;
  if (tr.isUserEvent("input.type.compose")) return tr;
  const state = tr.startState;
  const raws = rawChanges(tr);
  const userEvent = tr.annotation(Transaction.userEvent)!;
  if (tr.isUserEvent("move.drop") || tr.isUserEvent("input.drop")) {
    const specs = dropSpecs(state, tr, raws);
    if (specs) return specs;
  }
  if (tr.isUserEvent("move.character") && raws.length === 1) {
    const r = transpose(ctxOf(state), state.selection.main.head);
    return r ? specOf(r, userEvent) : [];
  }
  if (raws.length === 1) {
    const r = classify(state, tr, raws[0]);
    if (!r) return [];
    if (sameAsRaw(r, raws[0], tr)) return tr;
    return { ...specOf(r, userEvent), effects: [...(r.expand.length ? [expandSections.of(r.expand)] : []), ...tr.effects] };
  }
  // Several changes: handle them in document order, each against the result of the earlier ones,
  // its position mapped through what they changed (an edit can rewrite more than its own range).
  const specs: TransactionSpec[] = [];
  let ctx = ctxOf(state);
  let mapped = ChangeSet.empty(state.doc.length);
  let last: EditResult | null = null;
  for (const raw of raws) {
    const from = mapped.mapPos(raw.fromA, 1);
    const to = Math.max(from, mapped.mapPos(raw.toA, -1));
    const r = raw.text ? insertText(ctx, from, to, raw.text, "type") : deleteRange(ctx, from, to);
    specs.push({ changes: r.changes, sequential: specs.length > 0 });
    mapped = mapped.compose(ChangeSet.of(r.changes, ctx.text.length));
    ctx = makeCtx(applyChanges(ctx.text, r.changes), ctx.collapsed);
    last = r;
  }
  if (last) specs[specs.length - 1] = { ...specs[specs.length - 1], selection: EditorSelection.single(last.anchor, last.head) };
  specs[0] = { ...specs[0], annotations: [bypass.of(true), Transaction.userEvent.of(userEvent)] };
  return specs;
});

// ---------------------------------------------------------------------------------------------
// Composition (§7.7): pass through while composing, repair once at the end.

let snapshot: { text: string; head: number; note: NoteInfo } | null = null;
let repairTimer = 0;

/** The single change from a to b; `anchor` caps the common prefix (a composition starts at the caret). */
function singleDiff(a: string, b: string, anchor = Infinity): { from: number; to: number; insert: string } | null {
  if (a === b) return null;
  let pre = 0;
  const shorter = Math.min(a.length, b.length);
  const maxPre = Math.min(shorter, anchor);
  while (pre < maxPre && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < shorter - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { from: pre, to: a.length - suf, insert: b.slice(pre, b.length - suf) };
}

function repair(view: EditorView): void {
  const snap = snapshot;
  snapshot = null;
  if (!snap || view.composing) return;
  // The snapshot belongs to the state it was taken in; a newly opened note is left alone.
  if (view.state.facet(noteFacet) !== snap.note) return;
  const current = view.state.doc.toString();
  const d = singleDiff(snap.text, current, snap.head);
  if (!d) return;
  const ctx = makeCtx(snap.text, view.state.field(collapsedField));
  const r = d.insert ? insertText(ctx, d.from, d.to, d.insert, "type") : deleteRange(ctx, d.from, d.to);
  const wanted = applyChanges(snap.text, r.changes);
  if (wanted === current) return;
  const fix = singleDiff(current, wanted);
  if (!fix) return;
  view.dispatch({
    changes: fix,
    selection: EditorSelection.cursor(Math.min(r.head, wanted.length)),
    annotations: [bypass.of(true), Transaction.userEvent.of("input.type.compose")],
  });
}

export const compositionHandlers = EditorView.domEventHandlers({
  compositionstart(_e, view) {
    composition.active = true;
    if (repairTimer && snapshot && snapshot.note === view.state.facet(noteFacet)) {
      // A composition starting right after another: keep the earlier snapshot, so one repair at
      // the end covers both.
      window.clearTimeout(repairTimer);
      repairTimer = 0;
      return false;
    }
    window.clearTimeout(repairTimer);
    repairTimer = 0;
    snapshot = { text: view.state.doc.toString(), head: view.state.selection.main.head, note: view.state.facet(noteFacet) };
    return false;
  },
  compositionend(_e, view) {
    // CodeMirror may still apply the last DOM change after this event.
    repairTimer = window.setTimeout(() => {
      repairTimer = 0;
      composition.active = false;
      repair(view);
    }, 30);
    return false;
  },
});

export const renderKeymaps = [Prec.high(keymap.of(intentKeymap)), Prec.high(keymap.of(motionKeymap))];
