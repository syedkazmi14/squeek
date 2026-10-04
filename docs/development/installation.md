# Windows release gates

This branch is a build/audit candidate, not a verified usable Windows release. The current host is macOS arm64; PowerShell and .NET SDK commands are unavailable, and no controlled Windows test environment, signing certificate, or App Control policy approval was supplied. `npm run package:win` therefore fails explicitly before publishing. The prior Device Guard block, Chrome/Edge extraction gaps, and Windows always-on-top failure remain open. A successful development launch on macOS does not resolve any of them.

## Reproduce the build on Windows

Use an isolated checkout of this branch with Node 24+, PowerShell (`pwsh`) and .NET 10 SDK on a developer build machine. Install no tools into an end user's environment. Keep credentials outside the checkout or in ignored private files. Record the commit, `node --version`, `npm.cmd --version`, `dotnet --info`, Windows build, and installer SHA-256 alongside results. Dependencies are pinned in the npm lockfile; record the exact SDK/runtime patch because this recipe does not promise byte-identical installers across different toolchains.

```powershell
npm.cmd ci
npm.cmd run desktop:setup
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:desktop
npm.cmd run test:usability
npm.cmd run package:win
npm.cmd run release:audit
```

`package:win` cleans this worktree's observer/installer output, publishes the self-contained observer using the existing observer build, cleans and builds desktop bundles, then builds a Windows x64 directory. It audits that directory before generating NSIS from the same directory. It writes `artifacts/qa/package-inventory.json` with per-file sizes/hashes and `installer-manifest.json` with the installer hash. Build/audit failure returns a nonzero exit code. No installer from a failed run is eligible for distribution.

The desktop files are explicitly enumerated. Observer copying is restricted to root runtime DLLs, its executable and its two runtime manifests. The auditor rejects SDKs, fixtures, environment files, developer dependencies, unexpected executable/resources, symlinks, missing Electron or .NET/WPF files, framework-dependent configuration, incorrect executable architecture, known configured key literals, and private-key blocks. It never logs matched values. These checks are not a guarantee against every possible embedded secret; inspect the manifest and changed bundles before release. The exact runtime allowlist still needs verification against a real .NET 10 Windows publish; an unfamiliar required file must be investigated rather than disabling the audit.

`npm.cmd run release:inspect-desktop` is a portable allowlisted desktop snapshot for inspection. It is not electron-builder output or Windows packaging proof. Structural package-audit tests use fake executable headers and are also not runtime proof.

A separate diagnostic `electron-builder --win --x64 --dir --config.win.signAndEditExecutable=false` run on macOS produced real Electron directory/ASAR output for inspection. The ASAR had 13 allowed files and zero dependency packages. Electron-builder itself returned success despite the missing observer source directory; `release:audit` rejected the output for that missing artifact. No installer was produced, executable metadata/signing was skipped, and this incomplete diagnostic directory is not a release. [Inventory evidence](results/desktop-inventory.json) retains this scope.

## Signing and security policy

The committed build configuration has `signExecutable: false`; no signing credential was configured or certificate purchased in this work. A valid Authenticode signature and an allowed publisher/hash under a managed machine's policy are separate requirements. Signing alone does not establish Device Guard compatibility. Microsoft documents [App Control file-rule levels and policy rules](https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-defender-application-control/select-types-of-rules-to-create); electron-builder documents [Windows signing](https://www.electron.build/docs/win/) and [per-user NSIS settings](https://www.electron.build/docs/nsis/).

The existing NSIS settings request per-user installation and forbid elevation. Those are configuration properties, not standard-user installation evidence. Do not bypass SmartScreen, disable Device Guard/App Control, elevate to work around a block, or change policies. If blocked, record binary SHA-256, Authenticode status, Windows error/policy event ID and test conditions without copying private event content. Obtain the machine owner's policy decision or a permitted clean test environment separately.

On Windows, the read-only verification script records signature statuses and whether the token is elevated or belongs to Administrators. An unelevated administrator is not counted as a standard user:

```powershell
powershell.exe -NoProfile -File scripts/verify-windows-release.ps1 `
  -InstallerPath artifacts/installer/Squeek-Setup-0.1.0.exe `
  -AppDirectory artifacts/installer/win-unpacked
```

