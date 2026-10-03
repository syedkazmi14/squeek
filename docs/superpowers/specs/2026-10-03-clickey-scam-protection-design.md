# Clickey scam protection: design and build proposal

Status: revised design proposal for a single-install Electron app. No product code or live API integration has been implemented.

Cost and security decisions are included below. A plain-language version for teammates is available in [Clickey explained](../../clickey-explained.md).

## Purpose and assumptions

Build a Windows Clickey companion for older and vulnerable users that notices scam signals during computer use and explains them aloud. Use one Electron installer with a bundled Windows observer, without a browser extension. Enforced action review is limited to Clickey-controlled demo surfaces; observation of external apps provides warnings and voluntary review. Its assistance stays within scam detection, prevention, and education.

Use the SWIVEL challenge wording supplied by the user as the brief. Public research found the current RowdyHacks site and an older challenge; it did not independently verify the quoted current track. Do not substitute the older challenge.

Working assumptions pending correction:

- First release targets Windows 11, with Chrome webmail as an initial compatibility candidate; verify Edge and other apps separately before claiming support.
- Automatic observation is opt-in and limited to supported foreground apps and approved visible regions. Background tabs and windows are excluded.
- One installer includes Electron and its Windows helper/runtime. No extension, browser developer mode, remote-debugging port, or separately installed runtime is part of onboarding.
- Browser email, messages, phishing links, and a controlled payment demo are the initial surfaces.
- Spoken warnings are required. Listening to the user or live calls is a separate feature.
- No existing Clickey implementation or assets are present in this repository. Reuse requires separately supplied source/assets.
- Team size, deadline, API access, and available voice assets have not been supplied. Milestones below are dependency ordered, not time estimates.
- Broad scam categories are a roadmap. Universal detection and prevention are not acceptance criteria for this prototype.

## Recommendation and alternatives

| Approach | Advantages | Costs and limits |
| --- | --- | --- |
| Electron plus bundled Windows accessibility observer and local OCR, recommended | One install; works alongside familiar apps; event-driven text extraction where supported | Native helper and compatibility work; incomplete accessible text/events; hidden destinations and pre-action enforcement are not assured |
| Electron with local screenshots and OCR only | One install; fewer accessibility-provider dependencies | More CPU/battery use, OCR errors, and weaker structural context; still cannot enforce arbitrary external payments |
| Electron app with its own protected browsing surface | One install and greater control within the app | Users must move browsing into Clickey; login/site compatibility; protects only its own surface |

Build and verify the bundled observer first. Use accessibility text as the primary input and local cropped OCR as a fallback. Keep a manual check available when automatic observation is incomplete. Do not replace the user's browser or add an extension as a fallback without a new user decision. If enforced pre-action review becomes essential, assess a Clickey-owned browsing/payment surface separately.

## Benefits and product risks

Benefits: intervene where the user is already working; reduce the effort of requesting a scam check; provide audible assistance and readable evidence; connect warnings to the user's intended action; let the user consult a trusted person. These are product hypotheses, not validated outcomes for older users.

Risks and responses:

- False positives interrupt legitimate activity. Use graduated interventions, deduplication, review controls, and legitimate examples in evaluation.
- False negatives can create misplaced trust. An uneventful scan is not an identity verification or a guarantee of safety.
- A moving cursor companion can obscure content or feel patronizing. Keep the normal pointer, use a small optional companion, offer a fixed panel, and test readability with intended users.
- Scammers can pressure users to dismiss warnings or disable protection. Make evidence and voluntary review useful; do not claim a companion overlay is tamper proof.
- Cloud analysis can expose private correspondence. Minimize and redact before transmission; explain cloud use during opt-in.
- A family contact can be unavailable or abusive. The user chooses and can revoke the contact; do not make another person's control the default.
- Electron adds memory and packaging overhead. Keep observation event driven and measure resource use on Windows.
- Detection cannot verify every real sender, bank account owner, attachment, relationship, or hidden link destination from accessible/visible text. Preserve unknown values and explain missing coverage.

## User flow

