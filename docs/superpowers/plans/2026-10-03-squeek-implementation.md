# Squeek Implementation Plan

> **For agentic workers:** Implement directly with focused TDD and review. Use superpowers:executing-plans when executing the approved plan. Steps use checkbox syntax. User authorization is required for pushes, merges, deployment, external messages, and new product copy.

**Goal:** Deliver a Windows Electron scam companion with one installer, opt-in local observation, explainable warnings, and local speech.

**Architecture:** A bundled C# observer reads approved foreground Windows content over inherited pipes. TypeScript validates observations, performs local checks, and optionally requests a redacted Jev classification; Electron displays evidence and speaks approved guidance. External apps receive advisory warnings; a separate cooperating demo can hold its own simulated actions.

**Tech stack:** TypeScript, Node.js tooling, Electron, .NET 10 Windows UI Automation, local speech, and an evaluated offline OCR engine. Pin actual package versions in lockfiles when introduced. Use no cloud provider during the first feasibility stage.

**Spec:** [Squeek design](../specs/2026-10-03-squeek-scam-protection-design.md).

**Starting repository:** Documentation and raster concepts only. Development starts in the isolated `squeek-foundation` worktree; task 1 now contains the initial foundation and tests. The latest [mature concept](../../design/squeek-mature-concept-v5.png) is the visual direction; generated screenshots are concepts, not tested interfaces.

## Global constraints

- Windows 11 first; Chrome webmail is a compatibility candidate, not confirmed support.
- One installer includes Electron and its Windows helper/runtime. No extension, browser developer mode, remote-debugging port, or separately installed runtime is part of onboarding.
- Automatic observation is opt-in and limited to supported foreground apps and approved visible regions. Background tabs and windows are excluded.
- Spoken warnings are required. Listening to the user or live calls is a separate feature.
- No automatic payments, account changes, remote control, email deletion, replies, or reports.
- No global input hooks, administrator elevation, hidden background capture, or silent auto-start.
- Observation and provider health stay separate from assessment. Partial reads, outages, and unsupported sources cannot mean a successful clean scan.
- Preserve missing sender identity, URL, and link destinations as unknown. Display labels do not verify identities.
- New warning wording and fixtures need user approval before inclusion in the product.
- Use supplied wording and functional labels only. Public distribution must not contain a shared provider key.
- Coalesce changes with a 400 ms debounce and 1 second maximum window; assessment cache expires after 60 seconds; at most two provider requests run concurrently.
- Keep temporary content in memory and clear it on pause/source changes. Operational logs contain counters and codes, not message text or screenshots.

## Review focus

1. A reused window handle or changed foreground source must invalidate observations and late results (tasks 1 and 2).
2. Missing accessibility events and image-only content must report coverage gaps instead of presenting reassurance (tasks 1 and 3).
3. Password fields, editable authentication controls, and invalid helper messages must produce no extracted sensitive value (tasks 1 and 3).
4. Changed simulated payment details must invalidate review even after a prior continue decision (task 4).
5. Pausing or quitting must stop native work, cloud work, and obsolete speech, including during an outage (tasks 2, 3, and 4).

## Task 1: Observation contracts and Windows feasibility probe

**Outcome:** A tested read-only helper protocol and buildable self-contained Windows observer. A controlled fixture verifies real Windows extraction; real Chrome/Gmail compatibility is a separate manual gate. A probe is not yet automatic protection or a finished Electron app.

**Files:**
- Create `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`.
- Create `packages/contracts/src/observation.ts`, `packages/contracts/src/protocol.ts`.
- Create `apps/desktop/src/main/observer-client.ts` (UI-independent child-process bridge).
- Create `apps/windows-observer/Squeek.Observer.csproj`, `Program.cs`, `Protocol.cs`, `ForegroundReader.cs`.
- Create `scripts/build-observer.ps1`, `scripts/observer-probe.ts`.
- Test `tests/contracts.test.ts`, `tests/observer-client.test.ts`, `tests/windows-observer.test.ts`.
- Document `docs/development/windows-observation-check.md`.

**Interfaces:**
- Produce `Observation`: protocol version, session ID, source identity (`processId`, `windowHandle`, `processStartedAt`), monotonically increasing revision, timestamp, provenance, coverage, and bounded visible text spans with rectangles.
- Produce `ObserverCommand`: `hello`, `observe` with exact foreground process/window and approved region, `pause`, `shutdown`. No arbitrary command, path, or input injection.
- Produce `ObserverEvent`: `ready`, `observation`, `health`, `stopped`. Health uses `available`, `unsupported`, `paused`, `unavailable`; coverage uses `partial` or `complete` independently.
- Produce `ObserverClient`: `request(command)`, `close()`; launch one fixed packaged executable, validate all output before use, enforce one pending request and a deadline, kill stalled helpers.
- Define 64 KiB UTF-8 line limit, 8,000 text characters, 200 spans, and finite positive bounded rectangles. Never log rejected payloads.

