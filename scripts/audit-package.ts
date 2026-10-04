import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { extractFile, listPackage, statFile } from "@electron/asar";
import { desktopFiles, electronRuntimeFiles, observerFileAllowed, observerRequired, requireX64PE } from "./release-policy.ts";

const forbiddenName = /(?:^|\/)(?:\.env(?:\..*)?|\.tools|node_modules|tests?|fixtures?|sdk|logs?|.*\.pdb|.*\.map|.*\.log|.*\.(?:pfx|pem|key))$/i;
function scan(buffer: Buffer, secrets: string[]) {
  if (secrets.some(secret => buffer.includes(Buffer.from(secret))) ||
      ["", "RSA ", "EC ", "OPENSSH "].some(kind => buffer.includes(Buffer.from(`-----BEGIN ${kind}PRIVATE KEY-----`))))
    throw Error("Secret material found in package; contents are not logged");
}
async function inventory(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name), name = relative(root, full).replaceAll("\\", "/");
      if (entry.isSymbolicLink() || forbiddenName.test(name)) throw Error("Forbidden package asset");
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) found.push(name);
      else throw Error("Unexpected package entry");
    }
  }
  if ((await lstat(root)).isSymbolicLink()) throw Error("Package directory must not be a symbolic link");
  await visit(root); return found.sort();
}
export async function auditDesktopArchive(archive: string, secrets: string[] = []) {
  const expected = new Set(["package.json", ...desktopFiles.map(name => `dist/desktop/${name}`)]);
  const files = listPackage(archive, { isPack: false }).map(name => name.replaceAll("\\", "/").replace(/^\//, ""));
  for (const name of files) {
    const stat = statFile(archive, name, false);
    if ("link" in stat) throw Error("Archive links are forbidden");
    if (!("size" in stat)) {
      if (!["dist", "dist/desktop"].includes(name)) throw Error("Unexpected archive asset");
      continue;
    }
    if (!expected.delete(name) || ("unpacked" in stat && stat.unpacked)) throw Error("Unexpected archive asset");
    scan(extractFile(archive, name), secrets);
  }
  if (expected.size) throw Error("Required desktop asset missing");
  const metadata = JSON.parse(extractFile(archive, "package.json").toString());
  if (metadata.main !== "dist/desktop/main.mjs" || Object.keys(metadata.dependencies ?? {}).length || Object.keys(metadata.devDependencies ?? {}).length)
    throw Error("Invalid runtime entry or distributed dependency");
  return { files: files.filter(name => "size" in statFile(archive, name)).sort(), runtimeDependencies: 0 };
}
export async function auditObserver(directory: string, secrets: string[] = []) {
  const files = await inventory(directory);
  if (files.some(name => !observerFileAllowed(name))) throw Error("Unexpected observer asset");
  if (observerRequired.some(name => !files.includes(name))) throw Error("Self-contained observer/runtime asset missing");
  for (const name of files) scan(await readFile(join(directory, name)), secrets);
  requireX64PE(await readFile(join(directory, "Squeek.Observer.exe")));
  const config = JSON.parse(await readFile(join(directory, "Squeek.Observer.runtimeconfig.json"), "utf8"));
  const runtime = config.runtimeOptions;
  const frameworks = runtime?.includedFrameworks?.map((f: { name: string }) => f.name) ?? [];
  if (runtime?.framework || runtime?.frameworks || !frameworks.includes("Microsoft.NETCore.App") || !frameworks.includes("Microsoft.WindowsDesktop.App"))
    throw Error("Observer is not a self-contained Windows Desktop publish");
  const deps = JSON.parse(await readFile(join(directory, "Squeek.Observer.deps.json"), "utf8"));
  if (!deps.runtimeTarget?.name?.endsWith("/win-x64")) throw Error("Observer dependency target is not win-x64");
  return { files, selfContained: true, target: "win-x64" };
}
export async function auditPackage(directory: string, secrets: string[] = []) {
  const files = await inventory(directory);
  const resources = files.filter(name => name.startsWith("resources/"));
  if (resources.some(name => name !== "resources/app.asar" && !name.startsWith("resources/observer/"))) throw Error("Unexpected Electron resource");
  for (const name of [...electronRuntimeFiles, "locales/en-US.pak", "resources/app.asar"])
    if (!files.includes(name)) throw Error("Required Electron runtime asset missing");
  requireX64PE(await readFile(join(directory, "Squeek.exe")));
  // Explicit Electron runtime inventory excludes SDKs, tools and loose app sources.
  for (const name of files) {
    if (name.startsWith("resources/")) continue;
    if (!(electronRuntimeFiles as readonly string[]).includes(name) && !/^locales\/[^/]+\.pak$/.test(name))
      throw Error("Unexpected Electron runtime asset");
  }
  const desktop = await auditDesktopArchive(join(directory, "resources/app.asar"), secrets);
  const observer = await auditObserver(join(directory, "resources/observer"), secrets);
  const hashes: { path: string; bytes: number; sha256: string }[] = [];
  for (const path of files) {
    const buffer = await readFile(join(directory, path)); scan(buffer, secrets);
    hashes.push({ path, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") });
  }
  return { status: "contents_passed", desktop, observer, hashes,
    signatureStatus: "not_verified", cloudRelease: "disabled by packaged runtime gate; authenticated backend not approved",
    pending: ["Authenticode signature verification", "Device Guard policy approval", "Standard-user install/launch/uninstall", "Packaged autonomous browser flow", "Windows usability and speech"] };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const directory = resolve(process.argv[2] ?? "artifacts/installer/win-unpacked");
  const secrets = process.env.TYPESAFE_API_KEY?.trim() ? [process.env.TYPESAFE_API_KEY] : [];
  auditPackage(directory, secrets).then(async report => {
    await mkdir("artifacts/qa", { recursive: true });
    await writeFile("artifacts/qa/package-inventory.json", JSON.stringify(report, null, 2) + "\n");
    console.log(`Package content audit passed: ${report.hashes.length} files; signature and Windows behavior gates remain open.`);
  }).catch(error => {
    // Audit errors intentionally contain no asset content or credential values.
    console.error(`Package content audit failed: ${error.code === "ENOENT" ? "Required build artifact unavailable" : "Unexpected asset, missing runtime, malformed metadata, or secret material; contents are not logged"}`);
    process.exitCode = 1;
  });
}
