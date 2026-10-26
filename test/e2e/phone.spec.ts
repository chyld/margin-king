import { expect, test } from "@playwright/test";
import { login, newNoteWith } from "./helpers.ts";

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
