// Render-mode widgets: the section toggle, the ⋯ pill, screenshots, the Copy button, the end marker.

import { WidgetType, type EditorView } from "@codemirror/view";
import { analysisField, bypass, noteFacet, toggleSection } from "./fields.ts";
import { copyToClipboard } from "./clipboard.ts";
import { cancelResize, setImageWidth, setLineWidth, startResize } from "./resize.ts";

function toggle(view: EditorView, key: string): void {
  view.dispatch({ effects: toggleSection.of(key), annotations: bypass.of(true) });
}

export class FoldWidget extends WidgetType {
  key: string;
  collapsed: boolean;
  constructor(key: string, collapsed: boolean) {
    super();
    this.key = key;
    this.collapsed = collapsed;
  }
  eq(other: FoldWidget): boolean {
    return other.key === this.key && other.collapsed === this.collapsed;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = `cm-fold${this.collapsed ? " is-collapsed" : ""}`;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", this.collapsed ? "Expand section" : "Collapse section");
    el.title = this.collapsed ? "Expand section" : "Collapse section";
    el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggle(view, this.key);
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export class EllipsisWidget extends WidgetType {
  key: string;
  constructor(key: string) {
    super();
    this.key = key;
  }
  eq(other: EllipsisWidget): boolean {
    return other.key === this.key;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-ellipsis";
    el.textContent = "⋯";
    el.title = "Expand section";
    el.setAttribute("role", "button");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggle(view, this.key);
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function showHandle(wrap: HTMLElement): void {
  if (wrap.classList.contains("is-active")) return;
  wrap.classList.add("is-active");
  const away = (e: PointerEvent) => {
    if (wrap.contains(e.target as Node)) return;
    wrap.classList.remove("is-active");
    document.removeEventListener("pointerdown", away, true);
  };
  document.addEventListener("pointerdown", away, true);
}

export class ImageWidget extends WidgetType {
  name: string;
  width: number | null;
  constructor(name: string, width: number | null) {
    super();
    this.name = name;
    this.width = width;
  }
  eq(other: ImageWidget): boolean {
    return other.name === this.name && other.width === this.width;
  }
  /** A new width keeps the same image element (no reload, no flicker). */
  updateDOM(dom: HTMLElement): boolean {
    if (dom.dataset.name !== this.name) return false;
    setLineWidth(dom, this.width);
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-shot";
    wrap.dataset.name = this.name;
    const note = view.state.facet(noteFacet);
    const img = document.createElement("img");
    img.alt = "Screenshot";
    img.src = `/api/notes/${note.id}/images/${this.name}`;
    img.addEventListener("load", () => view.requestMeasure());
    img.addEventListener("error", () => {
      const missing = document.createElement("em");
      missing.className = "cm-shot-missing";
      missing.textContent = "Missing screenshot";
      img.replaceWith(missing);
      handle.remove();
      view.requestMeasure();
    });
    const handle = document.createElement("span");
    handle.className = "cm-shot-handle";
    handle.title = "Drag to resize · double-click (double-tap) for the original size";
    handle.addEventListener("pointerdown", (e) => startResize(view, wrap, handle, e));
    // Mouse double-clicks; touch double taps are counted in startResize.
    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      setImageWidth(view, wrap, null);
    });
    // Touch screens have no hover: a tap on the image shows its handle until a tap elsewhere.
    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" && e.target !== handle) showHandle(wrap);
    });
    wrap.append(img, handle);
    setLineWidth(wrap, this.width);
    return wrap;
  }
  get estimatedHeight(): number {
    return 160;
  }
  /** Removed mid-drag (a mode or note switch, an undo): the drag ends without writing. */
  destroy(dom: HTMLElement): void {
    cancelResize(dom);
  }
  /** The editor handles clicks on the image (placing the caret), not on the resize handle. */
  ignoreEvent(e: Event): boolean {
    return !!(e.target as Element | null)?.closest?.(".cm-shot-handle");
  }
}

/** The text of code block `index`, without its fences. */
function blockText(view: EditorView, index: number): string {
  const a = view.state.field(analysisField);
  const block = a.doc.blocks[index];
  if (!block) return "";
  return a.doc.lines
    .slice(block.open + 1, block.close)
    .map((l) => l.text)
    .join("\n");
}

export class CopyWidget extends WidgetType {
  block: number;
  constructor(block: number) {
    super();
    this.block = block;
  }
  eq(other: CopyWidget): boolean {
    return other.block === this.block;
  }
  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-copy";
    btn.textContent = "Copy";
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await copyToClipboard(blockText(view, this.block));
      btn.textContent = "Copied";
      btn.classList.add("is-done");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("is-done");
      }, 1200);
    });
    return btn;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * README §3.12: a thin line with a diamond at each end, broken by three dots in a triangle (in the
 * brand colors, the owner's choice). Laid out with flexbox so only the lines stretch.
 */
export class EofWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-eof";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<i class="cm-eof-diamond"></i><span class="cm-eof-line"></span>' +
      '<span class="cm-eof-dots"><i></i><i></i><i></i></span>' +
      '<span class="cm-eof-line"></span><i class="cm-eof-diamond"></i>';
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
