// Regressions found by beta code reviews (reproductions adapted from the reviewers' scratch tests).

import { expect, test, type Page } from "@playwright/test";
import { login, newNoteWith, raw, select } from "./helpers.ts";

const store = (page: Page) => page.evaluate(() => (window as any).margin.store.get());

/** Hold requests matching `url` (and `method`) until the returned release() is called. */
async function gate(page: Page, url: string, method?: string) {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const seen = new Promise<void>((r) => (started = r));
  await page.route(url, async (route) => {
    if (method && route.request().method() !== method) return route.continue();
    started();
    await open;
    await route.continue();
  });
  return { seen, release };
}

test.beforeEach(async ({ page }) => login(page));

test("typing while New note is pending isn't lost (Sol r1 #2)", async ({ page }) => {
  const a = await newNoteWith(page, "Original");
  const g = await gate(page, "**/api/notes", "POST");
  await page.click(".new-note");
  await g.seen;
  await page.locator(".cm-content").click();
  await page.keyboard.type("LOST");
  expect(await raw(page)).toBe("Original");
  g.release();
  await expect.poll(async () => (await store(page)).open?.summary.id).not.toBe(a);
});

test("a late Trash response doesn't close a different note (Sol r1 #1)", async ({ page }) => {
  const b = await newNoteWith(page, "Note B");
  const a = await newNoteWith(page, "Note A");
  const g = await gate(page, `**/api/notes/${a}/trash`);
  page.on("dialog", (d) => void d.accept());
  await page.click(".trash-note");
  await g.seen;
  await page.evaluate((id) => void (window as any).margin.actions.openNote(id), b);
  await expect.poll(async () => (await store(page)).open?.summary.id).toBe(b);
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" UNSAVED");
  g.release();
  await expect(page.locator(".toast").last()).toContainText("Moved to trash");
  expect((await store(page)).open?.summary.id).toBe(b);
  expect(await raw(page)).toContain("UNSAVED");
});

test("an older tag response doesn't undo a newer tag change (Sol r1 #5)", async ({ page }) => {
  const id = await newNoteWith(page, "Tag race");
  let n = 0;
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  await page.route(`**/api/notes/${id}/tags`, async (route) => {
    n++;
    if (n === 1) await open;
    await route.continue();
  });
  await page.evaluate(() => (window as any).margin.actions.setTags(["alpha"]));
  await page.evaluate(() => (window as any).margin.actions.setTags(["alpha", "beta"]));
  release();
  await page.evaluate(() => (window as any).margin.actions.drainTags());
  expect((await store(page)).open.summary.tags).toEqual(["alpha", "beta"]);
  await page.evaluate(() => {
    const m = (window as any).margin;
    m.actions.setTags([...m.store.get().open.summary.tags, "gamma"]);
  });
  await page.evaluate(() => (window as any).margin.actions.drainTags());
  const saved = await page.evaluate(async (noteId) => (await (await fetch(`/api/notes/${noteId}`)).json()).tags, id);
  expect(saved).toEqual(["alpha", "beta", "gamma"]);
});

test("toggling the trash view during a note load leaves the open note editable (Sol r1 #9)", async ({ page }) => {
  const b = await newNoteWith(page, "Load B");
  const a = await newNoteWith(page, "Load A");
  const g = await gate(page, `**/api/notes/${b}`);
  await page.evaluate((id) => void (window as any).margin.actions.openNote(id), b);
  await g.seen;
  await page.click(".trash-toggle");
  g.release();
  await page.waitForTimeout(150);
  const s = await page.evaluate(() => ({
    loading: (window as any).margin.store.get().loading,
    ro: (window as any).margin.view.state.readOnly,
    id: (window as any).margin.store.get().open.summary.id,
  }));
  expect(s).toEqual({ loading: false, ro: false, id: a });
});

