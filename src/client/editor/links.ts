// Links (README §3.10): Ctrl/Cmd+click opens them in both modes; the touch link chip.

import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { lineAt } from "../../shared/analysis.ts";
import type { Token } from "../../shared/syntax.ts";
import { analysisField } from "./fields.ts";

function linkAt(view: EditorView, pos: number): string | null {
  const a = view.state.field(analysisField);
  const line = lineAt(a, pos);
  const rel = pos - line.from;
  let found: string | null = null;
  const visit = (tokens: Token[]) => {
    for (const t of tokens) {
      if (rel < t.from || rel > t.to) continue;
      if (t.type === "link" || t.type === "url") found = t.url!;
      else if (t.type === "hl") visit(t.children ?? []);
    }
  };
  visit(a.tokens[line.index] ?? []);
  return found;
}

export function openUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

export const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return false;
    const url = linkAt(view, pos);
    if (!url) return false;
    e.preventDefault();
    openUrl(url);
    return true;
  },
});

/** While Ctrl/Cmd is held, links show a pointer cursor and a solid underline. */
export const modifierClass = ViewPlugin.fromClass(
  class {
    view: EditorView;
    onKey = (e: KeyboardEvent) => this.view.dom.classList.toggle("mod-held", e.ctrlKey || e.metaKey);
    onBlur = () => this.view.dom.classList.remove("mod-held");
    constructor(view: EditorView) {
      this.view = view;
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("keyup", this.onKey);
      window.addEventListener("blur", this.onBlur);
    }
    destroy() {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.onBlur);
    }
  },
);

let lastPointer = "mouse";
window.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType || "mouse"), true);

/** Touch: a caret placed in a link shows a chip with its address; tapping the chip opens it. */
export const linkChip = ViewPlugin.fromClass(
  class {
    view: EditorView;
    chip: HTMLButtonElement;
    url = "";
    constructor(view: EditorView) {
      this.view = view;
      this.chip = document.createElement("button");
      this.chip.type = "button";
      this.chip.className = "link-chip";
      this.chip.hidden = true;
      this.chip.addEventListener("mousedown", (e) => e.preventDefault());
      this.chip.addEventListener("click", () => this.url && openUrl(this.url));
      document.body.appendChild(this.chip);
    }
    update(u: ViewUpdate) {
      if (!u.selectionSet && !u.focusChanged && !u.geometryChanged) return;
      const sel = u.state.selection.main;
      const url = sel.empty && u.view.hasFocus && lastPointer === "touch" ? linkAt(u.view, sel.head) : null;
      if (!url) {
        this.chip.hidden = true;
        return;
      }
      this.url = url;
      this.chip.innerHTML = "";
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.innerHTML = '<use href="#i-external"/>';
      const label = document.createElement("span");
      label.textContent = url;
      this.chip.append(label, icon);
      u.view.requestMeasure({
        read: (view) => view.coordsAtPos(sel.head),
        write: (coords) => {
          if (!coords) return;
          this.chip.hidden = false;
          this.chip.style.left = `${Math.max(8, Math.min(coords.left - 20, window.innerWidth - this.chip.offsetWidth - 8))}px`;
          this.chip.style.top = `${Math.max(8, coords.top - 40)}px`;
        },
      });
    }
    destroy() {
      this.chip.remove();
    }
  },
);
