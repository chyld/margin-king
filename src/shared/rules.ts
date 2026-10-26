// Validators shared by the server, the CLI and the client.

export const USERNAME_RE = /^[a-z0-9_-]{1,32}$/;
export const TAG_RE = /^[a-z0-9]{1,40}$/;
export const NOTE_ID_RE = /^[a-z0-9]{8}$/;
export const IMAGE_NAME_RE = /^[a-z0-9]{8}\.png$/;
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_TAG_LENGTH = 40;

/** A web address as the parser recognizes it inside `[text](url)` (README §3.5). */
export const LINK_URL_RE = /^https?:\/\/[^\s<>()[\]`]+$/;

export function isUsername(s: string): boolean {
  return USERNAME_RE.test(s);
}

export function isTag(s: string): boolean {
  return TAG_RE.test(s);
}

export function isNoteId(s: string): boolean {
  return NOTE_ID_RE.test(s);
}

export function isImageName(s: string): boolean {
  return IMAGE_NAME_RE.test(s);
}

/** Tags with duplicates removed, first occurrence kept. */
export function dedupeTags(tags: readonly string[]): string[] {
  return [...new Set(tags)];
}

/** What the tag box keeps of typed text: lowercase `a-z0-9`, at most 40 characters. */
export function cleanTagInput(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_TAG_LENGTH);
}

/**
 * The Link prompt's address (README §3.6): `example.org` becomes `https://example.org`.
 * Returns null when the result isn't something the parser would recognize as a link.
 */
export function normalizeUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[^:/]+:\d/.test(url)) return null;
    url = `https://${url}`;
  }
  url = url.replace(/^https?/i, (s) => s.toLowerCase());
  if (!LINK_URL_RE.test(url)) return null;
  if (url.replace(/^https?:\/\//, "").length === 0) return null;
  return url;
}