test("Empty trash counts the whole trash, not the search results (Sol r1 #3)", async ({ page }) => {
  const a = await newNoteWith(page, "Delete target unique");
  const b = await newNoteWith(page, "Other hidden note");
  await page.evaluate(async (ids) => {
    for (const id of ids) await fetch(`/api/notes/${id}/trash`, { method: "POST", headers: { "X-Margin": "1" } });
  }, [a, b]);
  await page.evaluate(() => (window as any).margin.actions.goHome());
  await page.click(".trash-toggle");
  await page.fill(".search", "Delete target unique");
  await expect(page.locator(".card")).toHaveCount(1);
  let prompt = "";
  page.once("dialog", (d) => {
    prompt = d.message();
    void d.dismiss();
  });
  await page.click(".empty-trash");
  const total = await page.evaluate(async () => (await (await fetch("/api/notes?trash=1")).json()).length);
  expect(total).toBeGreaterThanOrEqual(2);
  await expect.poll(() => prompt).toContain(`${total} notes`);
});

test("a composition repair can't change the next note (Sol r1 #4)", async ({ page }) => {
  const b = await newNoteWith(page, "plain");
  await newNoteWith(page, "=={b}original==");
  await select(page, 8);
  page.on("dialog", (d) => void d.accept());
  await page.evaluate((id) => {
    const m = (window as any).margin;
    const v = m.view;
    v.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    v.dispatch({ changes: { from: 8, to: 8, insert: "中" }, userEvent: "input.type.compose" });
    v.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
    void m.actions.openNote(id);
  }, b);
  await page.waitForTimeout(150);
  expect(await raw(page)).toBe("plain");
});

test("a deletion of several characters keeps its range (Sol r1 #10)", async ({ page }) => {
  await newNoteWith(page, "hello world");
  await select(page, 11);
  await page.evaluate(() => {
    (window as any).margin.view.dispatch({ changes: { from: 6, to: 11, insert: "" }, userEvent: "delete.backward" });
  });
  expect(await raw(page)).toBe("hello ");
});

test("typing at the end of a collapsed heading expands it (Sol r1 #11)", async ({ page }) => {
  await newNoteWith(page, "T\n## {red} Heading\nhidden body");
  await page.locator(".cm-fold").click();
  await expect(page.locator(".cm-ellipsis")).toBeVisible();
  await select(page, "T\n## {red} Heading".length);
  await page.keyboard.type("X");
  await expect(page.locator(".cm-ellipsis")).toHaveCount(0);
  expect(await raw(page)).toBe("T\n## {red} HeadingX\nhidden body");
});

test("unwrapping a code block keeps the selection (Sol r1 #12)", async ({ page }) => {
  await newNoteWith(page, "```\ncode text\n```");
  await select(page, 4, 13);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const s = await page.evaluate(() => {
    const v = (window as any).margin.view;
    return { text: v.state.doc.toString(), from: v.state.selection.main.from, to: v.state.selection.main.to };
  });
  expect(s).toEqual({ text: "code text", from: 0, to: 9 });
});

test("bold over mixed lines makes both bold; part of a link can be bold (Sol r1 #7, #8)", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await newNoteWith(page, "a\n=={b}b==");
  await select(page, 0, 10);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  expect(await raw(page)).toBe("=={b}a==\n=={b}b==");
  await newNoteWith(page, "[docs](https://a.com)");
  await select(page, 2, 3);
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  expect(await raw(page)).toBe("[d](https://a.com)=={b}[o](https://a.com)==[cs](https://a.com)");
});

test("after Enter applies a popup option, the focus ring stays for the next one (Muse r1 #5)", async ({ page }) => {
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x =={b}word== y");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x =={b+u}word== y");
});

test("space in the tag box adds what was typed, not the suggestion (Muse r1 #6)", async ({ page }) => {
  await newNoteWith(page, "Has alpha");
  await page.click(".tag-box");
  await page.keyboard.type("alpha");
  await page.keyboard.press("Enter");
  await newNoteWith(page, "Typed tag");
  await page.click(".tag-box");
  await page.keyboard.type("alp");
  await page.keyboard.press(" ");
  await expect(page.locator(".tag-chips .chip")).toHaveText(["alp×"]);
});

test("a right-click on a popup button does nothing (Sonnet r1 #5)", async ({ page }) => {
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.locator(".fmt-popup .fmt-b").click({ button: "right" });
  expect(await raw(page)).toBe("x word y");
});

