// Fonts (architecture §15, Fonts): reading font metadata, scanning the folders, and the routes.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fontId, FontError, loadFonts, MAX_FONT_FILE, readFaceInfo } from "../../src/server/fonts.ts";
import { configFromEnv } from "../../src/server/main.ts";
import { sfnt, woff, woff2, type FakeFont } from "./fontfiles.ts";
import { cli, Client, start, type Running } from "./helpers.ts";

const dirs: string[] = [];
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** A fonts folder from `{ "monospace/a/b.ttf": bytes }`. */
async function tree(files: Record<string, Buffer | string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "margin-fonts-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  return root;
}

async function scan(root: string | undefined) {
  const lines: string[] = [];
  const table = await loadFonts(root, (m) => lines.push(m));
  const fonts = table.list().fonts.map((f) => ({
    id: f.id,
    name: f.name,
    mono: f.mono,
    faces: f.faces.map((face, i) => `${face.weight} ${table.fonts.find((x) => x.id === f.id)!.faces[i].file}`),
  }));
  return { table, fonts, log: lines.join("\n") };
}

const ttf = (f: FakeFont) => sfnt(f);

describe("reading a font file's metadata", () => {
  test("sfnt, WOFF and WOFF2 give the same answers", () => {
    const f: FakeFont = { family: "Inter Bold", typoFamily: "Inter", style: "Bold", weight: 700, fixedPitch: false };
    for (const [bytes, format] of [
      [sfnt(f), "truetype"],
      [sfnt(f, "OTTO"), "opentype"],
      [sfnt(f, "true"), "truetype"],
      [woff(f), "woff"],
      [woff2(f), "woff2"],
      [woff2(f, true), "woff2"],
    ] as const) {
      assert.deepEqual(readFaceInfo(bytes), { family: "Inter", weight: 700, italic: false, range: null, fixedPitch: false, format });
    }
  });

  test("italics, variable weight ranges, fixed pitch, Mac names", () => {
    assert.equal(readFaceInfo(woff2({ family: "A", italic: true })).italic, true);
    // Some fonts flag an italic as Regular; the style name still says it.
    assert.equal(readFaceInfo(sfnt({ family: "A", style: "Bold Italic" })).italic, true);
    assert.deepEqual(readFaceInfo(woff2({ family: "A", wght: [300, 700] })).range, [300, 700]);
    assert.equal(readFaceInfo(sfnt({ family: "A", fixedPitch: true })).fixedPitch, true);
    assert.equal(readFaceInfo(sfnt({ family: "Mac Name", mac: true })).family, "Mac Name");
    // Mac Roman isn't Latin-1: 0x8E is é (Sol code r1 #5).
    assert.equal(readFaceInfo(sfnt({ family: "Caf\u008e Cr\u008fme", mac: true })).family, "Café Crème");
    assert.equal(readFaceInfo(sfnt({ family: "A", weight: 7 })).weight, 700);
  });

  test("anything else is refused with a reason", () => {
    const why = (b: Buffer) => {
      try {
        readFaceInfo(b);
        return "read";
      } catch (err) {
        assert.ok(err instanceof FontError || err instanceof Error);
        return (err as Error).message;
      }
    };
    assert.equal(why(Buffer.from("PK\x03\x04 a zip")), "not a font file");
    assert.equal(why(Buffer.from("ttcf....")), "font collections aren't supported");
    assert.equal(why(sfnt({ family: "A" }).subarray(0, 40)), "the file is cut short");
    assert.equal(why(Buffer.alloc(2)), "the file is cut short");
  });

  test("a table that unpacks to more than it declares is refused, before it's all unpacked (Sol code r1 #1)", () => {
    const why = (b: Buffer) => {
      try {
        readFaceInfo(b);
        return "read";
      } catch (err) {
        return (err as Error).message;
      }
    };
    // 2 MB of zeros pack to a few KB; the file says the table is 16 KB.
    const lie = { family: "Bomb", padName: 2 * 1024 * 1024, declareName: 16 * 1024 };
    assert.equal(why(woff(lie)), "its name table doesn't unpack to its size");
    assert.equal(why(woff2(lie)), "its tables don't unpack to their size");
    // A table that claims to be huge isn't unpacked at all.
    assert.equal(why(woff({ ...lie, declareName: 64 * 1024 * 1024 })), "its name table is too large");
    assert.equal(why(woff2({ ...lie, declareName: 300 * 1024 * 1024 })), "its tables are too large");
    // A packed table longer than the original isn't valid.
    assert.equal(why(woff({ ...lie, declareName: 100 })), "its name table is longer packed than unpacked");
    // The honest version reads.
    assert.equal(readFaceInfo(woff({ family: "Fine", padName: 2 * 1024 * 1024 })).family, "Fine");
  });
});

