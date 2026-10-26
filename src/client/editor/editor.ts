// The note editor (architecture §7.6): one EditorView for the app's lifetime; a new EditorState per
// opened note (which resets undo history).

import { Compartment, EditorState, Prec, Transaction, type Extension, type Text } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands";
import { onFontsChange } from "../fonts.ts";
import { caretAfterHistory, caretFilter, normalizeCaret } from "./caret.ts";
import { codeTabKeymap } from "./codetab.ts";
import { copyHandlers } from "./copy.ts";
import { analysisField, collapsedField, noteFacet } from "./fields.ts";
import { compositionHandlers, invariantFilter, renderKeymaps } from "./guard.ts";
import { linkChip, linkClicks, modifierClass } from "./links.ts";
import { pasteHandlers, pasteHost, uploadsField, type PasteHost } from "./paste.ts";
import { formatBarOpen, popupHost, popupKeymap, popupPlugin, setFormatBar, type PopupHost } from "./popup.ts";
import { eofField, renderField } from "./render.ts";

export type Mode = "render" | "raw";
export type Font = "mono" | "prop";

export interface EditorHost extends PasteHost, PopupHost {
  onDocChanged(): void;
  onCollapsedChanged(noteId: string, keys: string[]): void;
}

export interface OpenOptions {
  id: string;
  text: string;
  generation: number;
  readOnly: boolean;
  collapsed: string[];
}

const plainEnter = Prec.high(keymap.of([{ key: "Enter", run: insertNewline, shift: insertNewline }]));
const baseKeys = keymap.of([...standardKeymap.filter((b) => b.key !== "Enter"), ...historyKeymap]);

function modeExtension(mode: Mode): Extension {
  if (mode === "raw") return [plainEnter, EditorView.editorAttributes.of({ class: "mode-raw" })];
  return [
    renderField,
    caretFilter,
    invariantFilter,
    caretAfterHistory,
    compositionHandlers,
    copyHandlers,
    ...renderKeymaps,
    EditorView.editorAttributes.of({ class: "mode-render" }),
  ];
}

function readOnlyExtension(ro: boolean): Extension {
  return [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];
}

function fontExtension(font: Font): Extension {
  return EditorView.editorAttributes.of({ class: font === "prop" ? "font-prop" : "font-mono" });
}

export class Editor {
  view: EditorView;
  mode: Mode;
  font: Font;
  private host: EditorHost;
  private modeComp = new Compartment();
  private roComp = new Compartment();
  private fontComp = new Compartment();
  private noteId = "";

  constructor(parent: HTMLElement, host: EditorHost, mode: Mode, font: Font) {
    this.host = host;
    this.mode = mode;
    this.font = font;
    this.view = new EditorView({ parent, state: this.makeState({ id: "", text: "", generation: 0, readOnly: true, collapsed: [] }) });
    // When the font list arrives or a font finishes loading, text widths change. CodeMirror only
    // re-measures for fonts once, when it's created, and a width change that keeps the line heights
    // doesn't redraw the caret or selection; setting the selection again does (architecture §15).
    onFontsChange(() => {
      if (this.view.composing) return;
      this.view.requestMeasure();
      this.view.dispatch({ selection: this.view.state.selection, annotations: Transaction.addToHistory.of(false) });
    });
  }

  private makeState(o: OpenOptions): EditorState {
    this.noteId = o.id;
    return EditorState.create({
      doc: o.text,
      extensions: [
        noteFacet.of({ id: o.id, generation: o.generation }),
        pasteHost.of(this.host),
        popupHost.of(this.host),
        analysisField,
        collapsedField.init(() => new Set(o.collapsed)),
        uploadsField,
        eofField,
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "off", "aria-label": "Note" }),
        popupKeymap,
        this.modeComp.of(modeExtension(this.mode)),
        Prec.high(codeTabKeymap),
        baseKeys,
        popupPlugin,
        linkClicks,
        modifierClass,
        linkChip,
        pasteHandlers,
        this.roComp.of(readOnlyExtension(o.readOnly)),
        this.fontComp.of(fontExtension(this.font)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) this.host.onDocChanged();
          const before = u.startState.field(collapsedField, false);
          const after = u.state.field(collapsedField, false);
          if (after && before !== after && this.noteId) this.host.onCollapsedChanged(this.noteId, [...after]);
        }),
      ],
    });
  }

  open(o: OpenOptions): void {
    setFormatBar(this.view, false);
    this.view.setState(this.makeState(o));
    this.view.scrollDOM.scrollTop = 0;
    if (this.mode === "render") normalizeCaret(this.view);
  }

  /** Close the note: an empty, read-only document. */
  clear(): void {
    this.open({ id: "", text: "", generation: 0, readOnly: true, collapsed: [] });
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    setFormatBar(this.view, false);
    this.view.dispatch({ effects: this.modeComp.reconfigure(modeExtension(mode)) });
    if (mode === "render") normalizeCaret(this.view);
  }

  setFont(font: Font): void {
    this.font = font;
    this.view.dispatch({ effects: this.fontComp.reconfigure(fontExtension(font)) });
  }

  setReadOnly(ro: boolean): void {
    if (ro) setFormatBar(this.view, false);
    this.view.dispatch({ effects: this.roComp.reconfigure(readOnlyExtension(ro)) });
  }

  get readOnly(): boolean {
    return this.view.state.readOnly;
  }

  doc(): Text {
    return this.view.state.doc;
  }

  text(): string {
    return this.view.state.doc.toString();
  }

  focus(): void {
    this.view.focus();
  }

  setBar(open: boolean): void {
    setFormatBar(this.view, open);
  }

  barOpen(): boolean {
    return formatBarOpen(this.view);
  }

  analysisText(): string {
    return this.view.state.field(analysisField).text;
  }
}
