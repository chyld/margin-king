import { expect, test } from "@playwright/test";
import { login, newNoteWith, raw, select } from "./helpers.ts";

test.beforeEach(async ({ page }) => login(page));

test("typing at the end of a highlighted word extends it; → steps out", async ({ page }) => {
  await newNoteWith(page, "x =={green}wrist== y");
  await select(page, "x =={green}wrist".length);
  await page.keyboard.type("s");
  expect(await raw(page)).toBe("x =={green}wrists== y");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("!");
  expect(await raw(page)).toBe("x =={green}wrists==! y");
});

test("End at a closing marker leaves the caret inside the highlight", async ({ page }) => {
  await newNoteWith(page, "a\n=={green}wrist==");
  await select(page, 0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type("s");
  expect(await raw(page)).toBe("a\n=={green}wrists==");
});

test("clicking at the end of a highlighted word, then typing, extends it", async ({ page }) => {
  await newNoteWith(page, "Title\n=={green}wrist== more");
  const box = await page.locator(".cm-hl").first().boundingBox();
  await page.mouse.click(box!.x + box!.width - 1, box!.y + box!.height / 2);
  await page.keyboard.type("s");
  expect(await raw(page)).toBe("Title\n=={green}wrists== more");
});

test("Backspace after a highlight deletes its last letter; emptied tokens go", async ({ page }) => {
  await newNoteWith(page, "a =={b}xy== b");
  await select(page, "a =={b}xy==".length);
  await page.keyboard.press("Backspace");
  expect(await raw(page)).toBe("a =={b}x== b");
  await page.keyboard.press("Backspace");
  expect(await raw(page)).toBe("a  b");
});

test("Enter inside a highlight closes and reopens it", async ({ page }) => {
  await newNoteWith(page, "=={green}wrist==");
  await select(page, "=={green}wri".length);
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("=={green}wri==\n=={green}st==");
  await page.keyboard.type("X");
  expect(await raw(page)).toBe("=={green}wri==\n=={green}Xst==");
});

test("headings: Backspace at the start un-headings; Enter there breaks before it", async ({ page }) => {
  await newNoteWith(page, "x\n## {red} Title");
  await select(page, "x\n## {red} ".length);
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x\n\n## {red} Title");
  await page.keyboard.press("Backspace");
  expect(await raw(page)).toBe("x\n\nTitle");
});

test("undo restores the exact text, and the caret stays out of hidden syntax", async ({ page }) => {
  await newNoteWith(page, "a word here");
  await select(page, 2, 6);
  await page.locator(".fmt-popup .fmt-b").dispatchEvent("pointerdown");
  expect(await raw(page)).toBe("a =={b}word== here");
  await page.keyboard.press("Control+z");
  expect(await raw(page)).toBe("a word here");
  await page.keyboard.press("Control+y");
  expect(await raw(page)).toBe("a =={b}word== here");
});

test("collapsed sections render, toggle and are remembered", async ({ page }) => {
  const id = await newNoteWith(page, "T\n## {green} Metrics\nhidden line\n## {blue} Next\nshown");
  await expect(page.locator(".cm-fold")).toHaveCount(2);
  await page.locator(".cm-fold").first().click();
  await expect(page.locator(".cm-ellipsis")).toBeVisible();
  await expect(page.locator(".cm-content")).not.toContainText("hidden line");
  await page.goto(`/?note=${id}`);
  await expect(page.locator(".cm-ellipsis")).toBeVisible();
  await page.locator(".cm-ellipsis").click();
  await expect(page.locator(".cm-content")).toContainText("hidden line");
});

test("raw mode shows the syntax; Ctrl+E switches", async ({ page }) => {
  await newNoteWith(page, "=={green}x==");
  await expect(page.locator(".cm-content")).not.toContainText("=={green}");
  await page.keyboard.press("Control+e");
  await expect(page.locator(".cm-content")).toContainText("=={green}x==");
  await page.keyboard.press("Control+e");
  await expect(page.locator(".cm-content")).not.toContainText("=={green}");
});

test("code blocks: fences hidden until the caret is on them; Copy copies the code", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await newNoteWith(page, "intro\n```js\nconst a = 1;\n```\nend");
  await select(page, 0);
  await expect(page.locator(".cm-content")).not.toContainText("```js");
  await page.locator(".cm-cb-body").hover();
  await page.locator(".cm-copy").click();
  await expect(page.locator(".cm-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const a = 1;");
  await select(page, "intro\n".length);
  await expect(page.locator(".cm-content")).toContainText("```js");
});

test("copy across lines keeps formatting as balanced syntax", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await newNoteWith(page, "=={green}wrist exercises==\nhello");
  await select(page, "=={green}wrist ".length, "=={green}wrist exercises==\nhel".length);
  await page.keyboard.press("Control+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("=={green}exercises==\nhel");
});

test("Tab indents code lines only", async ({ page }) => {
  await newNoteWith(page, "```\na\n```");
  await select(page, 4);
  await page.keyboard.press("Tab");
  expect(await raw(page)).toBe("```\n  a\n```");
});
