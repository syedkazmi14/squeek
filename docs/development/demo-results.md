# Desktop verification checkpoint

## Verified on this development machine

- Strict TypeScript check and bundled Electron build pass.
- Node suite: 60 tests, all 60 passed in the final full run, including real controlled WPF extraction/filtering, region/identity checks and change signals. Earlier runs skipped that fixture when Windows refused foreground activation; a skipped run is not an extraction pass.
- Native helper, WPF fixture, and C# policy project build successfully. The policy test exercises 12 assertions.
- Real Electron UI tests pass: tray-mode startup with only the nonfocusable cursor companion visible, hidden initial sidebar, close-to-hide, warning-triggered docked review, default paused observation, renderer without Node globals, local Windows voices, warning/evidence visibility, mute/cancel, exact simulated action review, changed-field invalidation, Pause invalidation, invalid IPC rejection, and closing/reopening the sidebar. Repeated movement on this machine's scaled display preserves the companion's fixed size; a second launch exits without creating a duplicate instance. Fake-window tests cover moving the companion independently of assessment, unchanged-position suppression, negative-monitor bounds, separately controlling visibility, and repeated-alert suppression.
- An earlier packaged unpacked `Squeek.exe` passed desktop flows and ignored a synthetic developer API key. The latest tray/companion build completed, but its packaged launch was blocked by this machine's Device Guard policy. Current packaged flows are therefore unverified. Earlier ASAR inspection found only the desktop bundles and package metadata, with no developer dependencies, environment files or fixtures.
- One per-user unsigned NSIS installer is generated with Electron and the self-contained native observer. Windows product/file metadata is Squeek 0.1.0.

Screenshots under ignored `artifacts/qa` were inspected against the saved mature v5 concept. The review panel uses the same ivory, forest and ochre styling, readable text, visible evidence and large controls. This is visual review on one development machine, not intended-user validation.

Pre-push recheck: all 60 Node tests and strict TypeScript checking passed. A fresh development Electron run failed its companion always-on-top assertion: `isAlwaysOnTop()` reported false, including after an explicit setter in an isolated probe. Earlier desktop flows passed, but the latest UI run did not complete; persistent foreground visibility requires investigation.

## Not established

- Owned Chrome 154.0.8037.58 probing had one exact-owned-PID extraction attempt fail with `read_failed`. Later attempts were skipped after Windows refused owned-window activation. No unrelated window text was requested. Chrome/Gmail and Edge extraction, message identity, event coverage, hidden URLs, image-only content and browser occlusion remain unverified.
- OCR is not bundled and no screen images are captured. Unsupported reads remain unknown/unavailable.
- Live Jev was verified after privately configuring a user-supplied development key: one direct synthetic scam probe returned HTTP 200, `unconventional_payment`, 602 input tokens and 431 ms. A desktop synthetic safety-guidance check returned `providerHealth: available` and `no_detected_signal` in 557 ms after explicit opt-in. The desktop started with cloud disabled and opt-in was turned off after testing. These isolated results do not establish accuracy, general reliability or prices.
- Available local speech voices and UI behavior were checked; physical speaker output still needs human verification.
- Clean Windows installation, signing, older-user usability, screen-reader behavior and multi-monitor/DPI coverage remain pending.
- CPU, steady-state memory and real-source end-to-end latency have not been characterized. Request counts in the default local-only flows are zero for cloud classification; do not extrapolate this to a configured live-provider workload.

The development-only packaging dependency advisory remains open; see `desktop.md`. No production backend or remote release was deployed.
