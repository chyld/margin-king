// The app entry point: boot, wiring, global keys.

import { Actions } from "./actions.ts";
import { api, setUnauthorizedHandler } from "./api.ts";
import { Editor } from "./editor/editor.ts";
import { prefs } from "./prefs.ts";
import { Store, type AppState } from "./state.ts";
import { $ } from "./ui/dom.ts";
import { mountMain, syncUrl } from "./ui/main.ts";
import { mountMenubar } from "./ui/menubar.ts";
import { mountSidebar } from "./ui/sidebar.ts";
import { toast } from "./ui/toast.ts";

async function boot(): Promise<void> {
  const { user } = await api<{ user: string }>("GET", "/api/session");
  const params = new URLSearchParams(location.search);
  const phone = window.matchMedia("(max-width: 760px)").matches;
  const initial: AppState = {
    user,
    view: { trash: false, tag: params.get("tag"), query: "" },
    notes: [],
    listLoaded: false,
    tags: [],
    open: null,
    loading: !!params.get("note"),
    save: "saved",
    prefs: { mode: prefs.mode(), font: prefs.font(), sidebar: prefs.sidebar() },
    ui: { drawer: phone && !params.get("note"), formatBar: false },
  };
  const store = new Store(initial);
  const actions = new Actions(store);
  setUnauthorizedHandler(() => actions.onUnauthorized());

  const editor = new Editor(
    $(".editor"),
    {
      onDocChanged: () => actions.onDocChanged(),
      onCollapsedChanged: (id, keys) => prefs.setCollapsed(id, keys),
      upload: async (noteId, file) => (await api<{ name: string }>("POST", `/api/notes/${noteId}/images`, file)).name,
      toast,
      generation: () => actions.currentGeneration(),
      paletteButton: () => document.querySelector(".palette"),
      onBarChange: (open) => actions.onBarChange(open),
    },
    initial.prefs.mode,
    initial.prefs.font,
  );
  actions.editor = editor;
  // Debug hook (README §5.7): the CodeMirror view, plus the app's state and actions.
  (window as unknown as { margin: unknown }).margin = {
    get view() {
      return editor.view;
    },
    store,
    actions,
  };

  mountSidebar(store, actions);
  mountMenubar(store, actions);
  mountMain(store, actions);
  store.subscribe((s) => syncUrl(s));
  window.addEventListener("beforeunload", actions.beforeUnload);

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void actions.save();
    } else if (key === "e") {
      e.preventDefault();
      actions.toggleMode();
    }
  });

  const note = params.get("note");
  void actions.refresh();
  if (note) await actions.openNote(note, { skipGuard: true });
}

boot().catch((err) => {
  console.error(err);
  toast(err instanceof Error ? err.message : "Margin couldn't start", true, 0);
});
