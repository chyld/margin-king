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
