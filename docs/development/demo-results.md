# Desktop verification checkpoint

## Verified on this development machine

- Strict TypeScript check and bundled Electron build pass.
- Node suite: 54 tests, all 54 passed in the final full run, including real controlled WPF extraction/filtering, region/identity checks and change signals. Earlier runs skipped that fixture when Windows refused foreground activation; a skipped run is not an extraction pass.
- Native helper, WPF fixture, and C# policy project build successfully. The policy test exercises 12 assertions.
- Real Electron UI tests pass: default paused state, renderer without Node globals, local Windows voices, warning/evidence visibility, mute/cancel, exact simulated action review, changed-field invalidation, Pause invalidation, invalid IPC rejection, and closing/reopening the paused panel.
- Packaged unpacked `Squeek.exe` passed the same flows and ignored a synthetic developer API key. ASAR inspection found only the desktop bundles and package metadata, with no developer dependencies, environment files or fixtures.
- One per-user unsigned NSIS installer is generated with Electron and the self-contained native observer. Windows product/file metadata is Squeek 0.1.0.

Screenshots under ignored `artifacts/qa` were inspected against the saved mature v5 concept. The review panel uses the same ivory, forest and ochre styling, readable text, visible evidence and large controls. This is visual review on one development machine, not intended-user validation.

## Not established

- Owned Chrome 154.0.8037.58 probing had one exact-owned-PID extraction attempt fail with `read_failed`. Later attempts were skipped after Windows refused owned-window activation. No unrelated window text was requested. Chrome/Gmail and Edge extraction, message identity, event coverage, hidden URLs, image-only content and browser occlusion remain unverified.
- OCR is not bundled and no screen images are captured. Unsupported reads remain unknown/unavailable.
- No live Jev request was made. Fake transport tests prove contract handling, retry/deadline/cancellation and actual-request budgeting, not accuracy, provider reliability or prices.
- Available local speech voices and UI behavior were checked; physical speaker output still needs human verification.
- Clean Windows installation, signing, older-user usability, screen-reader behavior and multi-monitor/DPI coverage remain pending.
- CPU, steady-state memory and real-source end-to-end latency have not been characterized. Request counts in the default local-only flows are zero for cloud classification; do not extrapolate this to a configured live-provider workload.

The development-only packaging dependency advisory remains open; see `desktop.md`. No production backend or remote release was deployed.
