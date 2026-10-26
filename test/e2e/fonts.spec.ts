// Fonts (architecture §15, Fonts), with the fixture fonts in test/fixtures/fonts: Fira Code and
// Liberation Mono (monospace), and Liberation Sans and Liberation Serif (other).

import { expect, test, type Page } from "@playwright/test";
import { login, newNoteWith, raw, select, setText } from "./helpers.ts";

const family = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
const listNames = (page: Page) => page.locator(".fmt-font-list").evaluate((l) => [...l.children].map((c) => `${c.className.includes("fmt-font-head") ? "#" : ""}${c.textContent}${c.classList.contains("is-current") ? " ✓" : ""}`));
/** Whether a face of the font exists and has loaded (`check` alone is true for a family with no faces). */
const loaded = (page: Page, id: string) =>
  page.evaluate(async (f) => (await document.fonts.load(`16px "margin-font-${f}"`)).some((face) => face.status === "loaded"), id);

test("the Font list replaces the swatches; picking a font applies it and closes the list", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await page.locator(".fmt-popup .fmt-font").click();
  await expect(page.locator(".fmt-font-list")).toBeVisible();
  await expect(page.locator(".fmt-swatches").first()).toBeHidden();
  expect(await listNames(page)).toEqual(["Default ✓", "#Monospace", "Fira Code", "Liberation Mono", "#Other", "Liberation Sans", "Liberation Serif"]);
  // Each name in its own font: opening the list loads them (WOFF2, TTF and WOFF here).
  expect(await family(page, ".fmt-font-item.ff-liberation-sans")).toContain("margin-font-liberation-sans");
  for (const id of ["fira-code", "liberation-mono", "liberation-sans", "liberation-serif"]) await expect.poll(() => loaded(page, id)).toBe(true);
  await page.locator(".fmt-font-item", { hasText: "Liberation Sans" }).click();
  expect(await raw(page)).toBe("x =={font-liberation-sans}word== y");
  await expect(page.locator(".fmt-font-list")).toBeHidden();
  await expect(page.locator(".fmt-swatches").first()).toBeVisible();
  // The same text stays selected, and the word shows in the font once it has loaded.
  expect(await page.evaluate(() => (window as any).margin.view.state.selection.main)).toMatchObject({ from: 26, to: 30 });
  expect(await family(page, ".cm-hl.ff-liberation-sans")).toMatch(/^"?margin-font-liberation-sans"?,/);
  await expect.poll(() => loaded(page, "liberation-sans")).toBe(true);
  // Checked now; Default removes it.
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default", "#Monospace", "Fira Code", "Liberation Mono", "#Other", "Liberation Sans ✓", "Liberation Serif"]);
  await page.locator(".fmt-font-item", { hasText: "Default" }).click();
  expect(await raw(page)).toBe("x word y");
});

test("inline code shows only monospace fonts, with their ligatures", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "see `x` here");
  await select(page, 0, 12);
  await page.locator(".fmt-popup .fmt-font").click();
  await page.locator(".fmt-font-item", { hasText: "Liberation Sans" }).click();
  // An "other" font skips the code, which keeps the default monospace font.
  expect(await raw(page)).toBe("=={font-liberation-sans}see ==`x`=={font-liberation-sans} here==");
  expect(await family(page, ".cm-code")).not.toContain("margin-font");
  await setText(page, "=={font-liberation-sans}see `x` here==");
  expect(await family(page, ".cm-code")).not.toContain("margin-font");
  await setText(page, "=={font-liberation-mono}see `x` here==");
  expect(await family(page, ".cm-code")).toMatch(/^"?margin-font-liberation-mono"?,/);
  expect(await page.locator(".cm-code").evaluate((el) => getComputedStyle(el).fontVariantLigatures)).toBe("normal");
  // Code-only targets list only monospace fonts.
  await setText(page, "see `x` here");
  await select(page, 5, 6);
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default ✓", "#Monospace", "Fira Code", "Liberation Mono"]);
});

test("a code block takes a monospace font on its opening fence", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "intro\n```\nif (a != b) go();\n```\nend");
  await select(page, 10, 14);
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default ✓", "#Monospace", "Fira Code", "Liberation Mono"]);
  await page.locator(".fmt-font-item", { hasText: "Liberation Mono" }).click();
  expect(await raw(page)).toBe("intro\n```font-liberation-mono\nif (a != b) go();\n```\nend");
  const body = ".cm-cb-body";
  expect(await family(page, body)).toMatch(/^"?margin-font-liberation-mono"?,/);
  expect(await page.locator(body).evaluate((el) => getComputedStyle(el).fontVariantLigatures)).toBe("normal");
  // The selection is the same code, moved by the fence's new word.
  const sel = await page.evaluate(() => (window as any).margin.view.state.selection.main);
  expect((await raw(page)).slice(sel.from, sel.to)).toBe("if (");
  // A block marked with an "other" font shows the default monospace font.
  await setText(page, "```font-liberation-sans\nx\n```");
  expect(await family(page, ".cm-cb-body")).not.toContain("margin-font");
});

