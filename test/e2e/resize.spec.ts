// Resizing screenshots (owner decision, architecture §15): a drag handle writes `![60%](name.png)`.

import { expect, test, type Page } from "@playwright/test";
import { login, newNoteWith, newNoteWithShot, raw, setText, uploadShot } from "./helpers.ts";

test.beforeEach(async ({ page }) => login(page));

const columnWidth = (page: Page) => page.locator(".cm-shot-line").evaluate((l) => l.clientWidth);
const shotWidth = (page: Page) => page.locator(".cm-shot").evaluate((w) => w.getBoundingClientRect().width);

async function drag(page: Page, dx: number, opts: { cancel?: boolean; nth?: number } = {}) {
  await page.locator(".cm-shot img").nth(opts.nth ?? 0).hover();
  const handle = page.locator(".cm-shot-handle").nth(opts.nth ?? 0);
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

test("a jiggle on the handle writes nothing (Sonnet resize #2)", async ({ page }) => {
  const name = await newNoteWithShot(page);
  await page.locator(".cm-shot img").hover();
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4, y);
  await page.mouse.move(x + 3, y);
  await page.mouse.up();
  expect(await raw(page)).toBe(`before\n![](${name})\nafter`);
});

test("a drag cut short by a note switch writes nothing and leaves no listeners (Sonnet resize #3)", async ({ page }) => {
  await newNoteWithShot(page);
  await page.locator(".cm-shot img").hover();
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 4 });
  await page.evaluate(() => (window as any).margin.actions.editor.clear());
  await page.mouse.up();
  await expect(page.locator(".cm-shot-size")).toHaveCount(0);
  const escapes = await page.evaluate(() => {
    let n = 0;
    document.addEventListener("keydown", (e) => e.key === "Escape" && n++);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return n;
  });
  expect(escapes).toBe(1);
});

test("redo puts a resize back (Ctrl+Y and Ctrl+Shift+Z)", async ({ page }) => {
  const name = await newNoteWithShot(page);
  await drag(page, -100);
  const sized = await raw(page);
  expect(sized).toMatch(new RegExp(`^before\\n!\\[\\d+%\\]\\(${name.replace(".", "\\.")}\\)\\nafter$`));
  await page.evaluate(() => (window as any).margin.view.focus());
  await page.keyboard.press("Control+z");
  await expect.poll(() => raw(page)).toBe(`before\n![](${name})\nafter`);
  await page.keyboard.press("Control+y");
  await expect.poll(() => raw(page)).toBe(sized);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+Z"); // A real keyboard sends a capital Z with Shift.
  await expect.poll(() => raw(page)).toBe(sized);
});

async function grab(page: Page) {
  await page.locator(".cm-shot img").hover();
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

test("Esc after an undo mid-drag shows what the line says (Sol resize #1)", async ({ page }) => {
  const name = await newNoteWithShot(page, "60%");
  await drag(page, 60);
  const resized = await raw(page);
  expect(resized).not.toContain("![60%]");
  const { x, y } = await grab(page);
  await page.mouse.move(x - 80, y, { steps: 4 });
  await page.keyboard.press("Control+z");
  await expect.poll(() => raw(page)).toBe(`before\n![60%](${name})\nafter`);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await page.locator(".cm-shot").evaluate((w) => (w as HTMLElement).style.width)).toBe("60%");
});

test("a mode switch mid-drag ends the drag cleanly (Sol resize #2)", async ({ page }) => {
  const name = await newNoteWithShot(page);
  const { x, y } = await grab(page);
  await page.mouse.move(x - 80, y, { steps: 4 });
  await page.keyboard.press("Control+e");
  await page.mouse.up();
  expect(await raw(page)).toBe(`before\n![](${name})\nafter`);
  const escapes = await page.evaluate(() => {
    let n = 0;
    document.addEventListener("keydown", (e) => e.key === "Escape" && n++);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return n;
  });
  expect(escapes).toBe(1);
});

