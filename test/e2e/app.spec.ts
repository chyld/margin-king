import { expect, test } from "@playwright/test";
import { login, newNoteWith, raw, select } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("logging in through a ?note= link lands on the note", async ({ page }) => {
  await login(page);
  const id = await newNoteWith(page, "Linked note");
  await page.click(".logout");
  await expect(page.locator("input[name=username]")).toBeVisible();
  await page.goto(`/?note=${id}`);
  await page.fill("input[name=username]", "alice");
  await page.fill("input[name=password]", "secret");
  await page.click("button[type=submit]");
  await expect(page.locator(".cm-content")).toContainText("Linked note");
  expect(page.url()).toContain(`?note=${id}`);
});

test("unsaved changes: the save button and the discard prompt", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "First");
  await select(page, 5);
  await page.keyboard.type("!");
  await expect(page.locator(".save")).toHaveAttribute("data-state", "unsaved");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".save")).toHaveAttribute("data-state", "saved");
  await page.keyboard.type("?");
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.click(".new-note");
  expect(asked).toBe("You have unsaved changes. Discard them?");
  expect(await raw(page)).toBe("First?");
});

test("the formatting popup: shows on a selection, one click applies once, Esc hides it", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.locator(".fmt-popup .fmt-b").click();
  expect(await raw(page)).toBe("x =={b}word== y");
  await page.locator(".fmt-popup .hl-lime").click();
  expect(await raw(page)).toBe("x =={lime+b}word== y");
  await page.keyboard.press("Escape");
  await expect(page.locator(".fmt-popup")).toBeHidden();
});

test("popup keyboard: no focus until an arrow; Enter applies the focused option", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".fmt-popup .fmt-b")).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x =={u}word== y");
});

test("cancelling the Link prompt changes nothing", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "[docs](https://a.com)");
  await select(page, 1, 5);
  page.once("dialog", (d) => void d.dismiss());
  await page.locator(".fmt-popup .fmt-link").click();
  expect(await raw(page)).toBe("[docs](https://a.com)");
});

test("the pinned bar formats the word at the cursor", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "wrist exercises");
  await select(page, 9);
  await page.click(".palette");
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.locator(".fmt-popup .fmt-b").click();
  expect(await raw(page)).toBe("wrist =={b}exercises==");
});

test("tags: suggestions, Enter takes the highlighted one", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "Tagged");
  await page.click(".tag-box");
  await page.keyboard.type("alpha");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tag-chips .chip")).toHaveText(["alpha×"]);
  await newNoteWith(page, "Other");
  await page.click(".tag-box");
  await page.keyboard.type("alp");
  await expect(page.locator(".suggestions .sugg.is-hi")).toContainText("alpha");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tag-chips .chip")).toHaveText(["alpha×"]);
});

test("trash, the trash view, restore", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "Doomed");
  page.once("dialog", (d) => void d.accept());
  await page.click(".trash-note");
  await expect(page.locator(".toast").last()).toContainText("Moved to trash");
  await page.click(".trash-toggle");
  await expect(page.locator(".trash-head")).toBeVisible();
  await page.locator(".card", { hasText: "Doomed" }).click();
  await expect(page.locator(".trash-banner")).toBeVisible();
  await expect(page.locator(".save")).toBeHidden();
  await page.click(".banner-restore");
  await expect(page.locator(".toast").last()).toContainText("Restored");
  await expect(page.locator(".trash-banner")).toBeHidden();
});

test("pasting a PNG uploads it and inserts the screenshot line", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "before\nafter");
  await select(page, "before".length);
  await page.evaluate((bytes) => {
    const file = new File([new Uint8Array(bytes)], "shot.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const view = (window as any).margin.view;
    view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [...PNG]);
  await expect.poll(() => raw(page)).toMatch(/^before\n!\[\]\([a-z0-9]{8}\.png\)\nafter$/);
  await expect(page.locator(".cm-shot img")).toBeVisible();
});

test("a screenshot that finishes uploading after switching notes isn't inserted elsewhere", async ({ page }) => {
  await login(page);
  const other = await newNoteWith(page, "other note");
  await newNoteWith(page, "source");
  await page.route("**/images", async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await select(page, 6);
  await page.evaluate((bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "s.png", { type: "image/png" }));
    (window as any).margin.view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [...PNG]);
  await page.evaluate((id) => (window as any).margin.actions.openNote(id), other);
  await page.waitForTimeout(1500);
  expect(await raw(page)).toBe("other note");
});

test("404 pages", async ({ page }) => {
  await login(page);
  const res = await page.goto("/?note=zzzzzzzz");
  expect(res?.status()).toBe(404);
  await expect(page.locator(".not-found")).toContainText("That note or tag doesn't exist.");
});

test("home from the logo clears the note and the address", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "Somewhere");
  await page.click(".logo");
  await expect(page.locator(".empty-state")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("the { } button shows the note's meta.json, read-only (owner decision)", async ({ page }) => {
  await login(page);
  await expect(page.locator(".meta-note")).toBeHidden();
  const id = await newNoteWith(page, "Meta please");
  await page.click(".tag-box");
  await page.keyboard.type("alpha");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tag-chips .chip")).toHaveCount(1);
  await page.evaluate(() => (window as any).margin.view.focus());
  await page.click(".meta-note");
  const dialog = page.locator(".meta-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".meta-path")).toHaveText(new RegExp(`^notes/alice/${id}/meta\\.json$`));
  const file = await page.evaluate(async (noteId) => (await (await fetch(`/api/notes/${noteId}/meta`)).json()).text, id);
  await expect(dialog.locator(".meta-json")).toHaveText(file.replace(/\n$/, ""));
  expect(JSON.parse(file).tags).toEqual(["alpha"]);
  await expect(dialog.locator(".meta-note")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as any).margin.view.hasFocus)).toBe(true);
  // Unsaved text isn't in the file yet, and the panel says so; a click outside closes it.
  await page.keyboard.type(" more");
  await page.click(".meta-note");
  await expect(dialog.locator(".meta-note")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});

test("a trashed note's meta.json can be viewed too", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "Trash and look");
  page.on("dialog", (d) => void d.accept());
  await page.click(".trash-note");
  await page.click(".trash-toggle");
  await page.locator(".card", { hasText: "Trash and look" }).click();
  await expect(page.locator(".trash-banner")).toBeVisible();
  await page.click(".meta-note");
  await expect(page.locator(".meta-json")).toContainText('"trashedAt": "');
  await page.locator(".meta-close").click();
  await expect(page.locator(".meta-dialog")).toBeHidden();
});