- [x] Write failing tests for valid events; unknown fields; wrong version/session/source; malformed JSON; oversized UTF-8 frames; negative/NaN rectangles; too many spans; nonmonotonic revisions.
- [x] Run contract and bridge tests; RED observed against unimplemented functions/classes before implementation.
- [x] Implement strict contracts and bounded inherited-pipe bridge. End the session on malformed output; timeout, EOF, and helper errors become unavailable, never a clean observation.
- [ ] Write helper integration tests for paused startup, invalid commands, mismatched session, shutdown, and foreground mismatch. Use a synthetic Windows fixture for extraction; tests must never read the user's email.
- [ ] Implement .NET helper: no monitoring until a scoped observe command; foreground identity before and after read; visible static text only; exclude protected/editable controls, ancestor-protected subtrees, offscreen content, and unsupported providers; cap traversal. Initial extraction is explicitly partial. Unknown URL/sender metadata remains absent.
- [x] Build with `pwsh -File scripts/build-observer.ps1`; a self-contained win-x64 executable was produced under ignored `artifacts/observer`.
- [x] Run `npm.cmd test` and `npm.cmd run typecheck`; 20 test cases and TypeScript checking passed. C# policy harness includes 12 assertions. Native extraction and real-app evidence remain separate pending gates.
- [ ] Manually test a chosen Chrome/Gmail message without flags or an extension, compare visible text with extracted spans, check changed message/focus/DPI/protected fields, and record gaps. Enable monitoring explicitly before any real-app reading. Decide whether accessibility suffices or task 3 must prioritize OCR.

**Dependency:** None. SDK is a developer build dependency, never an end-user setup requirement. If the SDK is missing, install it locally under ignored `.tools`, without changing machine settings.

**Development record:** Foundation started locally on `codex/squeek-foundation`. Contract/client/native protocol RED baselines were observed before their implementations. Review found editable TextPattern containers and mutable commands during startup; both were fixed with regression coverage. Generic accessibility reader code is present, but a controlled native extraction fixture and real-browser compatibility check are still required, so task 1 is not marked complete. No provider request, real-app read, push, or deployment occurred.

## Task 2: Detection, redaction, provider, and scheduling

**Outcome:** Deterministic evidence and bounded assessments that remain useful during provider failure. Evaluate Jev before depending on it.

**Files:** Create `packages/detection/src/{redact,rules,evidence,policy,scheduler}.ts`, `packages/providers/src/{jev,transport}.ts`, `.env.example`, `tests/detection.test.ts`, `tests/scheduler.test.ts`, `tests/jev.test.ts`, `tests/fixtures/`, `docs/development/evaluation.md`.

**Interfaces:** Consume task 1 validated `Observation`; produce `Assessment` with state (`no_detected_signal`, `caution`, `high_risk`, `unknown`), source/revision, evidence span references, provider health, and sanitized counters. `assess(observation, signal)` never executes actions. `schedule(observation)` invalidates old source/revision work.

- [ ] Write RED tests for urgency plus payment demands, ordinary gift-card mention, sensitive-data redaction, injected instructions, partial content, stale results, foreground changes, and provider outage. Fixtures are synthetic technical test data; product demo wording requires approval.
- [ ] Implement local rules, evidence validation, and code policy; verify an isolated gift-card mention cannot establish high risk.
- [ ] Add cache/context keys, 400 ms debounce/1 second max wait, 60 second expiry, and two-request concurrency. Fake-time tests prove new content is not starved and unchanged content/cursor movement creates no repeated request. Budget exhaustion produces unknown coverage.
- [ ] Read current TypeSafe documentation and safely configure a developer credential only when live integration is needed. Pin `jev-1.13.0` during evaluation; type/schema-check responses; retry transient failures only, with bounds. Test 401, 429, timeout, malformed output, cancellation, and option-order effects using a local fake transport.
- [ ] Run `npm.cmd test -- tests/detection.test.ts tests/scheduler.test.ts tests/jev.test.ts` and typecheck; expected PASS. Run a live smoke test only if a credential is configured and report it separately.
- [ ] Compare rules alone with rules plus Jev on separate held-out cases; publish measured category recall, false alarms, latency, requests, and billed tokens. Do not display confidence as real fraud probability.

**Dependency:** Task 1 contracts. Approved guidance/fixtures before shipping their wording. Real private correspondence requires verified provider retention terms and opt-in.

## Task 3: Electron app and automatic local monitoring

**Outcome:** A runnable mature desktop companion with opt-in observation, visible pause, advisory warnings, and a fixed readable evidence panel.

**Files:** Create `apps/desktop/src/{main,preload,renderer}/`, `apps/desktop/electron-builder.yml`, `apps/windows-observer/{ObservationLoop,CaptureAdapter,OcrAdapter}.cs`, `tests/monitoring.test.ts`, `tests/ipc.test.ts`, `docs/development/coverage.md`.

**Interfaces:** Consume task 1 bridge and task 2 scheduler; produce narrowly validated settings/events over preload. Renderer cannot choose helper paths, start processes, send arbitrary provider requests, or navigate external content. Observer adds bounded start/pause subscriptions using the same source/coverage contract.

