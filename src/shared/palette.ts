// The 12 hues of the note palette (README §3.5), each light and deep, in README order.

export interface Hue {
  name: string;
  light: string;
  deep: string;
}

export const HUES: readonly Hue[] = [
  { name: "red", light: "#ffd2cc", deep: "#ff9b93" },
  { name: "orange", light: "#ffd7b8", deep: "#ffa46e" },
  { name: "amber", light: "#ffdfac", deep: "#ebb353" },
  { name: "lime", light: "#d9eeb7", deep: "#aacc6b" },
  { name: "green", light: "#c2f3cb", deep: "#7cd590" },
  { name: "mint", light: "#b2f5dd", deep: "#53d8b1" },
  { name: "teal", light: "#a8f5f4", deep: "#2ad7d7" },
  { name: "sky", light: "#b0efff", deep: "#4fcdff" },
  { name: "blue", light: "#c9e6ff", deep: "#8fbdff" },
  { name: "violet", light: "#e7dbff", deep: "#c4acff" },
  { name: "fuchsia", light: "#ffd3fe", deep: "#eb9fe8" },
  { name: "pink", light: "#ffd0e7", deep: "#ff99c2" },
];

const COLORS = new Map<string, string>();
for (const hue of HUES) {
  COLORS.set(hue.name, hue.light);
  COLORS.set(`${hue.name}-deep`, hue.deep);
}

/** The 24 color names: `<hue>` (light) then `<hue>-deep`, hue by hue. */
export const COLOR_NAMES: readonly string[] = HUES.flatMap((h) => [h.name, `${h.name}-deep`]);

export function isColor(name: string): boolean {
  return COLORS.has(name);
}

export function colorHex(name: string): string {
  const hex = COLORS.get(name);
  if (!hex) throw new Error(`Unknown color: ${name}`);
  return hex;
}

/** The section color Margin uses for a new heading (README §3.6). */
export const DEFAULT_SECTION_COLOR = "blue-deep";
