// The sidebar (README §3.15): logo, New note, tag filter, search, note list, trash, user.

import { tagHueIndex } from "../../shared/colors.ts";
import type { Actions } from "../actions.ts";
import type { AppState, NoteSummary, Store } from "../state.ts";
import { $, el, formatDate } from "./dom.ts";

export function hueClass(name: string): string {
  return `hue-${tagHueIndex(name)}`;
}

export function chip(tag: string, small = false, onRemove?: () => void): HTMLElement {
  const c = el("span", { class: `chip ${hueClass(tag)}${small ? " chip-sm" : ""}`, text: tag });
  if (onRemove) {
    const x = el("button", { class: "chip-x", attrs: { type: "button", "aria-label": `Remove tag ${tag}` }, text: "×" });
    x.addEventListener("mousedown", (e) => e.preventDefault());
    x.addEventListener("click", onRemove);
    c.appendChild(x);
  }
  return c;
}

function card(note: NoteSummary, state: AppState, actions: Actions): HTMLElement {
  const first = note.tags[0];
  const li = el("li", { class: `card${first ? ` ${hueClass(first)}` : " no-tag"}${state.open?.summary.id === note.id ? " is-active" : ""}` });
  const a = el("a", { class: "card-link", attrs: { href: `/?note=${note.id}` } });
  const title = note.title ? el("span", { class: "card-title", text: note.title }) : el("span", { class: "card-title is-untitled", text: "Untitled" });
  const when = state.view.trash && note.trashedAt ? note.trashedAt : note.modified;
  const date = el("span", { class: "card-date", text: formatDate(when) });
  const tags = el("span", { class: "card-tags" }, note.tags.map((t) => chip(t, true)));
  a.append(title, date);
  if (note.tags.length) a.append(tags);
  a.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    void actions.openNote(note.id);
  });
  li.appendChild(a);
  return li;
}

export function mountSidebar(store: Store, actions: Actions): void {
  const root = $(".sidebar");
  const filter = $<HTMLSelectElement>(".tag-filter", root);
  const search = $<HTMLInputElement>(".search", root);
  const list = $(".note-list", root);
  const trashHead = $(".trash-head", root);
  const trashToggle = $(".trash-toggle", root);
  const avatar = $(".avatar", root);
  const meName = $(".me-name", root);

  $(".logo", root).addEventListener("click", (e) => {
    const me = e as MouseEvent;
    if (me.ctrlKey || me.metaKey || me.button !== 0) return;
    e.preventDefault();
    void actions.goHome();
  });
  $(".new-note", root).addEventListener("click", () => void actions.newNote());
  $(".hide-sidebar", root).addEventListener("click", () => actions.toggleSidebar());
  $(".drawer-close", root).addEventListener("click", () => actions.setDrawer(false));
  $(".empty-trash", root).addEventListener("click", () => void actions.emptyTrash());
  trashToggle.addEventListener("click", () => void actions.toggleTrashView());
  $(".logout", root).addEventListener("click", () => void actions.logout());
  filter.addEventListener("change", () => actions.setFilter(filter.value || null));
  search.addEventListener("input", () => actions.setQuery(search.value));

  const render = (s: AppState, prev: AppState | null) => {
    meName.textContent = s.user;
    avatar.textContent = (s.user[0] ?? "?").toUpperCase();
    avatar.className = `avatar ${hueClass(s.user)}`;

    if (!prev || prev.tags !== s.tags || prev.view.tag !== s.view.tag || prev.view.trash !== s.view.trash) {
      filter.replaceChildren(el("option", { text: "All notes", attrs: { value: "" } }));
      const tags = [...s.tags];
      if (s.view.tag && !tags.some((t) => t.tag === s.view.tag)) tags.push({ tag: s.view.tag, count: 0 });
      tags.sort((a, b) => (a.tag < b.tag ? -1 : 1));
      for (const t of tags) filter.appendChild(el("option", { text: `${t.tag} (${t.count})`, attrs: { value: t.tag } }));
      filter.value = s.view.tag ?? "";
      filter.disabled = s.view.trash;
    }
    if (search.value !== s.view.query) search.value = s.view.query;
    trashHead.hidden = !s.view.trash;
    root.classList.toggle("in-trash", s.view.trash);
    trashToggle.replaceChildren(...(s.view.trash ? ["← Back to notes"] : [trashIcon(), "Trash"]));

    if (!prev || prev.notes !== s.notes || prev.open?.summary !== s.open?.summary || prev.listLoaded !== s.listLoaded) {
      if (!s.listLoaded) {
        list.replaceChildren();
      } else if (!s.notes.length) {
        const msg = s.view.trash ? "Trash is empty" : s.view.query.trim() || s.view.tag ? "No matching notes" : "No notes yet";
        list.replaceChildren(el("li", { class: "list-empty", text: msg }));
      } else {
        list.replaceChildren(...s.notes.map((n) => card(n, s, actions)));
      }
    }
    $(".empty-trash", root).toggleAttribute("disabled", !s.notes.length);
  };
  store.subscribe((s, prev) => render(s, prev));
  render(store.get(), null);
}

function trashIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<use href="#i-trash"/>';
  return svg;
}
