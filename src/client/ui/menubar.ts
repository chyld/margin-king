// The menu bar (README §3.2–§3.6, §3.13, §4.6): save, render/raw, font, palette, tags, trash.

import { cleanTagInput, isTag, MAX_TAG_LENGTH } from "../../shared/rules.ts";
import type { Actions } from "../actions.ts";
import type { AppState, Store, TagCount } from "../state.ts";
import { $, el } from "./dom.ts";
import { chip, hueClass } from "./sidebar.ts";

const SAVE_TITLES: Record<AppState["save"], string> = {
  saved: "Saved (Ctrl+S)",
  unsaved: "Unsaved changes · click to save",
  saving: "Saving…",
  failed: "Save failed · click to retry",
};

/** README §3.13: tags starting with the text first, then by count, then alphabetically, at most 8. */
export function suggestions(all: TagCount[], onNote: string[], typed: string): { tag: string; count: number; isNew?: boolean }[] {
  const pool = all.filter((t) => !onNote.includes(t.tag) && t.tag.includes(typed));
  pool.sort((a, b) => {
    const pa = a.tag.startsWith(typed) ? 0 : 1;
    const pb = b.tag.startsWith(typed) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.count !== b.count) return b.count - a.count;
    return a.tag < b.tag ? -1 : 1;
  });
  const out: { tag: string; count: number; isNew?: boolean }[] = pool.slice(0, 8);
  if (typed && !all.some((t) => t.tag === typed) && !onNote.includes(typed)) out.push({ tag: typed, count: 0, isNew: true });
  return out;
}

export function mountMenubar(store: Store, actions: Actions): void {
  const bar = $(".menubar");
  const save = $<HTMLButtonElement>(".save", bar);
  const mode = $<HTMLButtonElement>(".mode-switch", bar);
  const font = $<HTMLButtonElement>(".font-switch", bar);
  const palette = $<HTMLButtonElement>(".palette", bar);
  const trash = $<HTMLButtonElement>(".trash-note", bar);
  const tagsHost = $(".tags", bar);
  const chips = $(".tag-chips", bar);
  const box = $<HTMLInputElement>(".tag-box", bar);
  const list = $(".suggestions", bar);
  const toolgroup = $(".toolgroup", bar);

  save.addEventListener("click", () => void actions.save());
  mode.addEventListener("click", () => actions.toggleMode());
  font.addEventListener("click", () => {
    if (store.get().prefs.mode === "render") actions.toggleFont();
  });
  palette.addEventListener("mousedown", (e) => e.preventDefault());
  palette.addEventListener("click", () => actions.toggleFormatBar());
  trash.addEventListener("click", () => void actions.trashNote());
  $(".show-sidebar", bar).addEventListener("click", () => actions.toggleSidebar());
  $(".menu", bar).addEventListener("click", () => actions.setDrawer(true));

  // ---- Tag box ----
  let highlighted = -1;
  let open = false;
  let current: ReturnType<typeof suggestions> = [];

  const tagsOfNote = () => store.get().open?.summary.tags ?? [];
  const addTag = (tag: string) => {
    const t = cleanTagInput(tag);
    if (!isTag(t)) return;
    const tags = tagsOfNote();
    if (!tags.includes(t)) actions.setTags([...tags, t]);
    box.value = "";
    highlighted = -1;
    renderList();
  };
  const renderList = () => {
    const s = store.get();
    current = suggestions(s.tags, tagsOfNote(), box.value);
    if (box.value && highlighted < 0 && current.length) highlighted = 0;
    if (highlighted >= current.length) highlighted = current.length - 1;
    list.hidden = !open || !current.length;
    list.replaceChildren(
      ...current.map((sg, i) => {
        const li = el("li", { class: `sugg${i === highlighted ? " is-hi" : ""}`, attrs: { role: "option" } });
        if (sg.isNew) {
          li.append(el("span", { class: "sugg-new" }, ["Add new tag ", el("b", { text: sg.tag })]));
        } else {
          li.append(el("span", { class: `sugg-dot ${hueClass(sg.tag)}` }), el("span", { class: "sugg-name", text: sg.tag }), el("span", { class: "sugg-count", text: String(sg.count) }));
        }
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          addTag(sg.tag);
        });
        return li;
      }),
    );
  };
  box.maxLength = MAX_TAG_LENGTH;
  box.addEventListener("focus", () => {
    open = true;
    highlighted = box.value ? 0 : -1;
    renderList();
  });
  box.addEventListener("input", () => {
    const cleaned = cleanTagInput(box.value);
    if (cleaned !== box.value) box.value = cleaned;
    highlighted = box.value ? 0 : -1;
    open = true;
    renderList();
  });
  box.addEventListener("blur", () => {
    if (box.value) addTag(box.value);
    open = false;
    renderList();
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === ",") {
      e.preventDefault();
      // Enter takes the highlighted suggestion (so alp + Enter adds alpha); space and comma add
      // what was typed (README §3.13).
      const pick = e.key === "Enter" && highlighted >= 0 && current[highlighted] ? current[highlighted].tag : box.value;
      if (pick) addTag(pick);
    } else if (e.key === "Backspace" && !box.value) {
      const tags = tagsOfNote();
      if (tags.length) actions.setTags(tags.slice(0, -1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (box.value) {
        box.value = "";
        actions.editor.focus();
      } else {
        open = false;
        renderList();
      }
    } else if (e.key === "ArrowDown" && current.length) {
      e.preventDefault();
      highlighted = (highlighted + 1) % current.length;
      renderList();
    } else if (e.key === "ArrowUp" && current.length) {
      e.preventDefault();
      highlighted = highlighted <= 0 ? current.length - 1 : highlighted - 1;
      renderList();
    }
  });

  const render = (s: AppState, prev: AppState | null) => {
    const open_ = s.open;
    const trashed = !!open_?.summary.trashedAt;
    const editable = !!open_ && !trashed;
    bar.classList.toggle("no-note", !open_);
    toolgroup.hidden = !open_;
    save.hidden = !editable;
    palette.hidden = !editable;
    trash.hidden = !editable;
    tagsHost.hidden = !editable;
    save.dataset.state = s.save;
    save.title = SAVE_TITLES[s.save];
    save.setAttribute("aria-label", SAVE_TITLES[s.save]);
    mode.classList.toggle("is-raw", s.prefs.mode === "raw");
    mode.title = s.prefs.mode === "raw" ? "Raw mode (Ctrl+E for render)" : "Render mode (Ctrl+E for raw)";
    mode.setAttribute("aria-pressed", String(s.prefs.mode === "raw"));
    font.classList.toggle("is-prop", s.prefs.font === "prop");
    font.classList.toggle("is-dim", s.prefs.mode === "raw");
    font.title = s.prefs.mode === "raw" ? "Raw mode always uses the monospace font" : s.prefs.font === "prop" ? "Proportional font" : "Monospace font";
    palette.classList.toggle("is-pressed", s.ui.formatBar);
    palette.setAttribute("aria-pressed", String(s.ui.formatBar));
    bar.classList.toggle("sidebar-collapsed", s.prefs.sidebar === "collapsed");
    if (!prev || prev.open?.summary.tags !== open_?.summary.tags) {
      chips.replaceChildren(...(open_?.summary.tags ?? []).map((t) => chip(t, false, () => actions.setTags(tagsOfNote().filter((x) => x !== t)))));
    }
    if (!prev || prev.tags !== s.tags) renderList();
  };
  store.subscribe((s, prev) => render(s, prev));
  render(store.get(), null);
}
