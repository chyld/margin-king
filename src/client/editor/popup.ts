// The formatting popup and bar (architecture §7.8, README §3.6).

import { EditorSelection, Facet, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { HUES } from "../../shared/palette.ts";
import { applyFormat, formatState, resolveTarget, type FormatOp, type FormatState } from "../../shared/ops.ts";
import { normalizeUrl } from "../../shared/rules.ts";
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
  op: () => FormatOp | "link";
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
    const row1 = [
      this.button('<svg aria-hidden="true"><use href="#i-link"/></svg> Link', "fmt-link", "Link", () => "link"),
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
    });
    this.dom.appendChild(this.hint);
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
    set(row1[1], false, st.onlyCode);
    [...light, ...deep].forEach((c, i) => {
      const name = i < 12 ? HUES[i].name : `${HUES[i - 12].name}-deep`;
      c.el.classList.toggle("is-current", st.color === name);
      c.el.disabled = st.onlyCode;
    });
    this.rows.flat().forEach((c) => c.el.classList.remove("is-focus"));
    if (this.focus) this.rows[this.focus[0]][this.focus[1]].el.classList.add("is-focus");
    const compact = window.matchMedia("(max-width: 760px)").matches;
    this.dom.classList.toggle("is-compact", compact);
    this.hint.textContent = this.message || (compact ? "" : DEFAULT_HINT);
    this.hint.hidden = compact && !this.message;
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

  activate(cell: Cell): void {
    const view = this.view;
    const sel = this.selection();
    let op = cell.op();
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
    const result = applyFormat(this.ctx(), sel.from, sel.to, op, this.pinned);
    if (!result.ok) {
      this.say(result.reason === "select" ? "Select some text first" : "Can't apply that here");
      return;
    }
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
  }

  update(u: ViewUpdate): void {
    if (u.selectionSet && this.escKey && this.escKey !== this.selKey()) this.escKey = "";
    if (u.selectionSet && !this.pinned) this.focus = null;
    if (u.selectionSet || u.docChanged || u.focusChanged || u.viewportChanged || u.geometryChanged || u.transactions.some((t) => t.reconfigured)) {
      this.refresh();
    }
  }

  /** Keyboard (README §3.6). Returns whether the key was handled. */
  key(name: string): boolean {
    if (!this.visible) return false;
    const sel = this.selection();
    if (name === "Escape") {
      if (this.pinned) this.setPinned(false);
      else {
        this.escKey = this.selKey();
        this.hide();
      }
      return true;
    }
    // With the bar pinned and nothing selected, the arrows and Enter go to the note.
    if (this.pinned && sel.empty) return false;
    if (name === "Enter") {
      if (!this.focus) return false;
      this.activate(this.rows[this.focus[0]][this.focus[1]]);
      return true;
    }
    if (!this.focus) {
      this.focus = [0, 0];
    } else {
      let [r, c] = this.focus;
      if (name === "ArrowRight") c = Math.min(c + 1, this.rows[r].length - 1);
      else if (name === "ArrowLeft") c = Math.max(c - 1, 0);
      else if (name === "ArrowDown" || name === "ArrowUp") {
        const nr = name === "ArrowDown" ? Math.min(r + 1, this.rows.length - 1) : Math.max(r - 1, 0);
        // Keep roughly the same horizontal position between rows of different lengths.
        const frac = this.rows[r].length > 1 ? c / (this.rows[r].length - 1) : 0;
        c = Math.round(frac * (this.rows[nr].length - 1));
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

/** Whether there's anything for the pinned bar to apply to (for its hint). */
export function hasTarget(view: EditorView): boolean {
  const a = view.state.field(analysisField);
  const s = view.state.selection.main;
  return !!resolveTarget({ text: a.text, a }, s.from, s.to, true);
}
