import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPackage } from "@electron/asar";
import { auditDesktopArchive, auditObserver, auditPackage } from "../scripts/audit-package.ts";
import { desktopFiles, electronRuntimeFiles, observerRequired } from "../scripts/release-policy.ts";

// Structural auditor fixtures, not real Electron or .NET executables; never ship them.
function pe() {
  const buffer = Buffer.alloc(128); buffer.write("MZ"); buffer.writeUInt32LE(64, 0x3c);
  buffer.write("PE\0\0", 64); buffer.writeUInt16LE(0x8664, 68); return buffer;
}
async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "squeek-package-audit-"));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
async function archive(root: string, extra?: string, content = "synthetic bundle") {
  const source = join(root, "source"); await mkdir(join(source, "dist/desktop"), { recursive: true });
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "synthetic-audit", main: "dist/desktop/main.mjs" }));
  for (const name of desktopFiles) await writeFile(join(source, "dist/desktop", name), content);
  if (extra) { const path = join(source, extra); await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, "synthetic extra"); }
  const path = join(root, "app.asar"); await createPackage(source, path); return path;
}
async function observer(root: string) {
  await mkdir(root, { recursive: true });
  for (const name of observerRequired) await writeFile(join(root, name), name.endsWith(".exe") ? pe() : "synthetic runtime");
  await writeFile(join(root, "Squeek.Observer.runtimeconfig.json"), JSON.stringify({ runtimeOptions: { includedFrameworks: [{ name: "Microsoft.NETCore.App" }, { name: "Microsoft.WindowsDesktop.App" }] } }));
  await writeFile(join(root, "Squeek.Observer.deps.json"), JSON.stringify({ runtimeTarget: { name: ".NETCoreApp,Version=v10.0/win-x64" } }));
}
test("desktop archive rejects environment files, fixtures, dependencies and secret literals", async t => {
  for (const extra of [".env", "tests/fixture.txt", "node_modules/developer/index.js", "dist/desktop/stale.js"]) {
    const root = await workspace(t); await assert.rejects(auditDesktopArchive(await archive(root, extra)), /Unexpected archive asset/);
  }
  const root = await workspace(t);
  await assert.rejects(auditDesktopArchive(await archive(root, undefined, "synthetic-private-token"), ["synthetic-private-token"]), /Secret material/);
  const privateKey = await workspace(t);
  await assert.rejects(auditDesktopArchive(await archive(privateKey, undefined, "-----BEGIN PRIVATE KEY-----")), /Secret material/);
});
test("archive requires desktop assets and forbids bundled development dependencies", async t => {
  const root = await workspace(t); const path = await archive(root);
  assert.equal((await auditDesktopArchive(path)).files.length, desktopFiles.length + 1);
  const other = await workspace(t); await archive(other);
  await writeFile(join(other, "source/package.json"), JSON.stringify({ main: "dist/desktop/main.mjs", devDependencies: { electron: "synthetic" } }));
  const contaminated = join(other, "dependencies.asar"); await createPackage(join(other, "source"), contaminated);
  await assert.rejects(auditDesktopArchive(contaminated), /distributed dependency/);
  await rm(join(other, "source/dist/desktop/preload.cjs"));
  const missing = join(other, "missing.asar"); await createPackage(join(other, "source"), missing);
  await assert.rejects(auditDesktopArchive(missing), /Required desktop asset/);
});
test("observer audit rejects missing native runtime, framework-dependent publish and unrelated executable", async t => {
  const root = await workspace(t); await observer(root);
  assert.equal((await auditObserver(root)).selfContained, true);
  await rm(join(root, "coreclr.dll")); await assert.rejects(auditObserver(root), /runtime asset missing/);
  await observer(root);
  await writeFile(join(root, "Squeek.Observer.runtimeconfig.json"), JSON.stringify({ runtimeOptions: { framework: { name: "Microsoft.NETCore.App" } } }));
  await assert.rejects(auditObserver(root), /not a self-contained/);
  await observer(root); await writeFile(join(root, "Squeek.Fixture.exe"), pe());
  await assert.rejects(auditObserver(root), /Unexpected observer asset/);
  await rm(join(root, "Squeek.Fixture.exe"));
  await writeFile(join(root, "Microsoft.Build.dll"), "synthetic SDK assembly");
  await assert.rejects(auditObserver(root), /Unexpected observer asset/);
});
test("package inventory rejects loose resources and non-x64 executables", async t => {
  const root = await workspace(t), staged = await workspace(t);
  await mkdir(join(root, "resources"));
  const sourceArchive = await archive(staged);
  const { copyFile } = await import("node:fs/promises");
  await copyFile(sourceArchive, join(root, "resources/app.asar"));
  await observer(join(root, "resources/observer"));
  await writeFile(join(root, "Squeek.exe"), pe());
  for (const name of electronRuntimeFiles) if (name !== "Squeek.exe") await writeFile(join(root, name), "synthetic Electron runtime");
  await mkdir(join(root, "locales")); await writeFile(join(root, "locales/en-US.pak"), "synthetic locale");
  assert.equal((await auditPackage(root)).status, "contents_passed");
  await writeFile(join(root, "resources/private.txt"), "synthetic loose text");
  await assert.rejects(auditPackage(root), /Unexpected Electron resource/);
  await rm(join(root, "resources/private.txt"));
  await writeFile(join(root, "Squeek.exe"), "not a PE executable");
  await assert.rejects(auditPackage(root), /Windows executable header/);
});
test("observer audit rejects symbolic links rather than following external content", { skip: process.platform === "win32" }, async t => {
  const root = await workspace(t); await observer(root);
  await symlink(join(root, "coreclr.dll"), join(root, "System.Link.dll"));
  await assert.rejects(auditObserver(root), /Forbidden package asset/);
});
