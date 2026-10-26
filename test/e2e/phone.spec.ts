import { expect, test, type Page } from "@playwright/test";
import { login, newNoteWith, newNoteWithShot, raw, select } from "./helpers.ts";

test("phone: the drawer opens with no note, closes when a note opens", async ({ page }) => {
  await login(page);
  await expect(page.locator(".app")).toHaveClass(/drawer-open/);
  await newNoteWith(page, "Phone note");
  await expect(page.locator(".app")).not.toHaveClass(/drawer-open/);
  await page.click(".menubar .menu");
  await expect(page.locator(".app")).toHaveClass(/drawer-open/);
  await page.locator(".card", { hasText: "Phone note" }).click();
  await expect(page.locator(".app")).not.toHaveClass(/drawer-open/);
});

test("phone: tapping a screenshot shows its resize handle", async ({ page }) => {
  await login(page);
  await newNoteWithShot(page);
  const handle = page.locator(".cm-shot-handle");
  await expect(handle).toHaveCSS("opacity", "0");
  await page.locator(".cm-shot img").tap();
  await expect(handle).toHaveCSS("opacity", "1");
  await page.locator(".cm-line", { hasText: "after" }).tap();
  await expect(handle).toHaveCSS("opacity", "0");
});

/** A finger on the page through Chromium's touch input (real pointer events, unlike synthetic ones). */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  return {
    async drag(x: number, y: number, dx: number) {
      await send("touchStart", x, y);
      for (let i = 1; i <= 6; i++) await send("touchMove", x + (dx * i) / 6, y);
      await send("touchEnd", x + dx, y);
    },
    /** One touch that goes `dx` sideways and comes back to within 2px of where it started. */
    async outAndBack(x: number, y: number, dx: number) {
      await send("touchStart", x, y);
      for (let i = 1; i <= 5; i++) await send("touchMove", x + (dx * i) / 5, y);
      for (let i = 4; i >= 0; i--) await send("touchMove", x + (dx * i) / 5 + 2, y);
      await send("touchEnd", x + 2, y);
    },
    async tap(x: number, y: number) {
      await send("touchStart", x, y);
      await send("touchEnd", x, y);
    },
    async swipe(x: number, y: number, dy: number) {
      await send("touchStart", x, y);
      for (let i = 1; i <= 8; i++) await send("touchMove", x, y + (dy * i) / 8);
      await send("touchEnd", x, y + dy);
    },
  };
}

const line2 = (page: Page) => page.evaluate(() => (window as any).margin.view.state.doc.line(2).text);

test("phone: dragging the handle with a finger resizes the screenshot", async ({ page }) => {
  await login(page);
  const name = await newNoteWithShot(page, "80%");
  await page.locator(".cm-shot img").tap();
  const column = await page.locator(".cm-shot-line").evaluate((l) => l.clientWidth);
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  await (await finger(page)).drag(box.x + box.width / 2, box.y + box.height / 2, -60);
  const expected = Math.round(((column * 0.8 - 60) / column) * 100);
  await expect.poll(() => line2(page)).toBe(`![${expected}%](${name})`);
});

test("phone: the hidden handle ignores a finger until the image is tapped (Sonnet resize #1)", async ({ page }) => {
  await login(page);
  const name = await newNoteWithShot(page, "80%");
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  await (await finger(page)).drag(box.x + box.width / 2, box.y + box.height / 2, -60);
  await page.waitForTimeout(200);
  expect(await line2(page)).toBe(`![80%](${name})`);
});

test("phone: a double tap on the handle goes back to the natural size (Sonnet resize #4)", async ({ page }) => {
  await login(page);
  const name = await newNoteWithShot(page, "80%");
  await page.locator(".cm-shot img").tap();
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const f = await finger(page);
  await f.tap(box.x + box.width / 2, box.y + box.height / 2);
  expect(await line2(page)).toBe(`![80%](${name})`);
  await f.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => line2(page)).toBe(`![](${name})`);
});

test("phone: a drag that comes back to its start isn't a double tap (DeepSeek resize #2)", async ({ page }) => {
  await login(page);
  const name = await newNoteWithShot(page, "60%");
  await page.locator(".cm-shot img").tap();
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const f = await finger(page);
  await f.tap(x, y);
  await f.outAndBack(x, y, -150);
  await page.waitForTimeout(200);
  expect(await line2(page)).toBe(`![60%](${name})`);
});

test("phone: on a tall screenshot the handle shows where the image was tapped (DeepSeek resize #1)", async ({ page }) => {
  await login(page);
  await newNoteWithShot(page, "100%", [400, 1600]);
  const img = page.locator(".cm-shot img");
  await img.tap({ position: { x: 100, y: 80 } });
  const imgBox = (await img.boundingBox())!;
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  expect(box.y + box.height).toBeLessThan(page.viewportSize()!.height);
  expect(Math.abs(box.y + box.height / 2 - (imgBox.y + 80))).toBeLessThan(16);
});

test("phone: in the font list a tap picks a font, and a swipe scrolls it without picking one (architecture §15)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toHaveClass(/is-docked/);
  await page.locator(".fmt-popup .fmt-font").tap();
  const list = page.locator(".fmt-font-list");
  await expect(list).toBeVisible();
  const f = await finger(page);
  const box = (await list.boundingBox())!;
  await f.swipe(box.x + box.width / 2, box.y + box.height - 12, -70);
  await expect.poll(() => list.evaluate((l) => l.scrollTop)).toBeGreaterThan(0);
  expect(await raw(page)).toBe("x word y");
  await expect(list).toBeVisible();
  const item = (await page.locator(".fmt-font-item", { hasText: "Liberation Serif" }).boundingBox())!;
  await f.tap(item.x + item.width / 2, item.y + item.height / 2);
  await expect.poll(() => raw(page)).toBe("x =={font-liberation-serif}word== y");
  await expect(list).toBeHidden();
});