1. User installs Clickey once, enables supported-app monitoring, reviews cloud-data use, and selects speech settings. Respect any Windows capture prompts required by the selected capture API.
2. Opening a supported email or changing relevant visible content triggers a bounded scan through the bundled observer without requiring a prompt.
3. The companion shows the current assessment; substantial risk opens a readable panel and speaks once.
4. The panel displays evidence from the actual message, link, or action and a relevant protective step.
5. External apps receive warnings and user-initiated review. Only a Clickey-controlled demo action can be held before submission; there the user can cancel, examine evidence, or deliberately continue after review.
6. The user may request trusted-contact review when that integration is available. Sharing requires explicit action.

New warning wording and fixtures need user approval before inclusion in the product. Preserve provided wording and assets. Do not generate biographies, taglines, testimonials, invented achievements, or decorative copy. Functional labels should remain plain. Use technical state identifiers below as internal contracts, not polished user-facing text.

## Scope

### Initial deliverable

- Windows desktop companion with tray controls, pointer-following visual, and a separate stable review panel.
- Bundled Windows observer with one real foreground webmail adapter, provisionally Gmail in Chrome, validated on the installed browser/Windows combination. Do not claim compatibility from documentation alone.
- Real adapter extracts visible accessible message text and sender information if exposed. Link destinations and address-bar URLs are recorded only when reliably exposed and distinguishable from display text; missing values remain unknown. Displayed sender identity remains unverified.
- Local cropped OCR fallback for explicitly enabled supported regions, with incomplete observation and sensitive-region exclusions.
- A local demo email/message page and simulated payment page to test intervention safely. No money moves and no real accounts are fabricated.
- Load the cooperating demo inside a bundled Electron window using restricted IPC. Its payment review is explicit demo behavior, not an interception of the user's real browser or bank.
- Scam dimensions covering government/business impersonation, credential/code requests, suspicious payment demands, urgency, secrecy, remote-access requests, and romance-related money requests.
- Jev provider adapter, deterministic protective rules, explicit uncertainty, and failure states.
- Audible warnings, replay, mute, and text equivalent. Start with local speech; optional cloud voice comes later.
- Automated policy/adapter tests and Windows packaging checks.

### Later milestones

- Additional Windows/browser accessibility adapters and broader OCR coverage. Desktop-wide coverage requires separate validation.
- User-initiated voice questions with speech-to-text and scam-only responses.
- Authenticated trusted-contact review across devices.
- Longitudinal romance/investment scam context with explicit retention consent.
- More email/chat/payment adapters and additional languages evaluated independently.

### Excluded from the first deliverable

- Live telephone interception, always-on microphone use, and voice-clone verification.
- Reading every app, all background tabs, all email history, or all clipboard changes.
- Automatic payments, account changes, remote control, email deletion, replies, or reports.
- Universal bank transfer blocking or recovery of funds.
- Global click/keyboard interception, DLL injection, administrator elevation, or remote debugging of the user's browser to force coverage.
- Attachment execution, antivirus scanning, and broad autonomous computer assistance.

## Architecture and proposed paths

Use TypeScript for Electron, its UI, shared contracts, and detection. Bundle a Windows helper, provisionally C#/.NET using supported Windows accessibility APIs, as a self-contained component of the same installer. Electron does not itself expose the accessibility trees of other apps. The helper stays behind a narrow read-only observation contract; select maintained dependency versions and verify packaging during implementation.

| Proposed path | Responsibility |
| --- | --- |
| `apps/desktop` | Electron main/preload, companion, review panel, tray, local speech adapter |
| `apps/windows-observer` | Bundled accessibility client, foreground/source identity, relevant events, local capture/OCR adapter, and bounded IPC |
| `apps/demo` | Controlled email/message/payment scenarios with visibly identified simulation |
| `packages/contracts` | Observation provenance, source revision, context quality, evidence, assessment, controlled-action identity, and health schemas |
| `packages/detection` | Local extraction, rules, Jev questions, policy, evidence validation |
| `packages/providers` | TypeSafe transport and optional voice transport |
| `tests/fixtures` | Approved synthetic scam, legitimate, ambiguous, and adversarial examples |

