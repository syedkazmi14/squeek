import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { auditPackage } from "./audit-package.ts";

async function run(command: string, args: string[]) {
  await new Promise<void>((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
    child.once("error", () => reject(Error("Required build tool unavailable")));
    child.once("exit", code => code === 0 ? done() : reject(Error("Windows build step failed")));
  });
}
async function main() {
  if (process.platform !== "win32") throw Error("Windows release build requires a controlled Windows host with PowerShell and .NET 10 SDK; installation and signature checks cannot run here");
  if (Number(process.versions.node.split(".")[0]) < 24) throw Error("Node 24 or newer is required");
  const npm = process.env.npm_execpath;
  if (!npm) throw Error("Run this build through npm run package:win");
  await rm("artifacts/observer", { recursive: true, force: true });
  await rm("artifacts/installer", { recursive: true, force: true });
  await run(process.execPath, [npm, "run", "observer:build"]);
  await run(process.execPath, [npm, "run", "build"]);
  const builder = resolve("node_modules/electron-builder/cli.js");
  await run(process.execPath, [builder, "--win", "--x64", "--dir"]);
  const directory = resolve("artifacts/installer/win-unpacked");
  const secrets = process.env.TYPESAFE_API_KEY?.trim() ? [process.env.TYPESAFE_API_KEY] : [];
  const report = await auditPackage(directory, secrets);
  await mkdir("artifacts/qa", { recursive: true });
  await writeFile("artifacts/qa/package-inventory.json", JSON.stringify(report, null, 2) + "\n");
  // Build the installer from the exact audited directory, without rebuilding resources.
  await run(process.execPath, [builder, "--win", "nsis", "--x64", "--prepackaged", directory]);
  const metadata = JSON.parse(await readFile("package.json", "utf8"));
  const path = `artifacts/installer/Squeek-Setup-${metadata.version}.exe`;
  const bytes = await readFile(path);
  await writeFile("artifacts/qa/installer-manifest.json", JSON.stringify({ path, bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), signatureStatus: "not_verified",
    contentAudit: "artifacts/qa/package-inventory.json", installation: "not_tested" }, null, 2) + "\n");
  console.log("Windows installer built from audited resources. Signing, standard-user installation and packaged autonomous flow remain separate gates.");
}
main().catch(() => {
  console.error(process.platform !== "win32"
    ? "Windows release build requires a controlled Windows host with PowerShell and .NET 10 SDK; installation and signature checks cannot run here"
    : "Windows packaging failed. Check required build tools and the content audit; no credential or artifact content is logged by this wrapper.");
  process.exitCode = 1;
});