- [ ] Test Electron IPC sender allowlisting, opt-in default, pause during extraction/request, unsupported source, helper crash, and source changes before implementation. Pause clears cache, temporary content, and late results.
- [ ] Build bundled UI with sandboxing, context isolation, Node integration disabled, CSP, blocked navigation/new windows, and text-only rendering of untrusted spans. Use the mature v5 visual direction and existing functional labels; keep a fixed review panel and an optional pointer halo.
- [ ] Add local pointer position/motion only; click-through companion cannot take focus or block input. Test monitor boundaries, scaling, keyboard use, reduced motion, tray quit, and fixed-panel mode.
- [ ] Verify a supported real browser adapter and event-driven updates. If events are inadequate, evaluate at most one local changed-region check every two seconds; never make cloud requests per cursor movement or per unchanged screenshot.
- [ ] Evaluate and bundle an offline OCR engine with language/license/runtime assets. Capture only explicitly approved safe regions; if sensitive areas cannot be excluded before capture, report unsupported. Tests cover occlusion, partial/blank/protected images, DPI transforms, unchanged crops, and self-capture exclusion.
- [ ] Run app tests, build, and affected browser-renderer checks; perform native Windows tests separately. Record CPU, memory, event coverage, OCR frequency, and end-to-end latency rather than claiming universal coverage.

**Dependency:** Tasks 1 and 2. OCR selection follows feasibility evidence. No extension fallback.

## Task 4: Spoken guidance and cooperating demo review

**Outcome:** One warning spoken per incident and a visibly identified local simulation that can hold its own action for review.

**Files:** Create `apps/desktop/src/renderer/{speech,review}.ts`, `apps/demo/`, `packages/detection/src/action-review.ts`, `tests/speech.test.ts`, `tests/action-review.test.ts`.

**Interfaces:** Consume validated assessment and approved evidence templates; `speak(assessment)` deduplicates by incident and cancels obsolete speech. `review(action, assessment)` binds consent to source/revision, recipient, amount, destination, and expiry. The demo itself enforces this result.

- [ ] Write RED tests for mute/replay, missing voices, stale speech, pause/quit cancellation, changed amount/recipient/destination, expired review, repeated submissions, mouse and keyboard activation.
- [ ] Add local Windows speech with text equivalent, mute, replay, rate selection, and interruption cancellation. Use approved wording; verify available voices in a packaged app. Microphone capture remains outside scope.
- [ ] Implement the bundled message/payment simulation via restricted IPC. No money moves, real contacts, automatic submission, or replay. A continue decision authorizes only the exact reviewed simulated action.
- [ ] Verify external-browser controls receive advisory warnings only. The simulation must never be presented as universal bank-side blocking or real trusted-contact approval.
- [ ] Run tests, keyboard/screen-reader checks, and Windows voice checks. Check large text, contrast, focus order, and reduced motion; validate usability with intended users before claiming it.

**Dependency:** Tasks 2 and 3; approved product wording. Contact messaging is excluded.

## Task 5: Single-installer release candidate and demonstration

**Outcome:** A locally reviewable Windows installer and measured coverage/cost report. Publication is a separate authorized action.

**Files:** Modify `apps/desktop/electron-builder.yml`, `scripts/build-observer.ps1`, `README.md`; create `scripts/package.ps1`, `docs/development/{installation,demo-results}.md` and relevant packaging tests.

**Interfaces:** Bundle the task 1 self-contained helper and task 3 OCR assets with the task 3 desktop app. Runtime resources resolve from fixed packaged locations. End users install no development tools or runtimes.

- [ ] Test resource lookup, missing/corrupt helper, helper startup deadline, process cleanup, and absent developer credentials.
- [ ] Build one installer with helper/runtime/OCR assets. Do not include `.env`, local SDK, raw fixtures with private data, logs, or shared provider credentials. A public AI-enabled release waits for an authenticated backend.
- [ ] Run full tests, typecheck, lint, build, and secret/dependency review of the changed surface. Installer build is not installation proof.
- [ ] Install and launch as a standard user on a clean Windows machine; verify no browser setup, helper install, extra runtime, or elevation. Check pause, tray quit, offline mode, unsupported pages, capture permission behavior, scaling, and speech. Validate Chrome and Edge separately.
- [ ] Demonstrate a new message, unchanged message, scrolling, changed simulated payment, image-only content, benign example, and provider outage. Report request/token counts plus CPU/memory/latency and detection results. Clearly separate tested support from unknown coverage.

**Dependency:** Tasks 1 through 4. No merge, push, release publication, backend deployment, or real external message is authorized by this plan alone.

## Build order and scope cuts

Start task 1 immediately: contracts, helper lifecycle, self-contained build, and controlled feasibility tests. Its real-browser check determines the automatic monitoring approach. Then implement tasks 2 and 3 as the first end-to-end warning path; task 4 adds the required speech/demo, and task 5 verifies delivery.

Prioritize a working real-app warning over additional adapters, cloud voice, call listening, persistent relationship history, or trusted contacts. Dates and teammate ownership remain unassigned because no deadline or team roster has been supplied. Keep this checklist updated with evidence; an automated test does not establish Windows/browser compatibility.