test("two compositions back to back are both repaired (GLM r1 #5)", async ({ page }) => {
  await newNoteWith(page, "[d](https://a.com)");
  await select(page, 2);
  await page.evaluate(() => {
    const v = (window as any).margin.view;
    const fire = (type: string) => v.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: "" }));
    fire("compositionstart");
    v.dispatch({ changes: { from: 2, insert: "]" }, userEvent: "input.type.compose" });
    fire("compositionend");
    fire("compositionstart");
    v.dispatch({ changes: { from: 3, insert: "x" }, userEvent: "input.type.compose" });
    fire("compositionend");
  });
  await page.waitForTimeout(150);
  // The typed ] splits the link instead of breaking it (both compositions went through the engine).
  expect(await raw(page)).toBe("[d](https://a.com)]x");
});

test("a save queued during a save finishes before leaving; no prompt for saved text (Grok r1 #1)", async ({ page }) => {
  const id = await newNoteWith(page, "GOOD");
  let n = 0;
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  await page.route(`**/api/notes/${id}`, async (route) => {
    if (route.request().method() === "PUT" && ++n === 1) await hold;
    await route.continue();
  });
  await select(page, 4);
  await page.keyboard.type(" BAD");
  await page.keyboard.press("Control+s");
  await page.keyboard.type(" WORSE");
  await page.keyboard.press("Control+s");
  let prompted = false;
  page.on("dialog", (d) => {
    prompted = true;
    void d.accept();
  });
  const leaving = page.click(".new-note");
  release();
  await leaving;
  await expect.poll(async () => (await page.evaluate(() => (window as any).margin.store.get().open?.summary.id))).not.toBe(id);
  expect(prompted).toBe(false);
  const saved = await page.evaluate(async (noteId) => (await (await fetch(`/api/notes/${noteId}`)).json()).text, id);
  expect(saved).toBe("GOOD BAD WORSE");
});

test("a failed tag save takes the chip back (Grok r1 #4)", async ({ page }) => {
  const id = await newNoteWith(page, "Tag fails");
  await page.route(`**/api/notes/${id}/tags`, (route) => route.fulfill({ status: 500, body: JSON.stringify({ error: "Server error" }) }));
  await page.click(".tag-box");
  await page.keyboard.type("alpha");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tag-chips .chip")).toHaveCount(0);
});

test("New note interrupted by the trash view leaves the open note editable (Grok r1 #3)", async ({ page }) => {
  const a = await newNoteWith(page, "Stay editable");
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  await page.route("**/api/notes", async (route) => {
    if (route.request().method() === "POST") await hold;
    await route.continue();
  });
  await page.click(".new-note");
  await page.click(".trash-toggle");
  release();
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => ({ ro: (window as any).margin.view.state.readOnly, id: (window as any).margin.store.get().open.summary.id }));
  expect(s).toEqual({ ro: false, id: a });
});

test("a text save's reply doesn't take back a tag added meanwhile (Kimi r1 #4)", async ({ page }) => {
  const id = await newNoteWith(page, "Tags race");
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let started!: () => void;
  const seen = new Promise<void>((r) => (started = r));
  await page.route(`**/api/notes/${id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch(); // The server saves now; only the reply waits.
    started();
    await hold;
    await route.fulfill({ response });
  });
  const serverTags = () => page.evaluate(async (noteId) => (await (await fetch(`/api/notes/${noteId}`)).json()).tags, id);
  await select(page, 9);
  await page.keyboard.type("!");
  await page.keyboard.press("Control+s");
  await seen;
  await page.click(".tag-box");
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  await expect.poll(serverTags).toEqual(["x"]);
  release();
  await expect.poll(async () => (await store(page)).save).toBe("saved");
  await expect(page.locator(".tag-chips .chip")).toHaveCount(1);
  await page.keyboard.type("y");
  await page.keyboard.press("Enter");
  await expect.poll(serverTags).toEqual(["x", "y"]);
});

test("each change of a multi-change edit lands where it was aimed (Kimi r1 #7)", async ({ page }) => {
  await newNoteWith(page, "https://a.com");
  await page.evaluate(() => {
    const view = (window as any).margin.view;
    view.dispatch({ changes: [{ from: 1, insert: "\n" }, { from: 5, insert: "\n" }], userEvent: "input.type" });
  });
  expect(await raw(page)).toBe("[h](https://a.com)\n[ttps](https://a.com)\n[://a.com](https://a.com)");
});
