// Build the client into dist/public/: the app and login bundles, the CSS (with the palette CSS
// generated from src/shared/palette.ts), and the pages from src/public/. `--watch` keeps going.

import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/public");
const watching = process.argv.includes("--watch");

async function paletteCss(): Promise<string> {
  const bust = `?t=${Date.now()}`;
  const palette = await import(`${join(ROOT, "src/shared/palette.ts")}${bust}`);
  const colors = await import(`${join(ROOT, "src/shared/colors.ts")}${bust}`);
  const lines: string[] = ["/* Generated from src/shared/palette.ts */"];
  for (const name of palette.COLOR_NAMES as string[]) {
    const hex = palette.colorHex(name) as string;
    lines.push(`.hl-${name}{--hl:${hex}}`);
    lines.push(`.sec-${name}{--sec:${hex};--heading:${colors.darkShade(hex)}}`);
  }
  (palette.HUES as { light: string; deep: string }[]).forEach((h, i) => {
    lines.push(`.hue-${i}{--light:${h.light};--deep:${h.deep};--dark:${colors.darkShade(h.deep)}}`);
  });
  return lines.join("\n");
}

const palettePlugin: esbuild.Plugin = {
  name: "palette",
  setup(build) {
    build.onResolve({ filter: /^palette:css$/ }, () => ({ path: "palette.css", namespace: "palette" }));
    build.onLoad({ filter: /.*/, namespace: "palette" }, async () => ({
      contents: await paletteCss(),
      loader: "css",
      watchFiles: [join(ROOT, "src/shared/palette.ts"), join(ROOT, "src/shared/colors.ts")],
    }));
  },
};

async function copyPages(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await cp(join(ROOT, "src/public"), OUT, { recursive: true });
}

const options: esbuild.BuildOptions = {
  absWorkingDir: ROOT,
  entryPoints: [
    { in: "src/client/app.ts", out: "assets/app" },
    { in: "src/client/login.ts", out: "assets/login" },
    { in: "src/client/styles/app.css", out: "assets/app" },
  ],
  outdir: OUT,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !watching,
  sourcemap: true,
  logLevel: "info",
  plugins: [palettePlugin],
};

await rm(OUT, { recursive: true, force: true });
await copyPages();
if (watching) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  fsWatch(join(ROOT, "src/public"), { recursive: true }, () => {
    copyPages().catch((err) => console.error("margin build: copying pages failed:", err));
  });
  console.log("Watching for changes…");
} else {
  await esbuild.build(options);
}
