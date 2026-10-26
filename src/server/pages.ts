// GET / (architecture §5.4): the login page, the app, or the 404 page.

import { isNoteId, isTag } from "../shared/rules.ts";
import type { Ctx } from "./api.ts";
import type { StaticFiles } from "./http.ts";
import type { NoteStore } from "./store.ts";

/** Whether `?note=` / `?tag=` names something this user has (README §3.17). */
async function addressExists(store: NoteStore, user: string, params: URLSearchParams): Promise<boolean> {
  const keys = [...params.keys()];
  if (keys.some((k) => k !== "note" && k !== "tag")) return false;
  const notes = params.getAll("note");
  const tags = params.getAll("tag");
  if (notes.length > 1 || tags.length > 1 || (notes.length && tags.length)) return false;
  if (notes.length) return isNoteId(notes[0]) && (await store.exists(user, notes[0]));
  if (tags.length) return isTag(tags[0]) && (await store.tagInUse(user, tags[0]));
  return true;
}

export async function home(c: Ctx, files: StaticFiles, store: NoteStore): Promise<void> {
  if (!c.user) {
    await files.serve(c.req, c.res, "login.html");
    return;
  }
  if (!(await addressExists(store, c.user, c.url.searchParams))) {
    await files.serve(c.req, c.res, "404.html", 404);
    return;
  }
  await files.serve(c.req, c.res, "index.html");
}
