// Everything that changes state (architecture §7.1): open, save, trash, tags, navigation.

import { api, ApiError } from "./api.ts";
import type { Editor } from "./editor/editor.ts";
import { prefs } from "./prefs.ts";
import type { AppState, NoteSummary, Store, TagCount } from "./state.ts";
import { toast } from "./ui/toast.ts";

interface NoteResponse extends NoteSummary {
  text: string;
}

const PHONE = () => window.matchMedia("(max-width: 760px)").matches;

export class Actions {
  store: Store;
  editor!: Editor;
  /** Raised by every accepted navigation; async results from older ones are dropped. */
  private generation = 0;
  private listSeq = 0;
  private tagSeq = 0;
  private savePromise: Promise<void> | null = null;
  private saveAgain = false;
  private tagQueues = new Map<string, Promise<unknown>>();
  private tagRevs = new Map<string, number>();
  private searchTimer = 0;
  sessionEnded = false;

  constructor(store: Store) {
    this.store = store;
  }

  private set(fn: (s: AppState) => Partial<AppState>): void {
    this.store.update((s) => ({ ...s, ...fn(s) }));
  }

  /** A new navigation: older async results are dropped, and a pending note load is cancelled. */
  private nav(): number {
    this.generation++;
    if (this.store.get().loading) {
      this.set(() => ({ loading: false }));
      this.restoreEditable();
    }
    return this.generation;
  }

  /** The open note's editability, after a cancelled or failed navigation. */
  private restoreEditable(): void {
    const open = this.store.get().open;
    this.editor.setReadOnly(!open || !!open.summary.trashedAt || this.isFrozen(open.summary.id));
  }

  /** Notes being trashed ("*" while logging out): read-only whatever else navigates meanwhile. */
  private frozen = new Set<string>();

  private isFrozen(id: string): boolean {
    return this.frozen.has(id) || this.frozen.has("*");
  }

  currentGeneration(): number {
    return this.store.get().open?.generation ?? -1;
  }

  dirty(): boolean {
    const open = this.store.get().open;
    return !!open && !open.summary.trashedAt && !this.editor.doc().eq(open.savedDoc);
  }

  // -------------------------------------------------------------------------------------------
  // Lists

  async refreshList(): Promise<void> {
    const seq = ++this.listSeq;
    const { view } = this.store.get();
    const q = new URLSearchParams();
    if (view.trash) q.set("trash", "1");
    else if (view.tag) q.set("tag", view.tag);
    if (view.query.trim()) q.set("q", view.query.trim());
    try {
      const notes = await api<NoteSummary[]>("GET", `/api/notes${q.size ? `?${q}` : ""}`);
      // Only the answer to the latest request issued is applied.
      if (seq === this.listSeq) this.set(() => ({ notes, listLoaded: true }));
    } catch (err) {
      if (seq === this.listSeq) this.fail(err);
    }
  }

  async refreshTags(): Promise<void> {
    const seq = ++this.tagSeq;
    try {
      const tags = await api<TagCount[]>("GET", "/api/tags");
      if (seq === this.tagSeq) this.set(() => ({ tags }));
    } catch (err) {
      if (seq === this.tagSeq) this.fail(err);
    }
  }

  refresh(): Promise<unknown> {
    return Promise.all([this.refreshList(), this.refreshTags()]);
  }