test("a font that isn't installed shows the default; the list offers to remove it", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "a =={b+font-gone}word== b");
  expect(await family(page, ".cm-hl")).not.toContain("margin-font");
  await select(page, 17, 21);
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default", "gone (not installed) ✓", "#Monospace", "Fira Code", "Liberation Mono", "#Other", "Liberation Sans", "Liberation Serif"]);
  await expect(page.locator(".fmt-font-item.is-missing")).toBeDisabled();
  await page.locator(".fmt-font-item", { hasText: "Default" }).click();
  expect(await raw(page)).toBe("a =={b}word== b");
});

test("spacing: a font-only highlight has no side padding; bold-only keeps its 3px", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "a =={font-liberation-sans}one== =={b}two== =={lime+font-liberation-sans}three==");
  const pad = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(await pad(".cm-hl-font:not(.cm-hl-color)")).toBe("0px");
  expect(await pad(".cm-hl-b")).toBe("3px");
  expect(await pad(".cm-hl-font.cm-hl-color")).toBe("3px");
});

test("raw mode stays all monospace and shows the markers", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "a =={font-liberation-sans}word== b");
  await page.keyboard.press("Control+e");
  await expect(page.locator(".cm-editor")).not.toHaveClass(/mode-render/);
  await expect(page.locator(".cm-line").first()).toHaveText("a =={font-liberation-sans}word== b");
  expect(await page.locator(".cm-line").first().evaluate((l) => [...l.querySelectorAll("*"), l].map((e) => getComputedStyle(e).fontFamily).join("|"))).not.toContain("margin-font");
});

test("keyboard: Enter on Font opens the list on the checked entry; arrows and Enter pick; Esc goes back", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.keyboard.press("ArrowDown"); // the ring appears on B
  await page.keyboard.press("ArrowDown"); // Link
  await page.keyboard.press("ArrowRight"); // Font
  await expect(page.locator(".fmt-popup .fmt-font")).toHaveClass(/is-focus/);
  await page.keyboard.press("Enter");
  await expect(page.locator(".fmt-font-item", { hasText: "Default" })).toHaveClass(/is-focus/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".fmt-font-list")).toBeHidden();
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await expect(page.locator(".fmt-popup .fmt-font")).toHaveClass(/is-focus/);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown"); // Fira Code (headings are skipped)
  await page.keyboard.press("ArrowDown"); // Liberation Mono
  await page.keyboard.press("ArrowDown"); // Liberation Sans
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x =={font-liberation-sans}word== y");
  await expect(page.locator(".fmt-font-list")).toBeHidden();
  await expect(page.locator(".fmt-popup .fmt-font")).toHaveClass(/is-focus/);
});

test("the caret follows the text when a font finishes loading after the note is drawn", async ({ page }) => {
  // Hold the font back so the note is drawn, and the caret placed, with the fallback font first.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/fonts/liberation-sans/**", async (route) => {
    await held;
    await route.continue();
  });
  await login(page);
  await newNoteWith(page, "start =={font-liberation-sans}wwwwwwwwwwwwwwwwwwww==");
  const end = (await raw(page)).length - 2;
  await select(page, end);
  const gap = () =>
    page.evaluate((pos) => {
      const view = (window as any).margin.view;
      const cursor = document.querySelector(".cm-cursor")!.getBoundingClientRect();
      return Math.abs(cursor.left - view.coordsAtPos(pos).left);
    }, end);
  await expect.poll(gap).toBeLessThan(2);
  const before = await page.evaluate((pos) => (window as any).margin.view.coordsAtPos(pos).left, end);
  release();
  await expect.poll(() => loaded(page, "liberation-sans")).toBe(true);
  // The text got narrower, and the drawn caret moved with it.
  await expect.poll(() => page.evaluate((pos) => (window as any).margin.view.coordsAtPos(pos).left, end)).not.toBe(before);
  await expect.poll(gap).toBeLessThan(2);
});

test("a picked monospace font's ligatures are drawn in code; the default code font has none (Muse code r1 #8)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "```font-fira-code\na != b -> c\n```\n```\na != b -> c\n```\nend");
  await expect.poll(() => loaded(page, "fira-code")).toBe(true);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  // Each line drawn as is, then with ligatures turned off: only Fira Code's line changes.
  const changes = async (line: number) => {
    const el = page.locator(".cm-cb-body").nth(line);
    const on = await el.screenshot();
    await el.evaluate((e) => {
      e.style.fontVariantLigatures = "none";
      e.style.fontFeatureSettings = '"liga" 0, "calt" 0';
    });
    return !on.equals(await el.screenshot());
  };
  expect(await changes(0)).toBe(true);
  expect(await changes(1)).toBe(false);
});

