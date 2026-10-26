// Render mode (architecture §7.6): decorations, hidden ranges and the atomic ranges built from them.

import { RangeSet, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { foldRanges, hiddenRanges, type Hidden } from "../../shared/analysis.ts";
import type { Line, Token } from "../../shared/syntax.ts";
import { analysisField, collapsedField } from "./fields.ts";
import { CopyWidget, EllipsisWidget, EofWidget, FoldWidget, ImageWidget } from "./widgets.ts";

export interface RenderData {
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
  hidden: Hidden[];
  /** Fence lines a caret is on (they're shown). */
  caretFences: string;
}

const hide = Decoration.replace({});

function caretFenceLines(state: EditorState): Set<number> {
  const a = state.field(analysisField);
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const from = state.doc.lineAt(r.from).number - 1;
    const to = state.doc.lineAt(r.to).number - 1;
    for (let i = from; i <= to; i++) {
      const k = a.doc.lines[i]?.kind;
      if (k === "fence-open" || k === "fence-close") out.add(i);
    }
  }
  return out;
}

function inlineMarks(tokens: Token[], base: number, inHeading: boolean, out: Range<Decoration>[], inHl = false): void {
  for (const t of tokens) {
    const a = base + t.contentFrom;
    const b = base + t.contentTo;
    if (t.type === "hl") {
      const cls = ["cm-hl"];
      if (t.opts!.color && !inHeading) cls.push("cm-hl-color", `hl-${t.opts!.color}`);
      if (t.opts!.b) cls.push("cm-hl-b");
      if (t.opts!.u) cls.push("cm-hl-u");
      if (a < b) out.push(Decoration.mark({ class: cls.join(" ") }).range(a, b));
      inlineMarks(t.children ?? [], base, inHeading, out, true);
    } else if (t.type === "code") {
      if (a < b) out.push(Decoration.mark({ class: inHl ? "cm-code cm-code-inhl" : "cm-code" }).range(a, b));
    } else if (a < b) {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      out.push(
        Decoration.mark({
          class: "cm-link",
          attributes: { title: `${t.url} · ${mac ? "Cmd" : "Ctrl"}+click to open`, "data-url": t.url! },
        }).range(a, b),
      );
    }
  }
}

function build(state: EditorState): RenderData {
  const a = state.field(analysisField);
  const collapsed = state.field(collapsedField);
  const fences = caretFenceLines(state);
  const hidden = hiddenRanges(a, collapsed, fences);
  const folds = foldRanges(a, collapsed);
  const decos: Range<Decoration>[] = [];
  const foldByHeading = new Map(folds.map((f) => [f.heading, f]));
  const lines = a.doc.lines;
  let skipUntil = -1;

  for (const line of lines) {
    if (line.index <= skipUntil) continue;
    const section = line.section !== undefined ? a.doc.sections[line.section] : undefined;
    const lineClasses: string[] = [];
    if (line.index === 0 && line.kind === "text" && line.text.trim()) lineClasses.push("cm-title");
    if (section && line.kind !== "heading") lineClasses.push("cm-sec", `sec-${section.color}`);
    switch (line.kind) {
      case "heading": {
        lineClasses.push("cm-heading", `sec-${line.color}`);
        const fold = foldByHeading.get(line.index);
        const key = line.text;
        decos.push(
          Decoration.replace({ widget: new FoldWidget(key, collapsed.has(key) && !!fold) }).range(line.from, line.from + line.prefixLen!),
        );
        inlineMarks(a.tokens[line.index], line.from, true, decos);
        if (fold) {
          decos.push(Decoration.replace({ widget: new EllipsisWidget(key) }).range(fold.from, fold.to));
          skipUntil = section!.end;
        }
        break;
      }
      case "text":
        inlineMarks(a.tokens[line.index], line.from, false, decos);
        break;
      case "fence-open":
      case "fence-close": {
        lineClasses.push("cm-cb", line.kind === "fence-open" ? "cm-cb-open" : "cm-cb-close");
        if (!fences.has(line.index)) lineClasses.push("cm-fence-hidden");
        if (line.kind === "fence-open") decos.push(Decoration.widget({ widget: new CopyWidget(line.block!), side: -1 }).range(line.from));
        break;
      }
      case "code":
        lineClasses.push("cm-cb", "cm-cb-body");
        break;
      case "image":
        lineClasses.push("cm-shot-line");
        decos.push(Decoration.replace({ widget: new ImageWidget(line.image!) }).range(line.from, line.to));
        break;
    }
    if (lineClasses.length) decos.push(Decoration.line({ class: lineClasses.join(" ") }).range(line.from));
  }
  for (const h of hidden) {
    if (h.kind === "open" || h.kind === "close" || h.kind === "fence") {
      if (h.from < h.to) decos.push(hide.range(h.from, h.to));
    }
  }
  const atomic = RangeSet.of(
    hidden.filter((h) => h.from < h.to).map((h) => hide.range(h.from, h.to)),
    true,
  );
  return { decorations: Decoration.set(decos, true), atomic, hidden, caretFences: [...fences].join(",") };
}

export const renderField = StateField.define<RenderData>({
  create: build,
  update(value, tr) {
    const collapsedChanged = tr.startState.field(collapsedField) !== tr.state.field(collapsedField);
    if (tr.docChanged || collapsedChanged) return build(tr.state);
    if (tr.selection && [...caretFenceLines(tr.state)].join(",") !== value.caretFences) return build(tr.state);
    return value;
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).atomic)],
});

/** The end-of-file marker, in both modes. */
export const eofField = StateField.define<DecorationSet>({
  create: (state) => Decoration.set([Decoration.widget({ widget: new EofWidget(), side: 1, block: true }).range(state.doc.length)]),
  update: (value, tr) =>
    tr.docChanged ? Decoration.set([Decoration.widget({ widget: new EofWidget(), side: 1, block: true }).range(tr.newDoc.length)]) : value,
  provide: (f) => EditorView.decorations.from(f),
});

export function lineOf(state: EditorState, pos: number): Line {
  const a = state.field(analysisField);
  return a.doc.lines[state.doc.lineAt(pos).number - 1];
}
