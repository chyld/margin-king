import { expect, type Page } from "@playwright/test";

export async function login(page: Page, user = "alice", password = "secret", path = "/"): Promise<void> {
  await page.goto(path);
  await page.fill("input[name=username]", user);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await expect(page.locator(".new-note")).toBeVisible();
}

/** The raw document text. */
export function raw(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).margin.view.state.doc.toString());
}

/** Put the caret (or a selection) at raw offsets. */
export async function select(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.evaluate(([a, h]) => {
    const view = (window as any).margin.view;
    view.focus();
    view.dispatch({ selection: { anchor: a, head: h } });
  }, [anchor, head]);
}

/** A new note with this raw text, saved, with the editor focused. */
export async function newNoteWith(page: Page, text: string): Promise<string> {
  const openId = () => page.evaluate(() => (window as any).margin?.store.get().open?.summary.id ?? null);
  const before = await openId();
  await page.click(".new-note");
  await expect.poll(openId).not.toBe(before);
  await expect(page.locator(".paper-wrap")).toBeVisible();
  await page.evaluate((t) => {
    const view = (window as any).margin.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, text);
  await page.keyboard.press("Control+s");
  await expect(page.locator(".save")).toHaveAttribute("data-state", "saved");
  return page.evaluate(() => (window as any).margin.store.get().open.summary.id);
}

/** A new note `before / screenshot / after`, with a real 400×200 PNG uploaded; returns the image name. */
export async function newNoteWithShot(page: Page, size = ""): Promise<string> {
  const id = await newNoteWith(page, "x");
  const name: string = await page.evaluate(async (noteId) => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#7c5cff";
    g.fillRect(0, 0, 400, 200);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    const res = await fetch(`/api/notes/${noteId}/images`, { method: "POST", headers: { "X-Margin": "1", "Content-Type": "image/png" }, body: blob });
    return (await res.json()).name;
  }, id);
  await page.evaluate((t) => {
    const view = (window as any).margin.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, `before\n![${size}](${name})\nafter`);
  await expect.poll(() => page.locator(".cm-shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
  return name;
}
