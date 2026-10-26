import { expect, test, type Page } from "@playwright/test";
import { login, newNoteWith, newNoteWithShot } from "./helpers.ts";

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
    async tap(x: number, y: number) {
      await send("touchStart", x, y);
      await send("touchEnd", x, y);
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
