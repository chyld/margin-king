// The app's state (architecture §7.1). Only actions.ts changes it.

import type { Text } from "@codemirror/state";
import type { Font, Mode } from "./editor/editor.ts";

export interface NoteSummary {
  id: string;
  title: string;
  created: string;
  modified: string;
  tags: string[];
  trashedAt: string | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface OpenNote {
  summary: NoteSummary;
  savedDoc: Text;
  /** The navigation generation this note was opened in. */
  generation: number;
}

export type SaveState = "saved" | "unsaved" | "saving" | "failed";

export interface AppState {
  user: string;
  view: { trash: boolean; tag: string | null; query: string };
  notes: NoteSummary[];
  listLoaded: boolean;
  tags: TagCount[];
  open: OpenNote | null;
  loading: boolean;
  save: SaveState;
  prefs: { mode: Mode; font: Font; sidebar: "open" | "collapsed" };
  ui: { drawer: boolean; formatBar: boolean };
}

type Listener = (state: AppState, prev: AppState) => void;

export class Store {
  private state: AppState;
  private listeners: Listener[] = [];

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  update(fn: (s: AppState) => AppState): void {
    const prev = this.state;
    const next = fn(prev);
    if (next === prev) return;
    this.state = next;
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }
}
