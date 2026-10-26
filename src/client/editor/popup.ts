// The formatting popup and bar (architecture §7.8, README §3.6).

import { EditorSelection, Facet, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { HUES } from "../../shared/palette.ts";
import { applyFormat, formatState, type FormatOp, type FormatState } from "../../shared/ops.ts";
import { normalizeUrl } from "../../shared/rules.ts";
import { fontById, installedFonts } from "../fonts.ts";
import { analysisField, bypass } from "./fields.ts";

export interface PopupHost {
  /** The palette button, for the pinned bar's position. */
  paletteButton: () => HTMLElement | null;
  /** Told when the bar opens or closes. */
  onBarChange: (open: boolean) => void;
}

export const popupHost = Facet.define<PopupHost, PopupHost | null>({ combine: (v) => v[0] ?? null });

const DEFAULT_HINT = "Enter applies · Esc closes";

interface Cell {
  el: HTMLButtonElement;
  op: () => FormatOp | "link" | "fonts";
}

/** An entry of the font list (architecture §15, Fonts); `font: null` is Default. */
interface FontItem {
  el: HTMLButtonElement;
  font: string | null;
  mono: boolean;
}

let lastPointer = "mouse";
window.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType || "mouse"), true);

/** Whether the popup docks at the bottom: phones, or a selection made by touch. */
function docked(): boolean {
  return window.matchMedia("(max-width: 760px)").matches || lastPointer === "touch" || lastPointer === "pen";
}

class Popup {
  view: EditorView;
  dom: HTMLDivElement;
  hint: HTMLDivElement;
  rows: Cell[][] = [];
  pinned = false;
  mouseDown = false;
  escKey = "";
  focus: [number, number] | null = null;
  message = "";
  visible = false;
  state: FormatState | null = null;
  /** The font list, shown in place of the swatches (architecture §15, Fonts). */
  fontList: HTMLDivElement;
  fontCell!: Cell;
  listOpen = false;
  /** The selection the list was opened for: any other closes it. */
  listKey = "";
  listItems: FontItem[] = [];
  listFocus: number | null = null;
  /** The entry the last pointer went down on: a click counts only there. */
  downItem: Element | null = null;
  private onMouseUp = () => {
    if (!this.mouseDown) return;
    this.mouseDown = false;
    this.refresh();
  };
  private onViewport = () => this.position();
  private onOutside = (e: PointerEvent) => {
    if (!this.pinned) return;
    const t = e.target as Node;
    const button = this.view.state.facet(popupHost)?.paletteButton();
    if (this.view.dom.contains(t) || this.dom.contains(t) || button?.contains(t)) return;
    this.setPinned(false);
  };

