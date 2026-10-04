# Desktop development

## Runtime boundaries

The main process launches a fixed bundled observer path. Sandboxed renderers have no Node access and use a narrow preload API. IPC requires the expected window, main frame, exact local document URL, and validated payload. Local protocol resources are allowlisted. Permission requests and new windows are denied, and CSP blocks renderer network access. Untrusted excerpts are rendered as text.

The native helper collects read-only accessible text only after explicit monitoring opt-in, using PID/HWND/process-start identity and the selected foreground browser's physical rectangle. Metadata polling is bounded to one cycle per two seconds. Text is read initially and after a scoped accessibility change, then foreground identity and bounds are checked again. Pause closes the helper and cancels assessment work. No screenshots or OCR are captured in this build.

The pointer ring follows the Windows cursor locally at a bounded interval. It is click-through, does not take focus, and does not replace or intercept input. The review panel remains the accessible interface. Closing the panel pauses monitoring and hides it; the tray can show it again. Quit closes native work and windows.

## Development provider

`.env.example` documents the optional local credential. Development loads `.env` in main only. Jev is off until the user selects the data-sharing checkbox. Text is redacted and bounded before classification. The session has a maximum of 100 classification starts and 100 actual HTTP attempts, including retries; concurrent classifications are limited to two. Failed/missing provider responses preserve local evidence and uncertainty. Packaged builds ignore developer credentials and cannot enable cloud classification.

Redaction cannot guarantee removal of every personal detail. Never test a live provider with private correspondence without separate consent. Real-world classification accuracy and live latency/token cost remain unmeasured.

## Packaging

`npm.cmd run observer:build` builds the self-contained Windows helper, C# policy checks, and controlled WPF fixture. `npm.cmd run package:win` builds Electron and a per-user NSIS installer under `artifacts/installer`. It includes only desktop bundles and observer/runtime resources. Development SDKs, `.env`, test fixtures, raw messages, and development dependencies are excluded.

The local installer is unsigned. Building it and launching the unpacked app do not prove installation on a clean Windows machine. Standard-user installation, Windows security prompts, multi-monitor/DPI behavior, actual bank/mail pages, screen-reader behavior, and older-user usability still need separate testing.

## Test commands

- `npm.cmd test`: contracts, local detection, fake provider transport, scheduler, action binding, observer bridge, native policy/protocol, monitoring and controlled native extraction.
- `npm.cmd run typecheck`: strict TypeScript checking.
- `npm.cmd run test:desktop`: real Electron launch and affected UI/security/review flows on synthetic user-entered text. Requires local Windows speech voices.
- `npm.cmd run test:chrome`: optional fresh owned Chrome window extraction probe. It never requests content from an unrelated foreground PID. This is a controlled technical page, not Gmail coverage.

Playwright controls the test-owned Electron/Chrome processes because no Browser plugin is available for native Electron testing. Debugging ports/pipes are test tooling only and are not enabled by the distributed app. Screenshot output and temporary test profiles are local verification artifacts.

## Dependency review

The packaging tool's transitive `http-cache-semantics` dependency has an open high-severity advisory with no patched release. `npm audit` reports eight affected build-time packages in that chain. These are development-only and excluded from the desktop bundle. No shared HTTP cache handling private user responses is used by Squeek. Recheck upstream before distributing releases; do not interpret this note as a clean dependency audit.

Reference: [GitHub advisory GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), checked during development.
