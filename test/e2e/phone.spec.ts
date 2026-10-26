import { expect, test } from "@playwright/test";
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

test("phone: dragging the handle with a finger resizes the screenshot", async ({ page }) => {
  await login(page);
  const name = await newNoteWithShot(page, "80%");
  await page.locator(".cm-shot img").tap();
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", px: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y }] });
  await touch("touchStart", x);
  for (let i = 1; i <= 6; i++) await touch("touchMove", x - i * 20);
  await touch("touchEnd", x - 120);
  await expect.poll(() => page.evaluate(() => (window as any).margin.view.state.doc.line(2).text)).toMatch(new RegExp(`^!\\[\\d+%\\]\\(${name.replace(".", "\\.")}\\)$`));
  const text: string = await page.evaluate(() => (window as any).margin.view.state.doc.line(2).text);
  expect(Number(/(\d+)%/.exec(text)![1])).toBeLessThan(80);
});