  constructor(view: EditorView) {
    this.view = view;
    this.dom = document.createElement("div");
    this.dom.className = "fmt-popup";
    this.dom.setAttribute("role", "toolbar");
    this.dom.setAttribute("aria-label", "Formatting");
    this.dom.hidden = true;
    this.hint = document.createElement("div");
    this.hint.className = "fmt-hint";
    this.fontList = document.createElement("div");
    this.fontList.className = "fmt-font-list";
    this.fontList.setAttribute("role", "listbox");
    this.fontList.setAttribute("aria-label", "Fonts");
    this.fontList.hidden = true;
    // Entries act on click, not pointerdown, so a swipe that scrolls the list doesn't pick a font.
    // The click must also have started on that entry: opening the list moves things (a docked popup
    // grows upward), and the click of the tap that opened it lands wherever the finger now is.
    this.fontList.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest("button");
      const item = this.listItems.find((i) => i.el === el);
      if (item && el === this.downItem) this.pickFont(item, false);
    });
    this.buildButtons();
    document.body.appendChild(this.dom);
    view.contentDOM.addEventListener("mousedown", () => {
      this.mouseDown = true;
      this.refresh();
    });
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("pointerup", this.onMouseUp);
    window.addEventListener("blur", this.onMouseUp);
    window.addEventListener("pointerdown", this.onOutside, true);
    window.visualViewport?.addEventListener("resize", this.onViewport);
    window.visualViewport?.addEventListener("scroll", this.onViewport);
    window.addEventListener("resize", this.onViewport);
    // Buttons act on pointerdown only; mousedown is prevented just to keep focus and selection.
    this.dom.addEventListener("mousedown", (e) => e.preventDefault());
    this.dom.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.downItem = (e.target as HTMLElement).closest(".fmt-font-item");
      if (e.button !== 0) return;
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn || btn.disabled) return;
      for (const row of this.rows) for (const cell of row) if (cell.el === btn) this.activate(cell);
    });
  }

  private button(label: string, cls: string, title: string, op: Cell["op"]): Cell {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `fmt-btn ${cls}`;
    el.title = title;
    el.setAttribute("aria-label", title);
    el.innerHTML = label;
    el.tabIndex = -1;
    return { el, op };
  }

  private buildButtons(): void {
    const row0 = [
      this.button("<b>B</b>", "fmt-b", "Bold", () => ({ type: "bold" })),
      this.button("<u>U</u>", "fmt-u", "Underline", () => ({ type: "underline" })),
      this.button("&lt;/&gt;", "fmt-code", "Code", () => ({ type: "code" })),
      this.button("Section", "fmt-section", "Section", () => ({ type: "section" })),
      this.button("Clear formatting", "fmt-clear wide", "Clear formatting", () => ({ type: "clear" })),
    ];
    this.fontCell = this.button('<span class="fmt-aa" aria-hidden="true">Aa</span> Font', "fmt-font", "Font", () => "fonts");
    this.fontCell.el.setAttribute("aria-expanded", "false");
    const row1 = [
      this.button('<svg aria-hidden="true"><use href="#i-link"/></svg> Link', "fmt-link", "Link", () => "link"),
      this.fontCell,
      this.button("Remove color", "fmt-nocolor wide", "Remove color", () => ({ type: "removeColor" })),
    ];
    const light = HUES.map((h) => this.button("a", `fmt-swatch hl-${h.name}`, h.name, () => ({ type: "color", color: h.name })));
    const deep = HUES.map((h) =>
      this.button("a", `fmt-swatch hl-${h.name}-deep`, `${h.name}-deep`, () => ({ type: "color", color: `${h.name}-deep` })),
    );
    this.rows = [row0, row1, light, deep];
    const rowClass = ["fmt-row", "fmt-row", "fmt-swatches", "fmt-swatches"];
    this.rows.forEach((row, i) => {
      const div = document.createElement("div");
      div.className = rowClass[i];
      for (const c of row) div.appendChild(c.el);
      this.dom.appendChild(div);
      if (i === 1) this.dom.appendChild(this.fontList);
    });
    this.dom.appendChild(this.hint);
  }

  /** The rows the focus ring moves over: hidden buttons skipped, and no swatches while the font
   *  list is open. */
  private ringRows(): Cell[][] {
    const rows = this.listOpen ? this.rows.slice(0, 2) : this.rows;
    return rows.map((r) => r.filter((c) => !c.el.hidden)).filter((r) => r.length);
  }

  private fontCellFocus(): [number, number] | null {
    const rows = this.ringRows();
    const c = rows[1]?.indexOf(this.fontCell) ?? -1;
    return c >= 0 ? [1, c] : null;
  }

  private setList(open: boolean, keyboard = false): void {
    if (this.listOpen === open) return;
    this.listOpen = open;
    this.listKey = this.selKey();
    this.dom.classList.toggle("is-fonts", open);
    this.fontList.hidden = !open;
    this.fontCell.el.setAttribute("aria-expanded", String(open));
    this.listFocus = null;
    if (open) {
      this.buildList();
      // Opened from the keyboard, the ring moves into the list, onto the checked entry.
      if (keyboard) {
        this.listFocus = this.checkedItem();
        this.focus = null;
      }
    }
    this.paint();
    this.position();
    if (open) (this.listItems[this.listFocus ?? this.checkedItem()]?.el ?? null)?.scrollIntoView({ block: "nearest" });
  }

  private checkedItem(): number {
    const i = this.listItems.findIndex((it) => it.el.classList.contains("is-current"));
    return i >= 0 ? i : 0;
  }

  /** Default, a font the note names that isn't installed, then the monospace and other fonts, each
   *  name in its own font. A code-only target lists only monospace fonts. */
  private buildList(): void {
    const st = this.state!;
    const list = this.fontList;
    list.replaceChildren();
    this.listItems = [];
    const current = st.fontMixed ? undefined : st.font;
    const add = (label: string, font: string | null, mono: boolean, cls: string, disabled = false) => {
      const el = document.createElement("button");
      el.type = "button";
      el.tabIndex = -1;
      el.className = `fmt-font-item ${cls}`.trim();
      el.textContent = label;
      el.disabled = disabled;
      el.setAttribute("role", "option");
      const on = current !== undefined && current === font;
      el.classList.toggle("is-current", on);
      el.setAttribute("aria-selected", String(on));
      list.appendChild(el);
      if (!disabled) this.listItems.push({ el, font, mono });
    };
    add("Default", null, false, "");
    if (st.font && !st.fontMixed && !fontById(st.font)) add(`${st.font} (not installed)`, st.font, false, "is-missing", true);
    const group = (title: string, mono: boolean) => {
      const fonts = installedFonts().filter((f) => f.mono === mono);
      if (!fonts.length) return;
      const head = document.createElement("div");
      head.className = "fmt-font-head";
      head.textContent = title;
      list.appendChild(head);
      for (const f of fonts) add(f.name, f.id, f.mono, `ff-${f.id}`);
    };
    group("Monospace", true);
    if (!st.codeOnly) group("Other", false);
  }

  private pickFont(item: FontItem, keyboard: boolean): void {
    if (this.apply({ type: "font", font: item.font, mono: item.mono })) {
      this.setList(false);
      if (keyboard) this.focus = this.fontCellFocus();
      this.paint();
    }
  }

  private selection() {
    return this.view.state.selection.main;
  }

  private selKey(): string {
    const s = this.selection();
    return `${s.from}:${s.to}`;
  }

  setPinned(open: boolean): void {
    if (this.pinned === open) return;
    this.pinned = open;
    this.escKey = "";
    this.focus = null;
    this.view.state.facet(popupHost)?.onBarChange(open);
    this.refresh();
  }

  private ctx() {
    const a = this.view.state.field(analysisField);
    return { text: a.text, a };
  }

  refresh(): void {
    const sel = this.selection();
    // README §3.6: never on a read-only note; the bar stays while pinned; the popup needs focus,
    // a released mouse button, a selection, and not to have been hidden by Esc for this selection.
    const show =
      !this.view.state.readOnly &&
      (this.pinned || (this.view.hasFocus && !this.mouseDown && !sel.empty && this.escKey !== this.selKey()));
    if (!show) {
      this.hide();
      return;
    }
    this.state = formatState(this.ctx(), sel.from, sel.to, this.pinned);
    this.dom.hidden = false;
    this.visible = true;
    this.paint();
    this.position();
  }

  private hide(): void {
    this.dom.hidden = true;
    this.visible = false;
    this.focus = null;
    if (this.listOpen) {
      this.listOpen = false;
      this.dom.classList.remove("is-fonts");
      this.fontList.hidden = true;
      this.fontCell.el.setAttribute("aria-expanded", "false");
    }
  }

  private paint(): void {
    const st = this.state!;
    const [row0, row1, light, deep] = this.rows;
    const set = (c: Cell, on: boolean, disabled = false) => {
      c.el.classList.toggle("is-on", on);
      c.el.disabled = disabled;
    };
    set(row0[0], st.bold, st.onlyCode);
    set(row0[1], st.underline, st.onlyCode);
    set(row0[2], st.code, false);
    set(row0[3], st.section, st.onlyCode || st.sectionDisabled);
    set(row0[4], false, st.onlyCode);
    set(row1[0], !!st.link, st.onlyCode);
    // Font: shown when fonts are installed, or the target has a font that isn't (so it can be removed).
    row1[1].el.hidden = !installedFonts().length && !st.fonts.some((f) => !fontById(f));
    set(row1[1], !!st.font && !st.fontMixed, !st.fontable);
    set(row1[2], false, st.onlyCode);
    [...light, ...deep].forEach((c, i) => {
      const name = i < 12 ? HUES[i].name : `${HUES[i - 12].name}-deep`;
      c.el.classList.toggle("is-current", st.color === name);
      c.el.disabled = st.onlyCode;
    });
    this.rows.flat().forEach((c) => c.el.classList.remove("is-focus"));
    const ring = this.ringRows();
    if (this.focus && !ring[this.focus[0]]?.[this.focus[1]]) this.focus = null;
    if (this.focus) ring[this.focus[0]][this.focus[1]].el.classList.add("is-focus");
    this.listItems.forEach((it, i) => it.el.classList.toggle("is-focus", i === this.listFocus));
    const compact = window.matchMedia("(max-width: 760px)").matches;
    this.dom.classList.toggle("is-compact", compact);
    // README §3.6: with no word at the cursor, the hint says so before anything is clicked.
    const idle = st.hasTarget ? (compact ? "" : DEFAULT_HINT) : "Select some text first";
    this.hint.textContent = this.message || idle;
    this.hint.hidden = !this.hint.textContent;
  }

  /** Position through CodeMirror's measure cycle (layout can't be read during an update). */
  position(): void {
    if (!this.visible) return;
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const sel = view.state.selection.main;
        return {
          coords: view.coordsAtPos(sel.head) ?? view.coordsAtPos(sel.from),
          button: view.state.facet(popupHost)?.paletteButton()?.getBoundingClientRect() ?? null,
          width: this.dom.offsetWidth || 392,
          height: this.dom.offsetHeight || 200,
        };
      },
      write: (m) => this.place(m),
    });
  }

  private place(m: { coords: { top: number; bottom: number; left: number } | null; button: DOMRect | null; width: number; height: number }): void {
    const style = this.dom.style;
    style.left = style.top = style.bottom = style.right = "";
    this.dom.classList.remove("is-docked", "is-pinned");
    if (docked()) {
      this.dom.classList.add("is-docked");
      const vv = window.visualViewport;
      const keyboard = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
      style.bottom = `calc(${keyboard}px + max(8px, env(safe-area-inset-bottom)))`;
      return;
    }
    if (this.pinned && m.button) {
      this.dom.classList.add("is-pinned");
      style.left = `${Math.max(8, Math.min(m.button.left, window.innerWidth - m.width - 8))}px`;
      style.top = `${m.button.bottom + 8}px`;
      return;
    }
    if (!m.coords) return;
    let top = m.coords.bottom + 10;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, m.coords.top - m.height - 10);
    style.left = `${Math.max(8, Math.min(m.coords.left - m.width / 2, window.innerWidth - m.width - 8))}px`;
    style.top = `${top}px`;
  }

  say(message: string): void {
    this.message = message;
    this.paint();
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      this.message = "";
      if (this.visible) this.paint();
    }, 2500);
  }
  private messageTimer = 0;

  activate(cell: Cell, keyboard = false): void {
    const view = this.view;
    let op = cell.op();
    if (op === "fonts") {
      this.setList(!this.listOpen, keyboard);
      return;
    }
    if (op === "link") {
      const st = this.state;
      const answer = window.prompt("Link address", st?.link ?? "");
      if (answer === null) return; // Cancelled: nothing changes.
      if (answer.trim() === "") op = { type: "link", url: "" };
      else {
        const url = normalizeUrl(answer);
        if (!url) {
          this.say("That isn't a web address");
          return;
        }
        op = { type: "link", url };
      }
      view.focus();
    }
    this.apply(op);
  }

  /** Apply an option; false if it was refused (the hint says why). */
  private apply(op: FormatOp): boolean {
    const view = this.view;
    const sel = this.selection();
    const result = applyFormat(this.ctx(), sel.from, sel.to, op, this.pinned);
    if (!result.ok) {
      this.say(result.reason === "select" ? "Select some text first" : "Can't apply that here");
      return false;
    }
    if (op.type === "font") this.setList(false);
    const focus = this.focus;
    view.dispatch({
      changes: result.changes,
      selection: EditorSelection.single(result.anchor, result.head),
      annotations: [bypass.of(true), Transaction.userEvent.of("input.format")],
      scrollIntoView: true,
    });
    // The same visible text stays selected, and the focus ring stays, so several options can be
    // applied in a row (README §3.6).
    this.focus = focus;
    this.escKey = "";
    this.refresh();
    return true;
  }

  update(u: ViewUpdate): void {
    // Another selection closes the font list (a font finishing loading sets the same one again).
    if (this.listOpen && (u.selectionSet || u.docChanged) && this.listKey !== this.selKey()) this.setList(false);
    if (u.selectionSet && this.escKey && this.escKey !== this.selKey()) this.escKey = "";
    // Only a selection that moved drops the ring (a font finishing loading sets the same one again).
    const [s0, s1] = [u.startState.selection.main, u.state.selection.main];
    if (u.selectionSet && (s0.from !== s1.from || s0.to !== s1.to) && !this.pinned) this.focus = null;
    if (u.selectionSet || u.docChanged || u.focusChanged || u.viewportChanged || u.geometryChanged || u.transactions.some((t) => t.reconfigured)) {
      this.refresh();
    }
  }

  /** Keyboard (README §3.6). Returns whether the key was handled. */
  key(name: string): boolean {
    if (!this.visible) return false;
    const sel = this.selection();
    if (name === "Escape") {
      if (this.listOpen) {
        // Back to the swatches, with the ring on the Font button.
        this.setList(false);
        this.focus = this.fontCellFocus();
        this.paint();
        return true;
      }
      if (this.pinned) this.setPinned(false);
      else {
        this.escKey = this.selKey();
        this.hide();
      }
      return true;
    }
    // With the bar pinned and nothing selected, the arrows and Enter go to the note.
    if (this.pinned && sel.empty) return false;
    // The font list: Up and Down move through its entries, Enter picks one.
    if (this.listOpen && (name === "ArrowUp" || name === "ArrowDown" || (this.listFocus !== null && name !== "Escape"))) {
      if (name === "Enter" && this.listFocus !== null) {
        this.pickFont(this.listItems[this.listFocus], true);
        return true;
      }
      if (name === "ArrowUp" || name === "ArrowDown") {
        const last = this.listItems.length - 1;
        if (this.listFocus === null) this.listFocus = this.checkedItem();
        else this.listFocus = Math.max(0, Math.min(last, this.listFocus + (name === "ArrowDown" ? 1 : -1)));
        this.focus = null;
        this.paint();
        this.listItems[this.listFocus]?.el.scrollIntoView({ block: "nearest" });
      }
      return true;
    }
    const rows = this.ringRows();
    if (name === "Enter") {
      if (!this.focus) return false;
      this.activate(rows[this.focus[0]][this.focus[1]], true);
      return true;
    }
    if (!this.focus) {
      this.focus = [0, 0];
    } else {
      let [r, c] = this.focus;
      if (name === "ArrowRight") c = Math.min(c + 1, rows[r].length - 1);
      else if (name === "ArrowLeft") c = Math.max(c - 1, 0);
      else if (name === "ArrowDown" || name === "ArrowUp") {
        const nr = name === "ArrowDown" ? Math.min(r + 1, rows.length - 1) : Math.max(r - 1, 0);
        // Keep roughly the same horizontal position between rows of different lengths.
        const frac = rows[r].length > 1 ? c / (rows[r].length - 1) : 0;
        c = Math.round(frac * (rows[nr].length - 1));
        r = nr;
      }
      this.focus = [r, c];
    }
    this.paint();
    return true;
  }

  destroy(): void {
    this.dom.remove();
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("pointerup", this.onMouseUp);
    window.removeEventListener("blur", this.onMouseUp);
    window.removeEventListener("pointerdown", this.onOutside, true);
    window.visualViewport?.removeEventListener("resize", this.onViewport);
    window.visualViewport?.removeEventListener("scroll", this.onViewport);
    window.removeEventListener("resize", this.onViewport);
  }
}

export const popupPlugin = ViewPlugin.fromClass(Popup);

export function setFormatBar(view: EditorView, open: boolean): void {
  view.plugin(popupPlugin)?.setPinned(open);
}

export function formatBarOpen(view: EditorView): boolean {
  return !!view.plugin(popupPlugin)?.pinned;
}

const keyFor = (name: string) => (view: EditorView) => view.plugin(popupPlugin)?.key(name) ?? false;

export const popupKeymap = Prec.highest(
  keymap.of(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape"].map((key) => ({ key, run: keyFor(key) }))),
);

