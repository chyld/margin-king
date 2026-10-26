// The note area: the trash banner, the paper, the empty state, the drawer and sidebar layout.

import type { Actions } from "../actions.ts";
import type { AppState, Store } from "../state.ts";
import { $ } from "./dom.ts";

export function mountMain(store: Store, actions: Actions): void {
  const app = $(".app");
  const banner = $(".trash-banner");
  const paper = $(".paper-wrap");
  const empty = $(".empty-state");
  $(".banner-restore", banner).addEventListener("click", () => void actions.restore());
  $(".banner-delete", banner).addEventListener("click", () => void actions.deleteForever());
  $(".empty-new").addEventListener("click", () => void actions.newNote());
  $(".backdrop").addEventListener("click", () => actions.setDrawer(false));

  const render = (s: AppState) => {
    const trashed = !!s.open?.summary.trashedAt;
    banner.hidden = !trashed;
    paper.hidden = !s.open;
    empty.hidden = !!s.open || s.loading;
    app.classList.toggle("drawer-open", s.ui.drawer);
    app.classList.toggle("sidebar-collapsed", s.prefs.sidebar === "collapsed");
    app.classList.toggle("is-trashed", trashed);
    app.classList.toggle("is-loading", s.loading);
  };
  store.subscribe((s) => render(s));
  render(store.get());
}

/** The address bar always reflects what's shown (README §3.17), replacing history entries. */
export function syncUrl(s: AppState): void {
  // While a note loads, the old address stays (on boot, the ?note= link being opened).
  if (s.loading) return;
  const target = s.open ? `/?note=${s.open.summary.id}` : s.view.tag && !s.view.trash ? `/?tag=${encodeURIComponent(s.view.tag)}` : "/";
  if (location.pathname + location.search !== target) history.replaceState(null, "", target);
}