test("the drawn caret follows the text while an image is resized (Sol resize #3)", async ({ page }) => {
  await newNoteWithShot(page);
  await page.evaluate(() => {
    const view = (window as any).margin.view;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const { x, y } = await grab(page);
  await page.mouse.move(x - 200, y, { steps: 6 });
  const gap = () =>
    page.evaluate(() => {
      const view = (window as any).margin.view;
      const drawn = document.querySelector(".cm-cursor")!.getBoundingClientRect().top;
      return Math.abs(drawn - view.coordsAtPos(view.state.selection.main.head).top);
    });
  await expect.poll(gap).toBeLessThan(3);
  await page.mouse.up();
});

test("a screenshot narrower than 10% stays put until dragged past it (Muse resize #1)", async ({ page }) => {
  const name = await newNoteWithShot(page, "", [40, 20]);
  const column = await columnWidth(page);
  await drag(page, -10);
  expect(await raw(page)).toBe(`before\n![](${name})\nafter`);
  expect(await shotWidth(page)).toBeCloseTo(40, 0);
  await drag(page, 5);
  expect(await raw(page)).toBe(`before\n![](${name})\nafter`);
  await drag(page, 120);
  await expect.poll(() => raw(page)).toBe(`before\n![${Math.round((160 / column) * 100)}%](${name})\nafter`);
});

test("the second of two screenshots resizes alone (Muse resize #3)", async ({ page }) => {
  const id = await newNoteWith(page, "x");
  const one = await uploadShot(page, id);
  const two = await uploadShot(page, id);
  await setText(page, `a\n![](${one})\nb\n![](${two})\nc`);
  await expect(page.locator(".cm-shot img")).toHaveCount(2);
  await expect.poll(() => page.locator(".cm-shot img").nth(1).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
  await drag(page, -100, { nth: 1 });
  await expect.poll(() => raw(page)).toMatch(new RegExp(`^a\\n!\\[\\]\\(${one}\\)\\nb\\n!\\[\\d+%\\]\\(${two}\\)\\nc$`.replaceAll(".png", "\\.png")));
});

test("in a colored section the width is a share of the section's text column (Muse resize #3)", async ({ page }) => {
  const id = await newNoteWith(page, "x");
  const name = await uploadShot(page, id);
  await setText(page, `## {red} Section\n![](${name})\nafter`);
  await expect.poll(() => page.locator(".cm-shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
  const column = await page.locator(".cm-shot-line").evaluate((l) => {
    const s = getComputedStyle(l);
    return l.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  });
  await drag(page, 100);
  const pct = Math.round((500 / column) * 100);
  await expect.poll(() => raw(page)).toBe(`## {red} Section\n![${pct}%](${name})\nafter`);
  expect(Math.abs((await shotWidth(page)) - (column * pct) / 100)).toBeLessThan(1);
});

test("a missing screenshot has no resize handle (Muse resize #3)", async ({ page }) => {
  await newNoteWith(page, "x");
  await setText(page, "before\n![50%](zzzzzzzz.png)\nafter");
  await expect(page.locator(".cm-shot-missing")).toHaveText("Missing screenshot");
  await expect(page.locator(".cm-shot-handle")).toHaveCount(0);
});

test("an undo that removes the screenshot mid-drag ends the drag (Kimi resize #2)", async ({ page }) => {
  await newNoteWithShot(page);
  const { x, y } = await grab(page);
  await page.mouse.move(x - 80, y, { steps: 4 });
  await page.keyboard.press("Control+z"); // Undoes the test's setup, which put the screenshot in.
  await page.mouse.up();
  await expect(page.locator(".cm-shot")).toHaveCount(0);
  await expect(page.locator(".cm-shot-size")).toHaveCount(0);
  expect(await raw(page)).not.toContain("![");
  const escapes = await page.evaluate(() => {
    let n = 0;
    document.addEventListener("keydown", (e) => e.key === "Escape" && n++);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return n;
  });
  expect(escapes).toBe(1);
});

test("on a screenshot taller than the window the handle is where the pointer is (DeepSeek resize #1)", async ({ page }) => {
  const name = await newNoteWithShot(page, "", [400, 1600]);
  const img = page.locator(".cm-shot img");
  await img.hover({ position: { x: 200, y: 120 } });
  const imgBox = (await img.boundingBox())!;
  const box = (await page.locator(".cm-shot-handle").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThan(viewport.height);
  expect(Math.abs(box.y + box.height / 2 - (imgBox.y + 120))).toBeLessThan(12);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 5 });
  const label = (await page.locator(".cm-shot-size").boundingBox())!;
  expect(label.y + label.height).toBeLessThan(viewport.height);
  await page.mouse.up();
  await expect.poll(() => raw(page)).toMatch(new RegExp(`!\\[\\d+%\\]\\(${name.replace(".", "\\.")}\\)`));
});

test("a resized screenshot keeps its width after saving and reopening (DeepSeek resize #6)", async ({ page }) => {
  const name = await newNoteWithShot(page);
  await drag(page, -120);
  const sized = await raw(page);
  await page.evaluate(() => (window as any).margin.view.focus());
  await page.keyboard.press("Control+s");
  await expect(page.locator(".save")).toHaveAttribute("data-state", "saved");
  const id = await page.evaluate(() => (window as any).margin.store.get().open.summary.id);
  await page.goto(`/?note=${id}`);
  await expect.poll(() => raw(page)).toBe(sized);
  const pct = Number(/!\[(\d+)%\]/.exec(sized)![1]);
  await expect.poll(() => page.locator(".cm-shot img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(400);
  const column = await columnWidth(page);
  expect(Math.abs((await shotWidth(page)) - (column * pct) / 100)).toBeLessThan(1);
  expect(sized).toContain(name);
});
