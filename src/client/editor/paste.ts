// Paste (architecture §7.9): screenshots, a URL over a selection, and text.

import { EditorSelection, Facet, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyFormat } from "../../shared/ops.ts";
import { LINK_URL_RE } from "../../shared/rules.ts";
import { insertScreenshot, insertScreenshotRaw } from "./engine.ts";
import { analysisField, bypass, ctxOf, expandSections, noteFacet } from "./fields.ts";
import { renderField } from "./render.ts";

export interface PasteHost {
  upload(noteId: string, file: File): Promise<string>;
  toast(message: string, error?: boolean): void;
  /** The current navigation generation (§7.1). */
  generation(): number;
}

export const pasteHost = Facet.define<PasteHost, PasteHost | null>({ combine: (v) => v[0] ?? null });

const addUpload = StateEffect.define<{ id: string; pos: number }>();
const removeUpload = StateEffect.define<string>();

/** Pending uploads in this note's state: their positions follow every change. */
export const uploadsField = StateField.define<ReadonlyMap<string, number>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.size) {
      next = new Map([...value].map(([id, pos]) => [id, tr.changes.mapPos(pos, 1)]));
    }
    for (const e of tr.effects) {
      if (e.is(addUpload)) next = new Map(next).set(e.value.id, e.value.pos);
      else if (e.is(removeUpload)) {
        const m = new Map(next);
        m.delete(e.value);
        next = m;
      }
    }
    return next;
  },
});

let uploadSeq = 0;

async function uploadScreenshot(view: EditorView, file: File, host: PasteHost): Promise<void> {
  const note = view.state.facet(noteFacet);
  const id = `u${++uploadSeq}`;
  view.dispatch({ effects: addUpload.of({ id, pos: view.state.selection.main.head }), annotations: bypass.of(true) });
  host.toast("Uploading screenshot…");
  let name: string;
  try {
    name = await host.upload(note.id, file);
  } catch (err) {
    if (view.state.field(uploadsField, false)?.has(id)) view.dispatch({ effects: removeUpload.of(id), annotations: bypass.of(true) });
    host.toast((err as Error).message || "The screenshot couldn't be uploaded", true);
    return;
  }
  // Insert only into the same note, from the same navigation, still editable (§7.9).
  const pos = view.state.field(uploadsField, false)?.get(id);
  const now = view.state.facet(noteFacet);
  if (pos === undefined || now.id !== note.id || now.generation !== host.generation() || view.state.readOnly) return;
  const rendered = !!view.state.field(renderField, false);
  const r = rendered ? insertScreenshot(ctxOf(view.state), pos, name) : insertScreenshotRaw(ctxOf(view.state), pos, name);
  view.dispatch({
    changes: r.changes,
    selection: EditorSelection.cursor(r.head),
    effects: [removeUpload.of(id), ...(r.expand.length ? [expandSections.of(r.expand)] : [])],
    annotations: [bypass.of(true), Transaction.userEvent.of("input.paste")],
    scrollIntoView: true,
  });
}

export const pasteHandlers = EditorView.domEventHandlers({
  paste(e, view) {
    if (view.state.readOnly) return true;
    const data = e.clipboardData;
    if (!data) return false;
    const host = view.state.facet(pasteHost);
    if (data.files.length) {
      e.preventDefault();
      const file = data.files[0];
      if (file.type !== "image/png") host?.toast("Only PNG screenshots are allowed", true);
      else if (host) void uploadScreenshot(view, file, host);
      return true;
    }
    const text = data.getData("text/plain").trim();
    const sel = view.state.selection.main;
    if (!sel.empty && LINK_URL_RE.test(text) && view.state.doc.lineAt(sel.from).number === view.state.doc.lineAt(sel.to).number) {
      const a = view.state.field(analysisField);
      const r = applyFormat({ text: a.text, a }, sel.from, sel.to, { type: "link", url: text });
      if (r.ok) {
        e.preventDefault();
        view.dispatch({
          changes: r.changes,
          selection: EditorSelection.single(r.anchor, r.head),
          annotations: [bypass.of(true), Transaction.userEvent.of("input.paste")],
        });
        return true;
      }
    }
    return false;
  },
});