The script was not executed on this macOS host. It never installs, launches, signs, or changes policy. `NotSigned`, unavailable certificate, unavailable clean machine, or denied publisher/hash leaves the release gate open. Future approved signing must cover the installer, Squeek executable and native helper, be timestamped/verified, and then rerun content inspection and installed-app checks. Never commit a certificate or password.

## Disposable standard-user verification

Use a fresh Windows 11 VM snapshot and a local standard-user test account. Ensure Squeek is absent before starting: no existing install directory, running Squeek process, Squeek HKCU uninstall entry, or existing profile. If any exists, stop and use a new disposable environment. Do not uninstall or overwrite someone else's installation. The runtime image should have no Node, developer SDK, separately installed .NET Desktop runtime, extension, browser flags, or developer mode. Keep machine security settings unchanged. Each row currently remains **pending**.

| Gate | Evidence needed |
| --- | --- |
| Installer | Hash and signature match the build record; interactive per-user installation completes without elevation or runtime/setup prompts |
| Launch | Installed shortcut starts the installed executable; helper resolves under installed `resources/observer`; no missing-runtime prompt or child-process failure |
| Tray | Tray icon and neutral companion appear; sidebar starts hidden; show Settings from tray; duplicate launch does not create a second instance |
| Dismissal | Close the review sidebar with mouse and keyboard; companion and enabled monitoring continue; repeated same-content warning remains dismissed |
| Pause | Pause from tray and sidebar; native work, provider work and obsolete speech stop; evidence/cache clear; foreground browser changes cannot republish late results |
| Quit | Quit from tray; all owned Electron/helper processes exit; no background reading or voice remains |
| Restart | Launch again; paused/local-only defaults apply; there is no hidden login auto-start or unexpected duplicate process |
| Offline/cloud | Installed app ignores a synthetic `TYPESAFE_API_KEY` environment variable; cloud control stays unavailable; offline local assessment works |
| Speech | Local voices enumerate; physical audio is heard; mute, cancel, replay and rate work with text equivalents and keyboard controls |
| Uninstall | Uninstall this disposable copy as the standard user; owned processes/shortcuts/uninstall registration/install directory are removed; record any retained profile and test reinstall from a clean snapshot |

After sections 1/2 are integrated, build again from the integrated commit and demonstrate **the installed app**, not only `npm start`. Explicitly opt into a test-owned Chrome page, then independently Edge. Use synthetic messages: new scam, unchanged content, benign content, scroll, image-only content, unsupported/read failure, source change, Pause during pending assessment, changed simulated payment details. Record extracted visible spans versus visible text, coverage/health, one warning and one speech incident, and no stale/repeated alert. Do not activate observation on private mail. Real Gmail/mail compatibility needs its own consent and evidence. Current browser and autonomous packaged-flow gates remain pending.

Measure the whole installed Electron process tree and helper in the disposable account: at least 60 seconds paused idle, 60 seconds enabled on unchanged synthetic content, then a documented sequence of changed messages/scroll/focus/Pause. Record sample interval, sum of CPU time deltas, logical-core normalization, working-set/private bytes, process count, assessment starts/cache/cancellations, and cloud HTTP/token counters. Measure timestamps from actual observed change to displayed warning and speech onset. Short detector-only microbenchmarks cannot substitute for these measurements.

## Accessibility and cloud gates

Development Electron checks on macOS exercised seven content-size/zoom combinations, keyboard controls, 20px body text, and at least 44px active main controls. They found a contrast issue in 18px normal `Last review` text (4.15:1). Coordinate a focused renderer color correction with the sections 1/2 owner; this branch does not edit shared renderer files. W3C specifies [4.5:1 for normal text](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Windows 100/125/150/200% display scaling, 1366×768 and 1920×1080 screens, mixed-DPI monitors, all controls by keyboard, Windows Narrator/focus announcement, and physical speech remain pending. App zoom is not Windows display scaling. No intended-user or elderly-participant testing occurred.

Packaged cloud classification stays disabled by the existing packaged-runtime gate. No shared Jev credential may ship. Future cloud release requires separately approved authenticated backend, per-user authorization, server-side secret management, request/HTTP attempt/concurrency limits, abuse controls, verified retention/privacy terms, opt-in redaction, failure/cancellation handling, and measured usage. No backend deployment or public release is authorized by this work.
