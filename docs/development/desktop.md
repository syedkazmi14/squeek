# Desktop development

## Runtime boundaries

The main process launches a fixed bundled observer path. Sandboxed renderers have no Node access and use a narrow preload API. IPC requires the expected window, main frame, exact local document URL, and validated payload. Local protocol resources are allowlisted. Permission requests and new windows are denied, and CSP blocks renderer network access. Untrusted excerpts are rendered as text.

The native helper collects read-only accessible text only after explicit monitoring opt-in, using PID/HWND/process-start identity and the selected foreground browser's physical rectangle. Metadata polling is bounded to one cycle per two seconds. Text is read initially and after a scoped accessibility change, then foreground identity and bounds are checked again. Pause closes the helper and cancels assessment work. No screenshots or OCR are captured in this build.

Squeek starts in the Windows notification area with a visible click-through companion following the cursor locally at a bounded interval. It does not take focus or intercept input. The sidebar starts hidden, has no taskbar entry, and docks to the current display when a new suspicious assessment arrives. Closing it hides the review and cancels its speech without stopping enabled monitoring. Settings and browser start/pause controls are available from the tray. Pause stops observation explicitly while leaving the neutral companion visible; Quit ends the process. Windows controls whether the tray icon is visible directly or inside its overflow arrow.

A source change cancels in-flight assessment work. A recent suspicious result can remain labeled **Last review** while its source is unavailable; captured assessment/evidence is removed after 60 seconds or immediately on Pause. Repeated copies of the same alert do not reopen a dismissed sidebar within the deduplication window. This behavior does not establish real browser extraction support.

## Development provider

`.env.example` documents the optional local credential. Development loads `.env` in main only. Jev is off until the user selects the data-sharing checkbox. Text is redacted and bounded before classification. The session has a maximum of 100 classification starts and 100 actual HTTP attempts, including retries; concurrent classifications are limited to two. Failed/missing provider responses preserve local evidence and uncertainty. Packaged builds ignore developer credentials and cannot enable cloud classification.

Redaction cannot guarantee removal of every personal detail. Never test a live provider with private correspondence without separate consent. Real-world classification accuracy and representative latency/token cost remain unmeasured. Isolated synthetic live smoke results are recorded in `demo-results.md`.

## Packaging

`npm.cmd run observer:build` builds the self-contained Windows helper, C# policy checks, and controlled WPF fixture. `npm.cmd run package:win` requires a Windows build host, cleans this worktree's output, builds a directory, validates its contents, then generates a per-user NSIS installer from that exact directory under `artifacts/installer`. Desktop files and observer/runtime resources are explicitly filtered. The audit fails for missing runtimes, unexpected resources, development assets/dependencies and recognized secret material. Its size/hash inventories are under `artifacts/qa`. See [release gates](installation.md) for prerequisites, inspection limits, signing and the disposable installation checklist.

On this macOS follow-up, an actual electron-builder Windows x64 **diagnostic directory** was inspected with executable resource editing disabled. Its ASAR contained 13 files (12 desktop assets plus metadata), no dependency packages, environment files, SDKs, fixtures or raw correspondence. The self-contained helper was absent, so the full package audit failed. This directory is incomplete and not a release; no NSIS installer was produced by this follow-up. The helper audit/standard-user Windows gates remain unverified.

The local installer is unsigned. This machine's Device Guard policy blocked the latest unpacked executable; the development Electron runtime still launches. Building the package does not prove installation or successful launch on a clean Windows machine. Standard-user installation, signing, Windows security prompts, multi-monitor/DPI behavior, actual bank/mail pages, screen-reader behavior, and older-user usability still need separate testing.

## Test commands

- `npm.cmd test`: contracts, local detection, fake provider transport, scheduler, action binding, observer bridge, native policy/protocol, monitoring and controlled native extraction.
- `npm.cmd run typecheck`: strict TypeScript checking.
- `npm.cmd run test:desktop`: real Electron launch and affected UI/security/review flows on synthetic user-entered text. Requires local speech voices; Windows release verification needs an actual Windows run.
- `npm.cmd run test:usability`: development Electron content-size/zoom and keyboard checks on synthetic text; records contrast gaps. This does not establish Windows display scaling or screen-reader/participant results.
- `npm.cmd run evaluate`: deterministic held-out detection outcomes, measured local latency/Node CPU/memory, fake-clock scheduling counters, and simulated provider failures. Optional bounded live synthetic evaluation is documented in `evaluation.md`.
- `npm.cmd run release:audit`: inspects the real Windows unpacked directory and writes per-file sizes/hashes only on content success. Signature/install/runtime behavior remain separate checks.
- `npm.cmd run test:chrome`: optional fresh owned Chrome window extraction probe. It never requests content from an unrelated foreground PID. This is a controlled technical page, not Gmail coverage.

Playwright controls the test-owned native Electron/Chrome processes. These tests do not automate the Codex in-app browser. Debugging ports/pipes are test tooling only and are not enabled by the distributed app. Screenshot output and temporary test profiles are local verification artifacts.

The macOS follow-up used the existing native Electron Playwright harness plus a separate native usability harness. The installed in-app browser skill's connection failed during bootstrap; no external browser reading or browser-extraction workaround occurred. Both Electron suites passed on macOS only. The original Windows always-on-top failure remains unresolved by these platform-specific results.

## Dependency review

The packaging tool's transitive `http-cache-semantics` dependency has an open high-severity advisory with no patched release. `npm audit` reports eight affected build-time packages in that chain. These are development-only and excluded from the desktop bundle. No shared HTTP cache handling private user responses is used by Squeek. Recheck upstream before distributing releases; do not interpret this note as a clean dependency audit.

Reference: [GitHub advisory GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), checked during development.