describe("ids", () => {
  test("from the family name, valid for the note grammar", () => {
    assert.equal(fontId("JetBrains Mono"), "jetbrains-mono");
    assert.equal(fontId("  Fira_Code v6.2 "), "fira-code-v6-2");
    assert.equal(fontId("Crème Brûlée"), "creme-brulee");
    assert.equal(fontId("思源黑体"), null);
    assert.equal(fontId("a".repeat(47) + " b"), "a".repeat(47));
    assert.equal(fontId("a".repeat(46) + " b"), "a".repeat(46) + "-b");
    assert.equal(fontId("a".repeat(49)), "a".repeat(48));
  });
});

describe("scanning the folders", () => {
  test("no folder, or no fonts dir: no fonts, never an error", async () => {
    assert.deepEqual((await scan(undefined)).fonts, []);
    const empty = await tree({ "README.md": "x" });
    const r = await scan(empty);
    assert.deepEqual(r.fonts, []);
    assert.match(r.log, /no monospace\/ folder/);
    assert.match(r.log, /no other\/ folder/);
  });

  test("files are grouped by family across folders and formats", async () => {
    const root = await tree({
      "other/Inter/static/Inter-Regular.ttf": ttf({ family: "Inter" }),
      "other/Inter/web/Inter-Regular.woff2": woff2({ family: "Inter" }),
      "other/loose/Inter-Bold.woff": woff({ family: "Inter", weight: 700, style: "Bold" }),
      "other/Inter/Inter-Italic.ttf": ttf({ family: "Inter", italic: true }),
      "other/Inter/OFL.txt": "licence",
    });
    const r = await scan(root);
    assert.deepEqual(r.fonts, [{ id: "inter", name: "Inter", mono: false, faces: ["400 Inter/web/Inter-Regular.woff2", "700 loose/Inter-Bold.woff"] }]);
    assert.match(r.log, /other\/: ignored 1 file that aren't fonts/);
  });

  test("a variable face wins, declared with its own weight range", async () => {
    const root = await tree({
      "monospace/ttf/FiraCode-Regular.ttf": ttf({ family: "Fira Code" }),
      "monospace/ttf/FiraCode-Bold.ttf": ttf({ family: "Fira Code", weight: 700 }),
      "monospace/variable_ttf/FiraCode-VF.ttf": ttf({ family: "Fira Code", wght: [300, 700] }),
      "monospace/woff2/FiraCode-VF.woff2": woff2({ family: "Fira Code", wght: [300, 700] }),
    });
    assert.deepEqual((await scan(root)).fonts[0].faces, ["300 700 woff2/FiraCode-VF.woff2"]);
  });

  test("regular is the weight nearest 400, bold the one nearest 700 at 600 or more", async () => {
    const faces = async (weights: number[]) => {
      const files: Record<string, Buffer> = {};
      for (const w of weights) files[`other/W/W-${w}.ttf`] = ttf({ family: "W", weight: w });
      return (await scan(await tree(files))).fonts[0].faces;
    };
    assert.deepEqual(await faces([100, 300, 400, 500, 600, 700, 800, 900]), ["400 W/W-400.ttf", "700 W/W-700.ttf"]);
    assert.deepEqual(await faces([500, 900]), ["400 W/W-500.ttf", "700 W/W-900.ttf"]);
    assert.deepEqual(await faces([350, 450]), ["400 W/W-350.ttf"]);
    assert.deepEqual(await faces([300]), ["400 W/W-300.ttf"]);
    assert.deepEqual(await faces([600, 800]), ["400 W/W-600.ttf", "700 W/W-800.ttf"]);
  });

  test("italic-only families, collections, zips, broken files and symlinks are logged and skipped", async () => {
    const outside = await tree({ "real.ttf": ttf({ family: "Outside" }) });
    const root = await tree({
      "other/Only-Italic.ttf": ttf({ family: "Slanted", italic: true }),
      "other/Inter.ttc": "ttcf",
      "other/download.zip": "PK",
      "other/broken.ttf": "nonsense",
      "other/fine.otf": sfnt({ family: "Fine" }, "OTTO"),
    });
    await symlink(join(outside, "real.ttf"), join(root, "other", "link.ttf"));
    await symlink(outside, join(root, "other", "linked-dir"));
    const r = await scan(root);
    assert.deepEqual(r.fonts.map((f) => f.name), ["Fine"]);
    assert.match(r.log, /"Slanted" \(other\/\) has only italic faces; skipped/);
    assert.match(r.log, /other\/Inter\.ttc: font collections aren't supported; skipped/);
    assert.match(r.log, /other\/download\.zip: unzip it first; skipped/);
    assert.match(r.log, /other\/broken\.ttf: not a font file; skipped/);
    assert.match(r.log, /link\.ttf is a symlink; skipped/);
    assert.match(r.log, /linked-dir is a symlink; skipped/);
    assert.doesNotMatch(r.log, /Outside/);
  });

  test("a symlinked monospace/ or other/ folder isn't followed (Sol code r1 #2)", async () => {
    const outside = await tree({ "real.ttf": ttf({ family: "Outside" }) });
    const root = await tree({ "other/A.ttf": ttf({ family: "A" }) });
    await symlink(outside, join(root, "monospace"));
    const r = await scan(root);
    assert.deepEqual(r.fonts.map((f) => f.name), ["A"]);
    assert.match(r.log, /monospace\/ in .* is a symlink; no monospace fonts/);
  });

  test("a file over the size limit is skipped without being read", async () => {
    const root = await tree({ "other/A.ttf": ttf({ family: "A" }), "other/Huge.ttf": "" });
    await truncate(join(root, "other", "Huge.ttf"), MAX_FONT_FILE + 1);
    const r = await scan(root);
    assert.deepEqual(r.fonts.map((f) => f.name), ["A"]);
    assert.match(r.log, /other\/Huge\.ttf: it's larger than 64 MB; skipped/);
  });

  test("dotfiles and __MACOSX are skipped at every depth, silently", async () => {
    const r = await scan(
      await tree({
        "other/A/A.ttf": ttf({ family: "A" }),
        "other/A/._A.ttf": "AppleDouble",
        "other/__MACOSX/A/._A.ttf": "AppleDouble",
        "other/.hidden/B.ttf": ttf({ family: "B" }),
      }),
    );
    assert.deepEqual(r.fonts.map((f) => f.name), ["A"]);
    assert.doesNotMatch(r.log, /AppleDouble|_A\.ttf|B\.ttf/);
  });

  test("an unreadable file is logged and skipped", { skip: process.getuid?.() === 0 }, async () => {
    const root = await tree({ "other/A.ttf": ttf({ family: "A" }), "other/B.ttf": ttf({ family: "B" }) });
    await chmod(join(root, "other", "B.ttf"), 0o000);
    const r = await scan(root);
    assert.deepEqual(r.fonts.map((f) => f.name), ["A"]);
    assert.match(r.log, /other\/B\.ttf: EACCES; skipped/);
  });

  test("ids: no letters, and collisions (monospace first, then name order)", async () => {
    const r = await scan(
      await tree({
        "monospace/x.ttf": ttf({ family: "Same Name" }),
        "other/y.ttf": ttf({ family: "same-name" }),
        "other/z.ttf": ttf({ family: "思源黑体" }),
      }),
    );
    assert.deepEqual(r.fonts.map((f) => [f.id, f.mono]), [["same-name", true]]);
    assert.match(r.log, /"same-name" \(other\/\) has the same id as another font, same-name; skipped/);
    assert.match(r.log, /"思源黑体" \(other\/\) has no letters or digits for an id; skipped/);
  });

  test("a monospace font that says it isn't fixed-pitch is listed, with a warning", async () => {
    const r = await scan(await tree({ "monospace/N.ttf": ttf({ family: "JetBrainsMono Nerd Font", fixedPitch: false }) }));
    assert.equal(r.fonts.length, 1);
    assert.match(r.log, /JetBrainsMono Nerd Font as jetbrainsmono-nerd-font \(its file says it isn't fixed-pitch\)/);
  });

  test("real downloads unzipped straight into the folders", async () => {
    const root = await tree({
      // Fira Code 6.2: no folder named after the font.
      "monospace/ttf/FiraCode-Regular.ttf": ttf({ family: "Fira Code", fixedPitch: true }),
      "monospace/ttf/FiraCode-Bold.ttf": ttf({ family: "Fira Code", weight: 700, fixedPitch: true }),
      "monospace/ttf/FiraCode-Retina.ttf": ttf({ family: "Fira Code Retina", typoFamily: "Fira Code", weight: 450, fixedPitch: true }),
      "monospace/woff2/FiraCode-Regular.woff2": woff2({ family: "Fira Code", fixedPitch: true }),
      "monospace/variable_ttf/FiraCode-VF.ttf": ttf({ family: "Fira Code", wght: [300, 700], fixedPitch: true }),
      // JetBrains Mono 2.304: everything under fonts/.
      "monospace/fonts/ttf/JetBrainsMono-Regular.ttf": ttf({ family: "JetBrains Mono", fixedPitch: true }),
      "monospace/fonts/ttf/JetBrainsMono-Italic.ttf": ttf({ family: "JetBrains Mono", italic: true, fixedPitch: true }),
      "monospace/fonts/ttf/JetBrainsMonoNL-Regular.ttf": ttf({ family: "JetBrains Mono NL", fixedPitch: true }),
      "monospace/fonts/variable/JetBrainsMono[wght].ttf": ttf({ family: "JetBrains Mono", wght: [100, 800], fixedPitch: true }),
      "monospace/fonts/webfonts/JetBrainsMono-Regular.woff2": woff2({ family: "JetBrains Mono", fixedPitch: true }),
      // Adobe Source Code Pro: `-It` italics, a __MACOSX folder.
      "monospace/TTF/SourceCodePro-It.ttf": ttf({ family: "Source Code Pro", style: "Italic", italic: true, fixedPitch: true }),
      "monospace/TTF/SourceCodePro-Regular.ttf": ttf({ family: "Source Code Pro", fixedPitch: true }),
      "monospace/TTF/SourceCodePro-Semibold.ttf": ttf({ family: "Source Code Pro Semibold", typoFamily: "Source Code Pro", weight: 600, fixedPitch: true }),
      "monospace/TTF/SourceCodePro-Bold.ttf": ttf({ family: "Source Code Pro", weight: 700, fixedPitch: true }),
      "monospace/__MACOSX/TTF/._SourceCodePro-Regular.ttf": "AppleDouble",
      // Nerd Fonts: one flat folder, three designs.
      "monospace/JetBrainsMonoNerdFont-Regular.ttf": ttf({ family: "JetBrainsMono Nerd Font" }),
      "monospace/JetBrainsMonoNerdFontMono-Regular.ttf": ttf({ family: "JetBrainsMono Nerd Font Mono", fixedPitch: true }),
      "monospace/JetBrainsMonoNerdFontPropo-Regular.ttf": ttf({ family: "JetBrainsMono Nerd Font Propo" }),
      // Google Fonts' Inter: no top folder, a static/ folder, an italic variable file.
      "other/Inter-VariableFont_opsz,wght.ttf": ttf({ family: "Inter", wght: [100, 900] }),
      "other/Inter-Italic-VariableFont_opsz,wght.ttf": ttf({ family: "Inter", style: "Italic", italic: true, wght: [100, 900] }),
      "other/static/Inter_18pt-Regular.ttf": ttf({ family: "Inter 18pt", typoFamily: "Inter", weight: 400 }),
      "other/OFL.txt": "licence",
      // Inter 4.1's own release: a collection, and a differently named variable family.
      "other/Inter.ttc": "ttcf",
      "other/web/InterVariable.woff2": woff2({ family: "Inter Variable", wght: [100, 900] }),
    });
    const r = await scan(root);
    assert.deepEqual(r.fonts, [
      { id: "fira-code", name: "Fira Code", mono: true, faces: ["300 700 variable_ttf/FiraCode-VF.ttf"] },
      { id: "jetbrains-mono", name: "JetBrains Mono", mono: true, faces: ["100 800 fonts/variable/JetBrainsMono[wght].ttf"] },
      { id: "jetbrains-mono-nl", name: "JetBrains Mono NL", mono: true, faces: ["400 fonts/ttf/JetBrainsMonoNL-Regular.ttf"] },
      { id: "jetbrainsmono-nerd-font", name: "JetBrainsMono Nerd Font", mono: true, faces: ["400 JetBrainsMonoNerdFont-Regular.ttf"] },
      { id: "jetbrainsmono-nerd-font-mono", name: "JetBrainsMono Nerd Font Mono", mono: true, faces: ["400 JetBrainsMonoNerdFontMono-Regular.ttf"] },
      { id: "jetbrainsmono-nerd-font-propo", name: "JetBrainsMono Nerd Font Propo", mono: true, faces: ["400 JetBrainsMonoNerdFontPropo-Regular.ttf"] },
      { id: "source-code-pro", name: "Source Code Pro", mono: true, faces: ["400 TTF/SourceCodePro-Regular.ttf", "700 TTF/SourceCodePro-Bold.ttf"] },
      { id: "inter", name: "Inter", mono: false, faces: ["100 900 Inter-VariableFont_opsz,wght.ttf"] },
      { id: "inter-variable", name: "Inter Variable", mono: false, faces: ["100 900 web/InterVariable.woff2"] },
    ]);
  });
});

describe("the routes", () => {
  let s: Running;
  let root: string;
  const regular = woff2({ family: "Liberation Sans" });
  before(async () => {
    root = await tree({
      "other/Liberation/LiberationSans-Regular.woff2": regular,
      "other/Liberation/LiberationSans-Bold.ttf": ttf({ family: "Liberation Sans", weight: 700 }),
      "monospace/Mono.otf": sfnt({ family: "Mono", fixedPitch: true }, "OTTO"),
    });
    s = await start({ fontsDir: root });
    assert.equal((await cli(s.dataDir, ["add", "alice"], "secret")).code, 0);
  });
  after(async () => s.close());

  test("the list needs a login, and gives CSS-ready weights and formats", async () => {
    assert.equal((await new Client(s.base).req("GET", "/api/fonts")).status, 401);
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const res = await c.req("GET", "/api/fonts");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const { fonts } = (await res.json()) as { fonts: { id: string; name: string; mono: boolean; faces: { weight: string; format: string; url: string }[] }[] };
    assert.deepEqual(
      fonts.map((f) => ({ ...f, faces: f.faces.map((x) => ({ ...x, url: x.url.replace(/[0-9a-f]{12}/, "#") })) })),
      [
        { id: "mono", name: "Mono", mono: true, faces: [{ weight: "400", format: "opentype", url: "/api/fonts/mono/#.otf" }] },
        {
          id: "liberation-sans",
          name: "Liberation Sans",
          mono: false,
          faces: [
            { weight: "400", format: "woff2", url: "/api/fonts/liberation-sans/#.woff2" },
            { weight: "700", format: "truetype", url: "/api/fonts/liberation-sans/#.ttf" },
          ],
        },
      ],
    );
  });

  test("a face is served from memory, cached for a year, with exact lookup", async () => {
    const c = new Client(s.base);
    await c.login("alice", "secret");
    const url = (await c.json("GET", "/api/fonts")).body.fonts[1].faces[0].url as string;
    // Changing the file on disk after startup changes nothing: the bytes, length and hash agree.
    await writeFile(join(root, "other/Liberation/LiberationSans-Regular.woff2"), "changed");
    const res = await c.req("GET", url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "font/woff2");
    assert.equal(res.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.equal(res.headers.get("content-length"), String(regular.length));
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), regular);
    const head = await c.req("HEAD", url);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(regular.length));
    assert.equal((await new Client(s.base).req("GET", url)).status, 401);
    for (const bad of [url.replace(/[0-9a-f]{12}/, "000000000000"), url.replace(".woff2", ".ttf"), url.replace("liberation-sans", "mono"), "/api/fonts/x", "/api/fonts/../../users.json"]) {
      assert.equal((await c.req("GET", bad)).status, 404, bad);
    }
  });

  test("FONTS_DIR, or ./fonts", () => {
    assert.equal(configFromEnv({ FONTS_DIR: "/fonts" }).fontsDir, "/fonts");
    assert.match(configFromEnv({}).fontsDir!, /\/fonts$/);
  });
});