test("a list opened before the font list arrives fills in when it does (Muse code r1 #7)", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/fonts", async (route) => {
    await held;
    await route.continue();
  });
  await login(page);
  // A font that isn't installed keeps the Font button there before the list arrives.
  await newNoteWith(page, "a =={font-gone}word== b");
  await select(page, 15, 19);
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default", "gone (not installed) ✓"]);
  release();
  await expect.poll(() => listNames(page)).toEqual(["Default", "gone (not installed) ✓", "#Monospace", "Fira Code", "Liberation Mono", "#Other", "Liberation Sans", "Liberation Serif"]);
});

test("with no fonts installed the Font button is hidden, unless the target has a font (Sonnet code r1 #2)", async ({ page }) => {
  await page.route("**/api/fonts", (route) => route.fulfill({ json: { fonts: [] } }));
  await login(page);
  await newNoteWith(page, "plain =={font-gone}word== end");
  await select(page, 0, 5);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await expect(page.locator(".fmt-popup .fmt-font")).toBeHidden();
  await select(page, 19, 23);
  await expect(page.locator(".fmt-popup .fmt-font")).toBeVisible();
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default", "gone (not installed) ✓"]);
  // The missing font can still be removed (GLM code r1 #5).
  await page.locator(".fmt-font-item", { hasText: "Default" }).click();
  expect(await raw(page)).toBe("plain word end");
});

test("the pinned bar sets the font of the code block the cursor is in (Sonnet code r1 #2)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "intro\n```\ncode here\n```");
  await select(page, 12);
  await page.click(".palette");
  await expect(page.locator(".fmt-popup .fmt-font")).toBeEnabled();
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default ✓", "#Monospace", "Fira Code", "Liberation Mono"]);
  await page.locator(".fmt-font-item", { hasText: "Fira Code" }).click();
  expect(await raw(page)).toBe("intro\n```font-fira-code\ncode here\n```");
});

test("with the list opened by mouse, Enter moves the ring into it instead of editing the note (MiniMax code r1 #3)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await page.locator(".fmt-popup .fmt-font").click();
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x word y");
  await expect(page.locator(".fmt-font-item", { hasText: "Default" })).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("x =={font-fira-code}word== y");
});

test("the ring stays on its option when the Font button appears beside it (MiniMax code r1 #4)", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/fonts", async (route) => {
    await held;
    await route.continue();
  });
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup .fmt-font")).toBeHidden();
  await page.keyboard.press("ArrowDown"); // B
  await page.keyboard.press("ArrowDown"); // Link
  await page.keyboard.press("ArrowRight"); // Remove color (Font isn't there yet)
  await expect(page.locator(".fmt-popup .fmt-nocolor")).toHaveClass(/is-focus/);
  release();
  await expect(page.locator(".fmt-popup .fmt-font")).toBeVisible();
  await expect(page.locator(".fmt-popup .fmt-nocolor")).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".fmt-popup .fmt-font")).toHaveClass(/is-focus/);
});

test("an open list follows a change to the note under it (DeepSeek code r1 #4)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x =={font-liberation-sans}word== y");
  await select(page, 26, 30);
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toContain("Liberation Sans ✓");
  // The marker's font changes while the selection stays where it is.
  await page.evaluate(() => (window as any).margin.view.dispatch({ changes: { from: 10, to: 25, insert: "liberation-mono" } }));
  await expect.poll(() => listNames(page)).toContain("Liberation Mono ✓");
  expect(await listNames(page)).not.toContain("Liberation Sans ✓");
});

test("fonts the list can't offer are still shown: not installed, or not for code (DeepSeek code r1 #5)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "see =={font-liberation-sans}`x`== here\n=={font-gone-one}a== =={font-gone-two}b==");
  // Code alone, in an "other" font that code can't show.
  await select(page, 29, 30);
  await page.locator(".fmt-popup .fmt-font").click();
  expect(await listNames(page)).toEqual(["Default", "Liberation Sans (not for code) ✓", "#Monospace", "Fira Code", "Liberation Mono"]);
  // Two missing fonts: both listed, neither checked.
  const line2 = (await raw(page)).indexOf("=={font-gone-one}");
  await select(page, line2, (await raw(page)).length);
  await page.locator(".fmt-popup .fmt-font").click();
  expect((await listNames(page)).slice(0, 3)).toEqual(["Default", "gone-one (not installed)", "gone-two (not installed)"]);
});

