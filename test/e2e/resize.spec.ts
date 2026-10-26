// Resizing screenshots (owner decision, architecture §15): a drag handle writes `![60%](name.png)`.

import { expect, test, type Page } from "@playwright/test";
import { login, newNoteWithShot, raw } from "./helpers.ts";

test.beforeEach(async ({ page }) => login(page));

const columnWidth = (page: Page) => page.locator(".cm-shot-line").evaluate((l) => l.clientWidth);
const shotWidth = (page: Page) => page.locator(".cm-shot").evaluate((w) => w.getBoundingClientRect().width);

async function drag(page: Page, dx: number, opts: { cancel?: boolean } = {}) {
  await page.locator(".cm-shot img").hover();
  const handle = page.locator(".cm-shot-handle");
  await expect(handle).toHaveCSS("opacity", "1");
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await expect(page.locator(".cm-shot-size")).toBeVisible();
  if (opts.cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("dragging the handle writes the width; the file and the image element stay", async ({ page }) => {
  const name = await newNoteWithShot(page);
  const column = await columnWidth(page);
  expect(await shotWidth(page)).toBeCloseTo(400, 0);
  const img = await page.locator(".cm-shot img").elementHandle();
  await drag(page, 200);
  const pct = Math.round((600 / column) * 100);
  await expect.poll(() => raw(page)).toBe(`before\n![${pct}%](${name})\nafter`);
  expect(Math.abs((await shotWidth(page)) - (column * pct) / 100)).toBeLessThan(1);
  // The same <img>: no reload or flicker.
  expect(await page.evaluate((el) => el!.isConnected, img)).toBe(true);
  // One undo step puts it back.
  await page.evaluate(() => (window as any).margin.view.focus());
  await page.keyboard.press("Control+z");
  await expect.poll(() => raw(page)).toBe(`before\n![](${name})\nafter`);
});

test("widths are clamped to 10–100%; Esc cancels a drag", async ({ page }) => {
  const name = await newNoteWithShot(page, "50%");
  await drag(page, -2000);
  await expect.poll(() => raw(page)).toBe(`before\n![10%](${name})\nafter`);
  await drag(page, 3000);
  await expect.poll(() => raw(page)).toBe(`before\n![100%](${name})\nafter`);
  const column = await columnWidth(page);
  expect(Math.abs((await shotWidth(page)) - column)).toBeLessThan(1);
  await drag(page, -300, { cancel: true });
  expect(await raw(page)).toBe(`before\n![100%](${name})\nafter`);
  expect(Math.abs((await shotWidth(page)) - column)).toBeLessThan(1);
});

test("double-clicking the handle goes back to the natural size", async ({ page }) => {
  const name = await newNoteWithShot(page, "80%");
  await page.locator(".cm-shot img").hover();
  await page.locator(".cm-shot-handle").dblclick();
  await expect.poll(() => raw(page)).toBe(`before\n![](${name})\nafter`);
  expect(await shotWidth(page)).toBeCloseTo(400, 0);
});

test("a read-only note has no resize handle", async ({ page }) => {
  await newNoteWithShot(page, "50%");
  await page.evaluate(() => (window as any).margin.actions.editor.setReadOnly(true));
  await page.locator(".cm-shot img").hover();
  await expect(page.locator(".cm-shot-handle")).toBeHidden();
});
