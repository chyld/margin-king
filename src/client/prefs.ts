// Per-browser preferences (README §3.3, §3.4, §3.8, §3.15).

import type { Font, Mode } from "./editor/editor.ts";

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing or a full quota: preferences just don't persist.
  }
}

export const prefs = {
  mode: (): Mode => (get("margin:mode") === "raw" ? "raw" : "render"),
  setMode: (m: Mode) => set("margin:mode", m),
  font: (): Font => (get("margin:font") === "prop" ? "prop" : "mono"),
  setFont: (f: Font) => set("margin:font", f),
  sidebar: (): "open" | "collapsed" => (get("margin:sidebar") === "collapsed" ? "collapsed" : "open"),
  setSidebar: (v: "open" | "collapsed") => set("margin:sidebar", v),
  collapsed(noteId: string): string[] {
    try {
      const v = JSON.parse(get(`margin:collapsed:${noteId}`) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  },
  setCollapsed(noteId: string, keys: string[]): void {
    set(`margin:collapsed:${noteId}`, keys.length ? JSON.stringify(keys) : null);
  },
};
