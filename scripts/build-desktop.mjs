import { ringPng } from "./ring-icon.mjs";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { build } from "esbuild";
// Release builds must not carry stale bundles, source maps or hand-copied assets.
await rm("dist/desktop", { recursive: true, force: true });
await mkdir("dist/desktop", { recursive: true });
await build({
  entryPoints: ["apps/desktop/src/main/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  outfile: "dist/desktop/main.mjs",
});
await build({
  entryPoints: ["apps/desktop/src/preload.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: "dist/desktop/preload.cjs",
});
await build({
  entryPoints: ["apps/desktop/src/renderer/renderer.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/desktop/renderer.js",
});
for (const name of [
  "index.html",
  "styles.css",
  "demo.html",
  "demo.js",
  "halo.html",
  "halo.css",
  "halo.js",
  "mark.png",
  "Nunito-Regular.ttf",
  "Nunito-Bold.ttf",
  "Nunito-ExtraBold.ttf",
  "Nunito-Black.ttf",
  "OFL.txt",
])
  await copyFile(`apps/desktop/src/renderer/${name}`, `dist/desktop/${name}`);

await writeFile("dist/desktop/icon.png", ringPng());
await writeFile("dist/desktop/tray-icon.png", ringPng(64, true));