  fail(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) return;
    toast(err instanceof Error ? err.message : String(err), true);
  }

  // -------------------------------------------------------------------------------------------
  // Unsaved changes

  /** Wait for an in-flight save, then ask before discarding unsaved changes (README §3.2). */
  /** Wait for in-flight saves, including a queued follow-up save (Ctrl+S pressed during a save). */
  private async settleSaves(): Promise<void> {
    while (this.savePromise) await this.savePromise.catch(() => {});
  }

  async canLeave(): Promise<boolean> {
    await this.settleSaves();
    await this.drainTags();
    if (!this.dirty()) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  }

  onDocChanged(): void {
    const s = this.store.get();
    if (!s.open || s.save === "saving") return;
    const next = this.dirty() ? (s.save === "failed" ? "failed" : "unsaved") : "saved";
    if (next !== s.save) this.set(() => ({ save: next }));
  }

  // -------------------------------------------------------------------------------------------
  // Opening and closing

  private install(note: NoteResponse, generation: number): void {
    const readOnly = !!note.trashedAt || this.isFrozen(note.id);
    this.editor.open({ id: note.id, text: note.text, generation, readOnly, collapsed: prefs.collapsed(note.id) });
    const { text: _text, ...summary } = note;
    this.set(() => ({
      open: { summary, savedDoc: this.editor.doc(), generation },
      loading: false,
      save: "saved",
      ui: { drawer: false, formatBar: false },
    }));
  }

  async openNote(id: string, opts: { skipGuard?: boolean } = {}): Promise<void> {
    if (this.store.get().open?.summary.id === id && !opts.skipGuard) {
      if (PHONE()) this.set((s) => ({ ui: { ...s.ui, drawer: false } }));
      return;
    }
    if (!opts.skipGuard && !(await this.canLeave())) return;
    const g = this.nav();
    // While another note loads, the editor is read-only so nothing typed can be lost in the swap.
    this.editor.setReadOnly(true);
    this.set(() => ({ loading: true }));
    try {
      const note = await api<NoteResponse>("GET", `/api/notes/${id}`);
      if (g !== this.generation) return;
      if (note.trashedAt && !this.store.get().view.trash) {
        this.set((s) => ({ view: { ...s.view, trash: true } }));
        void this.refreshList();
      }
      this.install(note, g);
    } catch (err) {
      if (g !== this.generation) return;
      this.set(() => ({ loading: false }));
      if (this.store.get().open) this.restoreEditable();
      this.fail(err);
    }
  }

  private close(): void {
    this.editor.clear();
    this.set(() => ({ open: null, save: "saved", loading: false, ui: { drawer: PHONE(), formatBar: false } }));
  }

  async newNote(): Promise<void> {
    if (!(await this.canLeave())) return;
    const g = this.nav();
    const { view } = this.store.get();
    const tags = !view.trash && view.tag ? [view.tag] : [];
    // Nothing typed into the old note while the new one is created can be lost.
    this.editor.setReadOnly(true);
    this.set(() => ({ loading: true }));
    try {
      const note = await api<NoteSummary>("POST", "/api/notes", { tags });
      if (g !== this.generation) {
        void this.refresh(); // The note was created; show it in the list.
        return;
      }
      if (view.trash) this.set((s) => ({ view: { ...s.view, trash: false } }));
      this.install({ ...note, text: "" }, g);
      this.editor.focus();
      void this.refresh();
    } catch (err) {
      if (g === this.generation) {
        this.set(() => ({ loading: false }));
        this.restoreEditable();
      }
      this.fail(err);
    }
  }

  async goHome(): Promise<void> {
    if (!(await this.canLeave())) return;
    this.nav();
    this.set(() => ({ view: { trash: false, tag: null, query: "" } }));
    this.close();
    void this.refresh();
  }

  async logout(): Promise<void> {
    if (!(await this.canLeave())) return;
    this.nav();
    // What was on screen when the user agreed to leave is all that may be lost.
    const accepted = this.editor.doc();
    this.frozen.add("*");
    this.editor.setReadOnly(true);
    try {
      await api("POST", "/api/logout");
    } catch (err) {
      // Still logged in: say so and stay, rather than reload into the same session.
      this.frozen.delete("*");
      this.restoreEditable();
      if (err instanceof ApiError && err.status !== 401) toast(`Couldn't log out: ${err.message}`, true);
      return;
    }
    if (this.editor.doc().eq(accepted)) window.removeEventListener("beforeunload", this.beforeUnload);
    location.href = "/";
  }

  beforeUnload = (e: BeforeUnloadEvent): void => {
    if (this.dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  // -------------------------------------------------------------------------------------------
  // Saving (README §3.2)

  save(): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.summary.trashedAt) return Promise.resolve();
    if (this.savePromise) {
      this.saveAgain = true;
      return this.savePromise;
    }
    this.savePromise = this.runSave().finally(() => {
      this.savePromise = null;
      if (this.saveAgain) {
        this.saveAgain = false;
        void this.save();
      }
    });
    return this.savePromise;
  }

  private async runSave(): Promise<void> {
    const open = this.store.get().open!;
    const id = open.summary.id;
    const snapshot = this.editor.doc();
    this.set(() => ({ save: "saving" }));
    try {
      const summary = await api<NoteSummary>("PUT", `/api/notes/${id}`, { text: snapshot.toString() });
      const now = this.store.get().open;
      if (!now || now.summary.id !== id) return;
      this.set(() => ({
        // Tags have their own queue; a text save's reply may predate a tag change made meanwhile.
        open: { ...now, summary: { ...summary, tags: now.summary.tags }, savedDoc: snapshot },
        save: this.editor.doc().eq(snapshot) ? "saved" : "unsaved",
      }));
      void this.refreshList();
    } catch (err) {
      if (this.store.get().open?.summary.id === id) this.set(() => ({ save: "failed" }));
      if (err instanceof ApiError && err.status === 401) return;
      toast(`Save failed: ${err instanceof Error ? err.message : err}`, true);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tags (README §3.13): saved at once, in order, per note

  setTags(tags: string[]): void {
    const open = this.store.get().open;
    if (!open || open.summary.trashedAt) return;
    const id = open.summary.id;
    const rev = (this.tagRevs.get(id) ?? 0) + 1;
    this.tagRevs.set(id, rev);
    const previous = open.summary.tags;
    this.set((s) => ({ open: s.open && { ...s.open, summary: { ...s.open.summary, tags } } }));
    const prev = this.tagQueues.get(id) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        try {
          const summary = await api<NoteSummary>("PUT", `/api/notes/${id}/tags`, { tags });
          const now = this.store.get().open;
          // Applied only if that note is still open and no newer tag change was made since.
          if (now?.summary.id === id && this.tagRevs.get(id) === rev) {
            this.set(() => ({ open: { ...now, summary: { ...now.summary, tags: summary.tags } } }));
          }
          void this.refresh();
        } catch (err) {
          const now = this.store.get().open;
          if (now?.summary.id === id && this.tagRevs.get(id) === rev) {
            this.set(() => ({ open: { ...now, summary: { ...now.summary, tags: previous } } }));
          }
          this.fail(err);
        }
      });
    this.tagQueues.set(id, next);
    void next.finally(() => {
      if (this.tagQueues.get(id) === next) this.tagQueues.delete(id);
    });
  }

  /** Before leaving a note, its tag changes reach the server. */
  async drainTags(): Promise<void> {
    await Promise.allSettled([...this.tagQueues.values()]);
  }

  // -------------------------------------------------------------------------------------------
  // Trash (README §3.16)

  async trashNote(): Promise<void> {
    const open = this.store.get().open;
    if (!open || open.summary.trashedAt) return;
    await this.settleSaves();
    const title = open.summary.title || "Untitled";
    const message = `Move "${title}" to the trash?${this.dirty() ? "\nYour unsaved changes will be lost." : ""}`;
    if (!window.confirm(message)) return;
    const id = open.summary.id;
    this.nav();
    // Nothing typed after the confirmation can be lost: the note is frozen until it's trashed.
    this.frozen.add(id);
    this.editor.setReadOnly(true);
    try {
      await this.drainTags();
      await api("POST", `/api/notes/${id}/trash`);
      this.frozen.delete(id);
      // Close it if it's still the note being shown (a view change doesn't leave it open as if
      // it weren't trashed); a note opened meanwhile stays.
      if (this.store.get().open?.summary.id === id) this.close();
      toast("Moved to trash");
      void this.refresh();
    } catch (err) {
      this.frozen.delete(id);
      if (this.store.get().open?.summary.id === id) this.restoreEditable();
      this.fail(err);
    }
  }

  async restore(): Promise<void> {
    const open = this.store.get().open;
    if (!open?.summary.trashedAt) return;
    const g = this.nav();
    try {
      await api("POST", `/api/notes/${open.summary.id}/restore`);
      const note = await api<NoteResponse>("GET", `/api/notes/${open.summary.id}`);
      if (g !== this.generation) return;
      this.set((s) => ({ view: { ...s.view, trash: false } }));
      this.install(note, g);
      toast("Restored");
      void this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  async deleteForever(): Promise<void> {
    const open = this.store.get().open;
    if (!open?.summary.trashedAt) return;
    const title = open.summary.title || "Untitled";
    if (!window.confirm(`Delete "${title}" forever? This can't be undone.`)) return;
    this.nav();
    const id = open.summary.id;
    try {
      await api("DELETE", `/api/notes/${id}`);
      if (this.store.get().open?.summary.id === id) this.close();
      void this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  async emptyTrash(): Promise<void> {
    // Count the whole trash, not the (possibly searched) list: Empty trash deletes all of it.
    let count: number;
    try {
      count = (await api<NoteSummary[]>("GET", "/api/notes?trash=1")).length;
    } catch (err) {
      this.fail(err);
      return;
    }
    if (!count) return;
    if (!window.confirm(`Empty the trash? ${count} note${count === 1 ? "" : "s"} will be deleted forever.`)) return;
    this.nav();
    try {
      await api("POST", "/api/trash/empty");
      if (this.store.get().open?.summary.trashedAt) this.close();
      void this.refresh();
    } catch (err) {
      this.fail(err);
    }
  }

  async toggleTrashView(): Promise<void> {
    this.nav();
    this.set((s) => ({ view: { ...s.view, trash: !s.view.trash }, notes: [], listLoaded: false }));
    await this.refreshList();
  }

  // -------------------------------------------------------------------------------------------
  // Filter and search

  setFilter(tag: string | null): void {
    this.set((s) => ({ view: { ...s.view, tag } }));
    void this.refreshList();
  }

  setQuery(query: string): void {
    this.set((s) => ({ view: { ...s.view, query } }));
    window.clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => void this.refreshList(), 200);
  }

  // -------------------------------------------------------------------------------------------
  // Preferences

  toggleMode(): void {
    const mode = this.store.get().prefs.mode === "render" ? "raw" : "render";
    prefs.setMode(mode);
    this.editor.setMode(mode);
    this.set((s) => ({ prefs: { ...s.prefs, mode }, ui: { ...s.ui, formatBar: false } }));
  }

  toggleFont(): void {
    const font = this.store.get().prefs.font === "mono" ? "prop" : "mono";
    prefs.setFont(font);
    this.editor.setFont(font);
    this.set((s) => ({ prefs: { ...s.prefs, font } }));
  }

  toggleSidebar(): void {
    const sidebar = this.store.get().prefs.sidebar === "open" ? "collapsed" : "open";
    prefs.setSidebar(sidebar);
    this.set((s) => ({ prefs: { ...s.prefs, sidebar } }));
  }

  setDrawer(open: boolean): void {
    this.set((s) => ({ ui: { ...s.ui, drawer: open } }));
  }

  toggleFormatBar(): void {
    const open = !this.editor.barOpen();
    this.editor.setBar(open);
    if (open) this.editor.focus();
  }

  onBarChange(open: boolean): void {
    this.set((s) => ({ ui: { ...s.ui, formatBar: open } }));
  }

  /** A 401 (README §3.18): reload to the login page, unless that would lose unsaved text. */
  onUnauthorized(): void {
    if (this.sessionEnded) return;
    this.sessionEnded = true;
    if (this.dirty()) {
      toast("Your session ended. Copy your text somewhere safe, then reload the page to log in again.", true, 0);
      return;
    }
    window.removeEventListener("beforeunload", this.beforeUnload);
    location.reload();
  }
}
