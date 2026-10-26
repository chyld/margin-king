// Editor state shared by the editor's extensions: the analysis, collapsed sections, annotations.

import { Annotation, Facet, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { analyze, type Analysis } from "../../shared/analysis.ts";
import { matchHeading } from "../../shared/syntax.ts";
import type { Ctx } from "./engine.ts";

/** Margin's own transactions: the invariant filter and the caret rules leave them alone. */
export const bypass = Annotation.define<boolean>();

/** The parsed document (both modes). Recomputed when the document changes, not when the caret moves. */
export const analysisField = StateField.define<Analysis>({
  create: (state) => analyze(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? analyze(tr.newDoc.toString()) : value),
});

export const toggleSection = StateEffect.define<string>();
export const expandSections = StateEffect.define<readonly string[]>();
export const setCollapsed = StateEffect.define<ReadonlySet<string>>();

/**
 * Collapsed sections, by heading-line text (README §3.8). Editing a collapsed heading's text keeps
 * it collapsed: the new text replaces the old (the old stays if another heading still has it).
 */
export const collapsedField = StateField.define<ReadonlySet<string>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value;
    const edit = (fn: (s: Set<string>) => void) => {
      const copy = new Set(next);
      fn(copy);
      next = copy;
    };
    // Expansions name sections by their text before this transaction's edits: apply them first.
    for (const e of tr.effects) if (e.is(expandSections)) edit((s) => e.value.forEach((k) => s.delete(k)));
    if (tr.docChanged && next.size) {
      const old = tr.startState.field(analysisField);
      const renames: [string, string][] = [];
      for (const line of old.doc.lines) {
        if (line.kind !== "heading" || !next.has(line.text)) continue;
        const touched = tr.changes.touchesRange(line.from, line.to);
        if (!touched) continue;
        // The prefix must survive: deleting or replacing the heading line isn't a rename.
        if (tr.changes.touchesRange(line.from, line.from + line.prefixLen!)) continue;
        const pos = tr.changes.mapPos(line.from, 1);
        const newLine = tr.newDoc.lineAt(Math.min(pos, tr.newDoc.length));
        if (newLine.text !== line.text && matchHeading(newLine.text)) renames.push([line.text, newLine.text]);
      }
      if (renames.length) {
        const newText = tr.newDoc.toString();
        edit((s) => {
          for (const [from, to] of renames) {
            s.add(to);
            const stillThere = newText.split("\n").includes(from);
            if (!stillThere) s.delete(from);
          }
        });
      }
    }
    for (const e of tr.effects) {
      if (e.is(setCollapsed)) next = new Set(e.value);
      else if (e.is(toggleSection)) edit((s) => (s.has(e.value) ? s.delete(e.value) : s.add(e.value)));
    }
    return next;
  },
});

/** What the editor knows about the open note, for widgets and uploads. */
export interface NoteInfo {
  id: string;
  generation: number;
}

export const noteFacet = Facet.define<NoteInfo, NoteInfo>({
  combine: (values) => values[0] ?? { id: "", generation: 0 },
});

/** The engine's view of a state. */
export function ctxOf(state: EditorState): Ctx {
  const a = state.field(analysisField);
  return { text: a.text, a, collapsed: state.field(collapsedField) };
}

/** Set while an input method is composing (both filters let changes through). */
export const composition = { active: false };

/** The label of the motion command being run by a Margin motion wrapper (caret rules read it). */
export const motion = { label: "" as "" | "select.vertical" | "select.lineboundary" };