test("mixed selections: text, inline code and a block each take what they can (DeepSeek code r1 #7)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "see `x` here");
  await select(page, 0, 12);
  await page.locator(".fmt-popup .fmt-font").click();
  await page.locator(".fmt-font-item", { hasText: "Fira Code" }).click();
  expect(await raw(page)).toBe("=={font-fira-code}see `x` here==");
  expect(await family(page, ".cm-hl")).toMatch(/^"?margin-font-fira-code"?,/);
  expect(await family(page, ".cm-code")).toMatch(/^"?margin-font-fira-code"?,/);

  await setText(page, "intro\n```\ncode\n```\nend");
  const all = async () => select(page, 0, (await raw(page)).length);
  await all();
  await page.locator(".fmt-popup .fmt-font").click();
  await page.locator(".fmt-font-item", { hasText: "Liberation Sans" }).click();
  expect(await raw(page)).toBe("=={font-liberation-sans}intro==\n```\ncode\n```\n=={font-liberation-sans}end==");
  expect(await family(page, ".cm-hl")).toMatch(/^"?margin-font-liberation-sans"?,/);
  expect(await family(page, ".cm-cb-body")).not.toContain("margin-font");
  // The whole note stays selected: the next pick reaches the block too.
  const sel = await page.evaluate(() => (window as any).margin.view.state.selection.main);
  const text = await raw(page);
  expect(text.slice(sel.from, sel.to)).toContain("intro==\n```\ncode\n```\n=={font-liberation-sans}end");
  await page.locator(".fmt-popup .fmt-font").click();
  await page.locator(".fmt-font-item", { hasText: "Liberation Mono" }).click();
  expect(await raw(page)).toBe("=={font-liberation-mono}intro==\n```font-liberation-mono\ncode\n```\n=={font-liberation-mono}end==");
  expect(await family(page, ".cm-cb-body")).toMatch(/^"?margin-font-liberation-mono"?,/);
});

test("the ring opens on a checked font the list can't apply, where Enter does nothing (Grok code r1 #7)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "see =={font-liberation-sans}`x`== here");
  await select(page, 29, 30);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.keyboard.press("ArrowDown"); // B
  await page.keyboard.press("ArrowDown"); // Link
  await page.keyboard.press("ArrowRight"); // Font
  await page.keyboard.press("Enter");
  const checked = page.locator(".fmt-font-item", { hasText: "Liberation Sans (not for code)" });
  await expect(checked).toHaveClass(/is-focus/);
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("see =={font-liberation-sans}`x`== here");
  await expect(page.locator(".fmt-font-list")).toBeVisible();
  // Default is one step up, and does apply.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  expect(await raw(page)).toBe("see `x` here");
});

test("in the list, Up from the top, Left or Right take the ring back to the Font button; Down from there goes in (GLM code r1 #4)", async ({ page }) => {
  await login(page);
  await newNoteWith(page, "x word y");
  await select(page, 2, 6);
  await expect(page.locator(".fmt-popup")).toBeVisible();
  await page.locator(".fmt-popup .fmt-font").click();
  const font = page.locator(".fmt-popup .fmt-font");
  const item = (name: string) => page.locator(".fmt-font-item", { hasText: name });
  await page.keyboard.press("ArrowDown"); // into the list, on the checked entry
  await expect(item("Default")).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowUp"); // from the top, back to Font
  await expect(font).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowLeft"); // along the row: Link
  await expect(page.locator(".fmt-popup .fmt-link")).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown"); // from the second row, into the list
  await page.keyboard.press("ArrowDown");
  await expect(item("Fira Code")).toHaveClass(/is-focus/);
  await page.keyboard.press("ArrowRight"); // back to Font
  await expect(font).toHaveClass(/is-focus/);
  await expect(page.locator(".fmt-font-list")).toBeVisible();
  expect(await raw(page)).toBe("x word y");
});

test("the list opens at the top each time, not where it was last scrolled", async ({ page }) => {
  // Narrow, so the list docks and is short enough to scroll. A hidden element keeps its scroll
  // position, and the browser restores it when the list shows again.
  await page.setViewportSize({ width: 700, height: 800 });
  await login(page);
  await newNoteWith(page, "a =={font-fira-code}one== b two");
  const list = page.locator(".fmt-font-list");
  const text = await raw(page);
  await select(page, text.indexOf("two"), text.indexOf("two") + 3);
  await page.locator(".fmt-popup .fmt-font").click();
  await list.evaluate((l) => (l.scrollTop = l.scrollHeight));
  await page.locator(".fmt-font-item", { hasText: "Liberation Serif" }).click();
  await expect(list).toBeHidden();
  await select(page, text.indexOf("one"), text.indexOf("one") + 3);
  await page.locator(".fmt-popup .fmt-font").click();
  await expect(page.locator(".fmt-font-item", { hasText: "Fira Code" })).toHaveClass(/is-current/);
  expect(await list.evaluate((l) => l.scrollTop)).toBe(0);
});
