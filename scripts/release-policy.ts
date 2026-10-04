export const desktopFiles = [
  "main.mjs", "preload.cjs", "renderer.js", "index.html", "styles.css",
  "demo.html", "demo.js", "halo.html", "halo.css", "halo.js", "icon.png", "tray-icon.png",
  // The mascot and the Nunito type (SIL Open Font License) the interface is drawn in.
  "mark.png", "Nunito-Regular.ttf", "Nunito-Bold.ttf", "Nunito-ExtraBold.ttf", "Nunito-Black.ttf", "OFL.txt",
] as const;
// Observed in the pinned Electron 44.5.1 Windows x64 distribution.
export const electronRuntimeFiles = [
  "Squeek.exe", "LICENSE.electron.txt", "LICENSES.chromium.html",
  "chrome_100_percent.pak", "chrome_200_percent.pak", "d3dcompiler_47.dll", "dxcompiler.dll", "dxil.dll",
  "ffmpeg.dll", "icudtl.dat", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin",
  "vk_swiftshader.dll", "vk_swiftshader_icd.json", "vulkan-1.dll",
] as const;
export const observerRequired = [
  "Squeek.Observer.exe", "Squeek.Observer.dll", "Squeek.Observer.deps.json", "Squeek.Observer.runtimeconfig.json",
  "coreclr.dll", "clrjit.dll", "hostfxr.dll", "hostpolicy.dll", "System.Private.CoreLib.dll",
  "PresentationCore.dll", "PresentationFramework.dll", "WindowsBase.dll", "UIAutomationClient.dll",
] as const;
// Fail on unfamiliar files rather than silently shipping more of the build tree.
export function observerFileAllowed(name: string): boolean {
  if (/^(?:Microsoft\.(?:Build|CodeAnalysis)(?:\.|$)|NuGet(?:\.|$))/i.test(name)) return false;
  return /^(?:Squeek\.Observer\.(?:exe|dll|deps\.json|runtimeconfig\.json)|(?:System\..+|Microsoft\..+|Accessibility|DirectWriteForwarder|D3DCompiler_47_cor3|PenImc_cor3|PresentationNative_cor3|wpfgfx_cor3|WindowsBase|WindowsFormsIntegration|PresentationCore|PresentationFramework(?:\..+)?|PresentationUI|UIAutomation(?:Client|Types|Provider)|ReachFramework|coreclr|clrjit|clretwrc|clrgc|mscordaccore|mscordbi|hostfxr|hostpolicy|msquic|vcruntime140_cor3)\.dll)$/.test(name);
}
export function requireX64PE(buffer: Buffer): void {
  if (buffer.length < 64 || buffer.toString("ascii", 0, 2) !== "MZ") throw Error("Missing Windows executable header");
  const offset = buffer.readUInt32LE(0x3c);
  if (offset > buffer.length - 6 || buffer.toString("ascii", offset, offset + 4) !== "PE\0\0" || buffer.readUInt16LE(offset + 4) !== 0x8664)
    throw Error("Expected Windows x64 executable");
}
