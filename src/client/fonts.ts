// Fonts (architecture §15, Fonts): the server's list, fetched once per page load, as `@font-face`
// rules and the classes render mode and the font list use.

import { api } from "./api.ts";

export interface FontFaceInfo {
  /** A CSS `font-weight`: "400", "700", or a variable font's "100 900". */
  weight: string;
  format: string;
  url: string;
}

export interface FontInfo {
  id: string;
  name: string;
  mono: boolean;
  faces: FontFaceInfo[];
}

let list: FontInfo[] = [];
const listeners = new Set<() => void>();

/** The installed fonts: monospace first, then the others, each by name. */
export function installedFonts(): readonly FontInfo[] {
  return list;
}

export function fontById(id: string): FontInfo | undefined {
  return list.find((f) => f.id === id);
}

/** Told when the list arrives, and when any font finishes loading (text widths change). */
export function onFontsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const changed = () => {
  for (const fn of listeners) fn();
};

/** The rules for the installed fonts. Ids and URLs come from the server: `[a-z0-9-]` and paths. */
export function fontCss(fonts: readonly FontInfo[]): string {
  const out: string[] = [];
  for (const f of fonts) {
    const family = `"margin-font-${f.id}"`;
    for (const face of f.faces) {
      out.push(`@font-face { font-family: ${family}; src: url("${face.url}") format("${face.format}"); font-weight: ${face.weight}; font-display: swap; }`);
    }
    out.push(`.mode-render .cm-hl.ff-${f.id} { font-family: ${family}, var(--note-font); }`);
    out.push(`.fmt-font-list .ff-${f.id} { font-family: ${family}, ${f.mono ? "var(--mono)" : "var(--ui)"}; }`);
    // Only a monospace font reaches code, and there its ligatures show (owner decision).
    if (f.mono) {
      out.push(
        `.mode-render .cm-code.ff-${f.id}, .mode-render .cm-cb.ff-${f.id} { font-family: ${family}, var(--mono); font-variant-ligatures: normal; font-feature-settings: normal; }`,
      );
    }
  }
  return out.join("\n");
}

/** Fetch the list (once, at boot) and add its rules. If it fails, there are no fonts this time. */
export async function loadFonts(): Promise<void> {
  try {
    list = (await api<{ fonts: FontInfo[] }>("GET", "/api/fonts")).fonts;
  } catch (err) {
    console.warn("margin: couldn't load the font list", err);
    list = [];
    return;
  }
  if (!list.length) return;
  const style = document.createElement("style");
  style.id = "margin-fonts";
  style.textContent = fontCss(list);
  document.head.appendChild(style);
  changed();
}

// A font that finishes loading changes the width of the text that uses it.
document.fonts?.addEventListener("loadingdone", changed);
document.fonts?.addEventListener("loadingerror", changed);
