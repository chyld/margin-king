// The read-only meta.json viewer (owner decision, architecture §15): the note's meta.json exactly as
// stored, in a modal dialog. Esc, the × button or a click outside closes it.

import { el } from "./dom.ts";

let dialog: HTMLDialogElement | null = null;

function build(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "meta-dialog";
  d.setAttribute("aria-labelledby", "meta-title");
  const close = el("button", { class: "icon-btn meta-close", attrs: { type: "button", "aria-label": "Close", title: "Close" } });
  close.innerHTML = '<svg class="icon"><use href="#i-close"/></svg>';
  close.addEventListener("click", () => d.close());
  const body = el("div", { class: "meta-body" }, [
    el("header", { class: "meta-head" }, [
      el("div", { class: "meta-titles" }, [el("h2", { text: "meta.json", attrs: { id: "meta-title" } }), el("code", { class: "meta-path" })]),
      close,
    ]),
    el("pre", { class: "meta-json" }),
    el("p", { class: "meta-note", text: "This note has unsaved changes; the file shows the last save." }),
  ]);
  d.append(body);
  // A click on the backdrop lands on the dialog itself (its content is all inside the body).
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  return d;
}

export function showMeta(meta: { path: string; text: string }, unsaved: boolean, onClose: () => void): void {
  dialog ??= build();
  const d = dialog;
  d.querySelector(".meta-path")!.textContent = meta.path;
  d.querySelector(".meta-json")!.textContent = meta.text.replace(/\n$/, "");
  (d.querySelector(".meta-note") as HTMLElement).hidden = !unsaved;
  if (d.open) return;
  d.addEventListener("close", onClose, { once: true });
  d.showModal();
}