Data flow:

`supported foreground app changes -> Windows accessibility text or local cropped OCR -> local redaction/rules -> duplicate check -> bounded Jev assessment -> code policy -> desktop warning + voluntary review`

Keep API credentials in the local privileged process for a developer prototype. A public distribution requires a backend with per-user authentication, rate limits, and abuse controls; never ship a shared provider key in the installer. Do not deploy this backend without authorization.

Electron launches the bundled observer with restricted inherited pipes or an equivalently access-controlled local IPC channel. Validate schema, message size, session/source identity, and revisions. Expose only start, pause, bounded observation, health, and shutdown capabilities; untrusted content cannot supply executable commands, arbitrary paths, or input-injection requests. The helper has the user's ordinary privileges and never elevates silently. Package its runtime with the app so the user has no separate helper/runtime installation step.

Electron renderers load bundled UI, use context isolation and sandboxing, disable Node integration, and expose narrow preload capabilities. Validate IPC senders and external navigation. Untrusted page content is rendered as text.

Sources: [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview), [.NET self-contained publishing](https://learn.microsoft.com/en-us/dotnet/core/deploying/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

## Observation and cursor behavior

- Observe only the supported foreground window/document and relevant accessibility events. Scope extraction to visible ranges and approved regions; filter offscreen/background content. Debounce changes, cap payload sizes, and hash relevant content to avoid repeated calls.
- Track process/window identity, document context, source revision, and provenance (`accessibility`, `ocr`, or `mixed`). Use foreground changes and reliable document context to invalidate old results; do not mistake a reused window handle for an unchanged source.
- Record the minimum text needed for a decision. Actual link destinations, sender addresses, and current-page URLs may be unavailable through accessibility/OCR; never infer them from link labels or fabricated metadata. OCR observations include quality/coverage limits.
- Skip protected/password controls and known sensitive regions before extraction or capture. Exclude account/card numbers, verification codes, and recovery phrases from transmitted content. If a region cannot be safely scoped, mark it unsupported rather than capturing it broadly. Redaction is defense in depth, not perfect anonymization.
- Retain relevant context in memory for the current interaction only; give it a short expiry and explicit clearing on navigation, tab change, or pause.
- Keep background tabs/windows and Clickey's own UI from feeding the foreground assessment. Discard old results after foreground, document, observation, or controlled-action changes.
- Follow the pointer locally using Electron screen coordinates; clamp to display work areas and account for DPI scaling. Never make a model request on pointer movement.
- Keep the companion click-through and non-focus-stealing. Put buttons in a separate interactive panel.
- Do not use an Electron window as an OS-wide click blocker. It cannot reliably enforce protections across arbitrary apps.
- Test monitor transitions, display scaling, reduced motion, keyboard use, and quitting from the tray.

Electron provides window mouse pass-through. Windows UI Automation obtains information through each app's accessibility provider; Chromium documents Windows accessibility interfaces including UIA and IAccessible2. Provider/version behavior must be verified on real target apps. Do not require browser launch flags or force browser restarts to satisfy onboarding. Sources: [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), [Chromium accessibility overview](https://chromium.googlesource.com/chromium/src.git/+/HEAD/docs/accessibility/overview.md).

## Automatic monitoring without continuous cloud video

Use event-driven local observation. The cursor's position and appearance stay local and never trigger an assessment request. Automatic detection begins after the user enables supported-app monitoring; it does not require a button press for each email or message.

1. The bundled observer subscribes to focus, relevant text/property, and structure changes in supported foreground apps. Extract visible accessible text using appropriate text/control patterns. Verify new-message and browser-document identification per adapter; inaccessible or incomplete content remains unknown.
2. Run local redaction and independent protective rules. Exclude decorative changes such as clocks, loading animations, cursor movement, and unrelated layout mutations from assessment triggers. Do not require scam keywords before assessing a new relevant message.
3. Coalesce bursts of relevant changes with an initial 400 ms debounce and a 1 second maximum coalescing window. These are proposed defaults to validate, not measured latency. Keep requests bounded and discard results for old document revisions.
4. Hash relevant assessment inputs in memory. Reuse an assessment only while its foreground source, content, context quality, model/policy version, and known action details still match. Use an initial 60 second cache expiry. Clear affected entries on pause, foreground/document changes, changed observed content, or changed controlled-action details. Never treat a cache hash as anonymization.
5. Clickey-controlled demo actions run immediate local checks and request a fresh assessment when recipient, amount, destination, or context differs. External app observations cannot guarantee that an impending payment will be seen or held; warn when evidence is available and expose uncertainty. No automatic financial submission or replay is allowed.

Accessibility is the primary input in the first release. Some apps expose incomplete information or unreliable events; unsupported surfaces must remain visibly unsupported. For image-only or inaccessible content in approved supported regions, use local cropped OCR after relevant changes. An initial maximum of one local change-check per two seconds may be evaluated where events are inadequate, pausing it when the source is not foreground or monitoring is paused. Compare crops locally, ignore cursor/decorative changes, and run OCR only for changed relevant regions. Capture frequency must be measured against CPU, battery use, and detection coverage. Local OCR has no cloud inference charge, but is not resource-free.

Evaluate Windows capture APIs in the helper or Electron's local desktop capture capability. Prefer a bundled offline OCR engine initially so its runtime and language data ship in the same installer. Microsoft's `Windows.Media.Ocr` APIs require package identity for desktop apps; using that engine instead requires an explicitly verified packaging/identity strategy and language availability. Do not assume a normal Electron installer can call it without that work. Verify capture prompts, protected/blank surfaces, DPI, coordinate transforms, occlusion, and self-capture. Minimized, locked-desktop, protected, elevated, and cross-user surfaces are outside initial coverage. Do not silently elevate, disable protected capture, or use a browser debugging port to bypass these boundaries.

Do not continuously transmit screen video, run cloud vision every two seconds, or send whole-desktop captures to Jev. Jev's documented input is text only. Local screenshots, if used, remain short-lived in memory and are released after extraction; only necessary redacted text may leave the device.

Keep a small bounded request queue, initially at most two assessments in flight. Replaced observation revisions cancel queued work where possible; an already submitted request may still be billed. Budget exhaustion, incomplete reads, dropped observations, or provider failures must produce a degraded/unknown assessment state rather than a safe result. Deduplication must not suppress new relevant messages or changed observed payment details.

Sources: [Windows UI Automation events](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsoverview), [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer), [Windows capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture), [Windows accessibility security](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview), [Jev input formats](https://docs.typesafe.ai/models).

OCR packaging source: [Windows.Media.Ocr desktop package identity requirement](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr?view=winrt-26100).

## Jev: assessed fit and integration contract

Official documentation confirms Jev returns typed Choice, Score, and Noul evaluations rather than generated prose. Jev 1.13 accepts text, not screenshots or audio. The documented endpoint is `POST https://api.typesafe.ai/v1/systemone`; use the official JavaScript SDK if its installed API fits. Pin `jev-1.13.0` during evaluation rather than a moving alias. No authenticated request has been made in this task.

Ask independent questions about:

- Claimed authority and apparent impersonation signals.
- Pressure or threats requiring immediate action.
- Secrecy or instructions to avoid independent verification.
- Requests for credentials, codes, recovery phrases, or remote access.
- Requested payment method and suspicious surrounding context.
- Romance-related money requests and available relationship context.
- Overall scam category, including ambiguous and insufficient-context options.

Code computes URLs, amounts, timestamps, domain comparisons, expiry, and action binding. A gift-card mention alone is not enough to classify a message as a scam.

Choice/Score confidence measures concentration of the answer distribution. It is not independently verified real-world fraud probability. Do not display it as certainty that a person is a scammer. Noul outputs require their own empirically selected thresholds.

The vendor identifies adversarial steering, literal interpretation, long irrelevant context, option-order effects, and arithmetic limitations. Short prompts and schemas do not eliminate these failures. Keep page text untrusted, preserve independent rules, include injection examples in evaluation, and check option-order stability on representative cases.

Recommendation: use Jev as a replaceable classifier candidate. Do not grant it permission to pay, navigate, message, or unblock an action. Decide whether it improves the product by comparing rules alone with rules plus Jev on held-out scam examples.

Sources: [Introduction](https://docs.typesafe.ai/introduction), [API](https://docs.typesafe.ai/api), [Models](https://docs.typesafe.ai/models), [Confidence](https://docs.typesafe.ai/confidence), [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

A September 29, 2026 preprint reports broad classification results and notes binary threshold calibration issues. It does not establish performance on this app's scam scenarios. Source: [Evaluation paper](https://arxiv.org/abs/2609.37647).

## Policy, evidence, and prevention

Maintain assessment separately from observation/provider health. Internal assessment states: `no_detected_signal`, `caution`, `high_risk`, `unknown`. Health states include `available`, `unsupported`, `paused`, and `unavailable`. Unknown or unavailable must never be rendered as a successful clean scan.

Policy combines severity, context quality, explicit rule evidence, model results, and whether an action is imminent. Calibrate thresholds against development fixtures, then report performance on separate held-out examples. Do not invent universal confidence cutoffs or average unrelated probabilities into a purported fraud score.

- No detected signal: no interruption; no guarantee of safety.
- Caution: compact evidence and optional speech when action is imminent.
- High risk: prominent evidence, one spoken warning, and review for supported actions.
- Unknown: expose uncertainty and a manual review route.
- Provider outage: keep local rules and supported review behavior; disclose degraded coverage. Do not trap ordinary browsing indefinitely or imply that a completed AI scan occurred.

Every reason references an observed span, normalized URL fact, or approved rule. Jev cannot generate these spans; code extracts candidates and validates any selected evidence. Evidence explains detected signals, not a claimed reconstruction of the model's private reasoning.

Use FTC guidance as a curated source for rules involving impersonation, unexpected money requests, urgency, and restrictive payment demands. Source: [FTC scam signs](https://consumer.ftc.gov/consumer-alerts/2025/03/what-are-signs-scam).

Implement enforced pre-action review only inside the controlled local demo, with the demo application explicitly cooperating. Cover mouse and keyboard activation, form submission, changed content, and navigation. Bind any continue decision to source/document revision, target, action, and expiry. Invalidate it on recipient, amount, or target changes. Never automatically retry or replay a financial submission; the user initiates a fresh action after review.

Accessibility notifications describe UI activity but are not a universal cancellable before-click event. Reading a payment button or noticing focus does not establish reliable interception. Clickey's external-app overlay provides warning and voluntary review; it cannot guarantee stopping a click, credential submission, navigation, or bank transfer. Do not introduce global input blocking or claim an advisory overlay enforces payment authorization. Clearly identify the cooperating demo and distinguish its control from external-app coverage.

## Voice and accessible UI

Use a speech adapter with local speech synthesis first, enumerate available voices, and verify behavior in the packaged Windows app. Provide mute, replay, rate controls, cancellation on stale assessments, and a text equivalent. Speak once per incident unless requested again. The voice must not lag behind changed page context.

Start with user-approved evidence-based templates so Jev does not need a generative model to explain common cases. A later generative explanation service may elaborate only from validated evidence and approved guidance; it cannot change policy or invent official phone numbers.

Speaking back does not require a microphone. If two-way voice is selected, add push-to-talk, explicit recording indication, transcription, bounded scam-question routing, and cancellation in a later milestone. Live call detection requires a separate audio capture and privacy design.

Optional cloud TTS can improve voice quality but adds cost, network dependence, and data disclosure. Preserve local speech/text fallback. Source for speech capability: [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis). Windows/Electron availability is unverified until tested.

Use large readable text, high contrast, comfortably sized buttons, keyboard navigation, and screen-reader labels. Convey severity through text and shape as well as color. Prefer a fixed readable panel for explanations. Validate with older users before claiming usability benefits.

## Trusted contact

First prototype may show a local review workflow, explicitly identified as a simulation. Never imply a real person was contacted or approved it.

A real flow requires user-selected contacts, authenticated pairing, explicit sharing consent, minimum necessary evidence, short-lived single-use requests, and authorization enforced by a backend. Bind review to exact action details; changes invalidate review. Test expiry, wrong contact, duplicate responses, and unavailable contacts.

Contact approval provides reassurance, not proof a payment is legitimate. It must not execute a payment or silently disable independent warnings. External messaging and deployment require user authorization.

## Privacy, reliability, and costs

- Default to no retained raw emails, screenshots, audio, or full URLs with query secrets in logs.
- Log request IDs, provider/version, timing, decision codes, and sanitized errors only.
- Keep monitoring visible and reversible; do not register auto-start silently.
- Confirm provider retention terms before using real private correspondence. TypeSafe documents no training on customer requests; enterprise zero-retention availability is not a promise for a normal account.
- Apply request deadlines, limited concurrency, cancellation, and bounded retry for transient errors. Do not retry authentication or schema failures.
- Initial engineering targets: local review UI responds within 150 ms and remote assessment p95 stays below 2 seconds on the test machine/network. These are targets, not measured results.
- Measure tokens, request frequency, speech latency, CPU, and memory. Deduplicate incidents to control cost and warning fatigue. Do not base the budget on vendor speed comparisons alone.

Source for provider data terms: [TypeSafe legal documents](https://docs.typesafe.ai/legal).

### Security boundaries to implement and demonstrate

- Permission boundary: observe only enabled supported apps and approved foreground regions. Optional site restrictions require a reliably observed current-page URL; disable collection when that restriction cannot be verified. A visible pause control stops observation, capture, and transmission. Avoid background collection, microphone capture, clipboard monitoring, and silent auto-start.
- Data boundary: perform extraction, cropping, redaction, and duplicate checks locally. Do not collect password values, authentication codes, card numbers, recovery phrases, or raw correspondence in logs. Redaction reduces exposure but cannot guarantee anonymity; minimize collection before redacting.
- Helper/desktop boundary: launch the packaged helper over a restricted local channel, validate session/source identity, schema and payload size, and keep observation read-only. Kill or restart a stalled helper without displaying a clean result. Untrusted content cannot supply executable commands, arbitrary file paths, or input-injection requests. No global keyboard hooks, browser debugging ports, or silent privilege elevation are required.
- Provider boundary: use encrypted transport, request deadlines, authentication, per-user quotas, and rate limits. Public distribution uses a backend-held provider key; installer and renderer assets never contain a shared API key. Local developer credentials are not a distribution strategy.
- Decision boundary: incoming page text remains untrusted data. Jev cannot modify policy, run arbitrary tools, initiate a payment, send messages, or grant an action permission. Prompt instructions alone do not prevent adversarial steering. Independent code rules remain active even if a model result is misleading or unavailable.
- Retention boundary: keep temporary content in memory, explicitly clear it, and retain only sanitized operational metrics by default. Verify provider retention terms before sending real private content; local deletion does not guarantee deletion by the provider.
- Coverage boundary: identify unreadable/unsupported surfaces, partial OCR, unavailable destinations, and degraded scans. External-app warnings are advisory; only a cooperating demo holds its own actions. Neither is bank-side authorization or universal protection.

Verify these boundaries with invalid helper messages, mismatched source/session identities, sensitive-data fixtures, injected instructions, stale results, foreground changes, inaccessible content, pause behavior, helper failures, and provider outages. Sources: [Windows accessibility security](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Jev adversarial-content limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

### Cost model and evidence

TypeSafe's published Jev 1.13 price, checked October 3, 2026, is $0.042 per million input tokens; output tokens are free. Recheck before budgeting or presenting. Count the entire request's input, including state and question instructions.

`Jev cost = assessments x mean billed input tokens per assessment x $0.042 / 1,000,000`

Illustration assuming 2,000 input tokens per request:

| Workload assumption | Requests | Jev inference estimate |
| --- | --- | --- |
| One request every two seconds for one hour | 1,800 | $0.1512 |
| 60 distinct assessments during one hour | 60 | $0.00504 |
| 1,000 assessments | 1,000 | $0.084 |

These are arithmetic examples, not measured usage, guaranteed savings, or the total app cost. The second example makes 30 times fewer requests only under the stated workload assumptions. Do not claim an equivalent reduction in total cost. Hosting, network transfer, optional cloud speech/vision, and local CPU/battery use are separate. OCR every two seconds does not inherently mean 1,800 cloud requests if OCR runs locally. A video stream can add bandwidth and model processing; streaming alone is not a cost optimization.

Start with local speech and approved templates, speaking once per incident unless replay is requested. Evaluate cloud voice separately if selected. Bound input size without silently dropping important context; mark incomplete observations as unknown or use deliberate chunking and evidence aggregation.

Record sanitized counters for observation events, deduplication hits, OCR runs, provider requests, billed tokens, retries, stale results, coverage gaps, warning counts, CPU, memory, and end-to-end latency. Compare idle browsing, a long unchanged message, new message arrival, scrolling, rapid page updates, a changed payment, and image-only content. Compare scam recall and false alarms as well as request counts so cost reductions cannot conceal missed scams.

Source: [TypeSafe model pricing](https://docs.typesafe.ai/models).

## Five build milestones

These are the proposed sequence. A task-level execution plan follows approval of this design.

| Milestone | Outcome and paths | Dependencies | Required verification |
| --- | --- | --- | --- |
| 1. Single-install shell and observer feasibility | `apps/desktop`, `apps/windows-observer`, `packages/contracts`: packaged helper returns bounded foreground accessible text/events to Electron | Approved design, Windows tooling | Read actual target browser/webmail without an extension, launch flags, debugging port, elevation, or extra runtime install; compare visible text/events with expected content; protected/background content excluded; invalid messages rejected; helper shutdown; cursor click-through; scaling; voice feasibility |
| 2. Detection and evaluation | `packages/detection`, `packages/providers`, `tests/fixtures`: redaction, rules, Jev adapter, evidence, policy, cache, quotas, and sanitized usage metrics | Contracts from 1; approved fixtures; configured TypeSafe credential for live tests | Red/green policy tests; deduplication/expiry/context keys; sensitive-data fixtures; malformed output/timeouts/rate limits; rules-only comparison; adversarial examples; held-out category results, tokens, and latency |
| 3. Accessibility/OCR monitoring and controlled review | `apps/windows-observer`, `apps/desktop`, `apps/demo`: one real email adapter, local changed-region OCR, advisory warnings, and cooperating demo action review | 1 and 2 | Real-app event/read coverage; image-only OCR; blank/partial capture; password exclusions; unchanged regions skip repeated work; rapid changes do not starve checks; focus/document changes invalidate stale results; pause stops capture/transmission; demo mouse/keyboard actions and edits invalidate review; no automatic replay; external actions explicitly advisory |
| 4. Speech and review UX | `apps/desktop`: approved warning content, speech controls, evidence panel; optional local contact simulation | Assessment and action flows from 2 and 3 | Packaged audible output, mute/replay/cancel; text fallback; keyboard accessibility; 200% text scaling; no duplicate speech or obstructed clicks |
| 5. Package and demonstrate | One Windows installer, setup documentation, evaluation report, cost/coverage report, demo instructions | 1 through 4 | Typecheck, lint, focused tests and build; clean standard-user Windows launch with bundled helper/runtime/OCR dependencies; no extension installation or browser settings required; Chrome/Edge and OCR claims tested separately; live Jev smoke test if available; outage/benign controls; measured requests, tokens, latency, CPU, memory and privacy checks; no shared provider key |

Milestone 1 is a feasibility gate: if accessible text/events are inadequate on target apps, evaluate local OCR coverage and resource use before committing to a detection claim. Report the limitation rather than reverting to an extension. Prefer completing milestones 1 through 3 over adding cloud voice, call capture, or multiple adapters. Cut optional features if they threaten a working end-to-end demonstration. No push, PR, deployment, or external message is part of this proposal's approval.

## Evaluation and acceptance

Propose at least 60 approved examples for the first evaluation: 20 scam, 20 legitimate, and 20 ambiguous/adversarial. Split development and held-out cases before tuning. This is a prototype check, not production validation. Add more samples per scam family before reporting strong accuracy claims.

Report scam recall, false-positive rate on legitimate content, high-risk warning precision, abstention frequency, and end-to-end latency. Report raw counts and category failures, not only aggregate accuracy. Evaluate obfuscated links, legitimate gift purchases, quoted scam warnings, sparse context, prompt injection, and recipient/amount edits.

Release acceptance:

- Opening a supported foreground email triggers observation without user prompting, through the installed Electron app and its bundled observer.
- Each new relevant message is assessed without requiring scam keywords. Unchanged content and cursor movement do not generate repeated provider requests.
- Cache expiry, changed foreground message/context, and edited known payment details cannot reuse an incompatible assessment. Debounce and queue limits expose skipped or degraded coverage rather than claiming safety.
- Enabled-app/region scope, pause behavior, source validation, sensitive-data filtering, capture exclusions, and sanitized logging are verified.
- A risky controlled action receives review before execution through every tested supported activation path.
- The controlled action is visibly a cooperating local demo; external-app monitoring never implies guaranteed pre-click or payment blocking.
- Evidence is linked to actual source content; no fabricated sender verification.
- Changed documents/actions cannot consume stale assessment or approval.
- Unknown, unsupported, and unavailable states cannot appear as safe.
- Local rules and explicit degraded status survive a provider outage.
- Windows companion, click-through behavior, speech, tray quit, and installer/setup are verified.
- A standard user can install and launch one package without a browser extension, special browser flags, developer mode, or a separately installed helper/runtime. Automatic monitoring still requires clear opt-in and any necessary capture permissions.
- Accessibility and OCR adapters expose incomplete/unsupported observations rather than inventing destinations or reading protected/background content.
- No real money moves, real contacts are notified, or sensitive content enters logs during tests.
- Automated checks and manual Windows checks are reported separately; mocked provider tests do not count as a live Jev integration.

## Demonstration sequence

Use approved examples and local simulated pages. Start with a legitimate message to establish quiet behavior. Open an impersonation/payment scam and show automatic detection, evidence, and speech. Attempt its controlled risky action and show review. Change the action details and show that earlier review no longer applies. Disconnect the provider and show honest degraded behavior. If contact review is simulated, identify that explicitly.

Show one-app onboarding, then sanitized request/token counters: leaving the same message open or moving the cursor adds no repeated assessment calls; a new relevant observation creates new work. Show the real foreground adapter and the local OCR fallback separately. Demonstrate pause stopping collection/capture/transmission and show redaction using synthetic sensitive-data fixtures. Label payment enforcement as the cooperating demo's behavior. Report measured savings and resource use only after running the workload comparison.

The demonstration should prove the complete observation-to-intervention loop. Do not claim that all scams, apps, phone calls, or financial transactions are protected.

## Decisions to settle before implementation

- Single-install Electron delivery is required. Settle the first real-app compatibility target and native OCR engine after the observer feasibility check; live calls remain outside initial scope.
- Approve this design, initial warning wording, and test/demo examples.
- Confirm whether two-way voice and real trusted-contact review are required for the first version.
- Establish deadline/team capacity and provision TypeSafe access without exposing credentials.
- Supply earlier Clickey assets/source if continuity with that project is required.

## Research and verification status

Repository inspected: empty Git repository on `master`, no commits and no application files. Official TypeSafe, Electron, Chrome, Microsoft, and FTC documentation were consulted. The design is a proposal; model quality, packaged speech, native bridge behavior, usability, and performance have not been tested. No app code, dependencies, commits, remote changes, or authenticated provider calls were created.
