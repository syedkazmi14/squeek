# Squeek autonomous scam detection: design

Status: approved for phases 0-3. Awaiting a choice of warning copy (see "Warning copy").

## Decisions taken

- Speech stays on the renderer's local `speechSynthesis` with a `localService` voice. The ElevenLabs prototype at the repository root stays unwired, so the packaged build remains local-only. Revisit after detection lands.
- Scope is phases 0 through 3. The production-shaped evaluation split is deferred to a later phase.
- The native observer will report truncation honestly instead of hardcoding partial coverage.
- Warning copy will be chosen from the options below before phase 1 ships.

## Why this work

Four findings from tracing the current system drive the design.

**Every real observation is marked partial.** The observer emits partial coverage unconditionally. Complete coverage comes only from the manual text box in the desktop main process and from the evaluation harness. So in production, when no rule fires, the detector returns unknown and never reaches its no-signal state. That is the safe direction, but it means the held-out numbers measure a code path the shipped app never executes. It also means the companion's alert-deduplication key, which resets only on the no-signal state, is never cleared in production when a page becomes benign.

**The warning claims certainty.** The renderer holds one hardcoded string asserting that the page is a scam, used both as the displayed label and as the spoken utterance. The detector is advisory and must not make that claim. The caution state renders as a bare word with no explanation.

**Adding a category means editing the combination expression.** The risk decision is a hardcoded boolean over named categories, so no category can be added without touching the decision logic. This is the Open/Closed problem to fix.

**Negation drops evidence silently.** Qualifying context causes a skip rather than an annotation, so the policy cannot weigh it and tests cannot assert why a signal was discounted.

## Current architecture

Six layers.

The native observer under `apps/windows-observer` is a self-contained C# UIAutomation process speaking newline-delimited JSON over stdio. It identifies the foreground window by process id, window handle and process start time, and accepts only Chrome, Edge and the test fixture. Its reader walks the automation tree under caps on element count, elapsed time, span count and total characters, collecting only text controls whose bounds are contained in the requested region, and re-verifies foreground identity before, during and after the walk. Its policy module is the privacy gate: it rejects password elements, offscreen elements, edit and combo-box controls, anything exposing a value pattern, and any text pattern that is not read-only. A change watcher subscribes to automation text, name, bounds, offscreen, structure and focus events and sets a dirty flag.

The contracts package validates the protocol strictly and bounds frame size, character count and span count. Its errors deliberately omit rejected content.

The detection package holds the assessment entry point, a flat array of category-to-pattern pairs, a positional negation helper, and the hardcoded risk expression. Its scheduler debounces, coalesces, caches, limits concurrency and lifetime starts, and cancels stale work by generation. A redaction module strips identifiers before any provider call. An action-review module provides a fingerprint-bound, expiring human approval gate used only by the demo flow.

The desktop main process runs the monitoring cycle (foreground, watch, changes, observe, re-verify foreground), drives the cursor companion and sidebar, deduplicates alerts within a window, and wires tray, windows, IPC and state.

The renderer displays the assessment and speaks it, requiring a local voice.

The evaluation harness scores a development split and a frozen held-out split, and throws if any evidence excerpt is not a substring of its referenced span.

## Proposed data flow

A change in the browser produces a dirty flag, which the monitoring cycle drains on its next poll. The cycle re-verifies the foreground source, requests an observation, re-verifies again, and hands the observation to the scheduler. The scheduler debounces, checks its cache, and calls the assessment entry point, which runs the pipeline:

1. **Normalizer** produces a normalized observation that retains an offset map back to each original span.
2. **Signal extractors**, one per category, emit signals carrying category, span index, a verbatim excerpt, a weight and an empty qualifier list.
3. **Qualifier** annotates signals as negated, quoted, conditional or educational. It annotates; it never drops.
4. **Risk policy** consults a declarative combination table and produces a state plus a rationale.
5. **Explanation** renders advisory wording and a shorter spoken form.

The result flows back through the scheduler to the main process, which publishes state and notifies the companion. The companion deduplicates and shows the sidebar. The renderer displays the findings and speaks via a local voice only.

The assessment entry point keeps its current signature, so the scheduler, monitoring, main process and evaluation harness need no changes. The pipeline lives behind it.

## States

| State | Meaning | Trigger |
| --- | --- | --- |
| `suspicious` | Several corroborating strong signals | A corroboration-gated combination rule |
| `caution` | Some signals, weak or uncorroborated | A lower-tier combination rule |
| `unknown_incomplete` | Squeek could not read enough to judge | Truncated, partial or blank observation, or an unavailable assessor |
| `no_supported_signal` | Rules found nothing in what was read | No signals and coverage reported complete |

These rename the existing four values. The first replaces the current high-risk label; the last replaces the current no-detected-signal label.

### Why the interface must never say "safe"

The observer reads only read-only, non-editable, on-screen text elements inside the foreground window rectangle, under caps on elements, time, spans and characters. A demand can sit in an image, a canvas, a PDF viewer, an editable compose box, a background tab, below the fold, or past any cap. The no-supported-signal state is a statement about Squeek's rule set, not about the page.

The renderer must therefore express that state as an absence of findings in what was read, must render the incomplete state visibly differently, and must never show a success colour, a check mark, or the word "safe" for either.

## Signal and evidence model

A signal carries a category identifier, the index of the span it came from, a verbatim excerpt, a weight of weak or strong, and a list of qualifiers. A rationale carries the findings, the identifier of the combination rule that fired, and a list of what Squeek could not check.

Every finding ties to observed text by construction. Normalization keeps an offset map, so excerpts are sliced from the original span and remain verbatim substrings. The evaluation harness already enforces this and that check stays.

**Combining conflicting and weak signals.** Qualifiers demote rather than delete. A combination whose findings are all quoted or all educational drops one level, from suspicious to caution and from caution to no supported signal. This handles quoted scam text in training material and scam-awareness lessons structurally rather than by special case.

**A property the policy must state explicitly.** A remote assessor may only add caution. It can never create the suspicious state and can never downgrade a local result. This exists today as an incidental branch; it becomes a stated property of the risk policy with its own test, because it is the defence against prompt injection in observed page text.

## Warning copy

The current single string must be replaced by a template per state. Spoken text is a shorter form of the displayed text. Pick one column, or edit any cell.

| State | Option A | Option B | Option C |
| --- | --- | --- | --- |
| `suspicious` | This page asks for money in a way scams often use. Please check with someone you trust before you do anything. | Squeek noticed something that looks like a common scam. Would you like to pause and check with someone first? | Warning sign: this message asks you to send money urgently. Scams often look like this. Take a moment before acting. |
| `caution` | Something here looks unusual. It may be fine, but it is worth a second look. | Squeek is not sure about this one. Check carefully before sending money or personal details. | Possible warning sign on this page. Please read it carefully before acting. |
| `unknown_incomplete` | Squeek could not read enough of this page to check it. | Squeek could not check this page fully. | Squeek could not read all of this page, so it has not checked it. |
| `no_supported_signal` | Squeek did not find a warning sign in what it could read. That does not mean the page is safe. | No warning signs found in the part Squeek could read. | Squeek found no warning signs in the text it could read. It cannot tell you a page is safe. |

Suggested spoken forms, paired with whichever column is chosen: for suspicious, "Squeek noticed a possible scam. Please check before you send anything." For caution, "Squeek is not sure about this page. Please look carefully." The two lower states are not spoken.

## SOLID mapping

| Principle | Change | Files |
| --- | --- | --- |
| Single Responsibility | Split the five jobs the assessment module performs today | New `normalize`, `signals`, `qualify`, `policy` and `explain` modules under `packages/detection/src`; the existing entry point becomes composition only |
| Open/Closed | Extractor registry plus a declarative combination table | A registry under `packages/detection/src/signals` and a policy module. A new category is a new file plus a registry entry and a table row; the monitoring lifecycle, scheduler and main process are untouched |
| Liskov Substitution | A documented assessor contract with one shared contract-test suite run against the local rules, the cloud adapter and a fake | An assessor contract module under `packages/detection/src` and a contract test under `tests` |
| Interface Segregation | The detection package imports only the contracts package and Node crypto, never Electron, networking, the filesystem or the observer client | Enforced by a new import-boundary test |
| Dependency Inversion | The entry point already accepts an injected provider, abort signal and clock; extend it to accept injected extractors and policy with production defaults | The detection entry point, mirroring the scheduler's injected clock |

The assessor contract means: honour the abort signal promptly; never return a state more confident than the evidence supports; never return the no-supported-signal state under partial coverage; bound output size; behave deterministically for local implementations; never escalate to suspicious from remote output alone.

Several components already follow these principles and are the patterns to copy rather than replace. The scheduler injects both its assessment function and its clock. The monitoring class depends on three narrow callbacks rather than Electron. The companion depends on a window-port interface rather than a browser window. The provider gate isolates budget enforcement. The protocol module is pure validation.

The trade-off worth naming: this restructures the one module that currently works. Phase 0 exists so the restructuring lands with provably identical behaviour before any rule changes.

## Boundaries

**Privacy, unchanged.** No optical character recognition, screenshots, keystroke logging, browser debugging ports, extensions, or widened filesystem and network access. The observer's traversal exclusions stay. Region containment and the identity triple stay. Redaction before any provider call stays. The packaged build has no credential, because the key is read only when the application is not packaged.

**Performance.** Metadata polling stays at its current interval and text is read only when the change watcher reports a change. Assessment stays debounced, coalesced, cached, limited to two concurrent runs and to a lifetime start budget that degrades to unknown when exhausted. Normalization adds bounded work over the existing character cap. A per-assessment time budget is added because the extractor count grows.

**Cancellation and staleness.** The scheduler's generation counter and abort controllers stay. The monitoring cycle's source and region re-verification after the read stays. Revision and source equality checks before publishing stay. The detection policy version is part of the scheduler cache key and must be bumped on every policy change.

**Deduplication.** The incident key stays, hashed over source, state, coverage and excerpts within its window. The reset path is fixed to cover the no-supported-signal and incomplete states, not only the state production never emits.

## Observer coverage change

The observer currently reports partial coverage for every observation. It will instead report complete when the automation walk finished naturally and partial when it stopped against any of its caps on elements, elapsed time, spans or characters, or when the foreground changed mid-walk. The contracts package already carries both values and needs no change. The interface stays conservative for both states; the difference is that the evaluation can finally measure the path production runs, and the companion's reset path becomes reachable.

## Test and evaluation plan

**Per category and benign lookalike.** One development fixture pair for each category: government, bank, business compromise, family emergency, technical support, gift card, wire, cryptocurrency, payment app, credentials, one-time code, recovery link, remote access, delivery, tax, benefits, investment and romance. Each is paired with a lookalike drawn from news reporting, scam-awareness material, legitimate account-recovery guidance, or ordinary commerce.

**Qualifiers and robustness.** Negation, quotation, conditional phrasing, educational framing, conflicting evidence, malformed input, pathological input for catastrophic backtracking, and empty or whitespace-only spans.

**Monitoring.** Changed content triggers a read and unchanged content does not. A source switch invalidates. Pause cancels in-flight work and clears the cache. Duplicate alerts are suppressed inside the window and permitted after it. The corrected reset path is covered.

**Contracts.** One suite run against every assessor implementation. One property test asserting every excerpt is a verbatim substring of its span.

**Packaging.** The existing bundle scan is extended to assert that no cloud speech or classification endpoint string and no credential material ships.

**Evaluation.** The held-out split stays frozen and untuned; all tuning happens on the development split. False negatives and false positives are reported separately by category, before and after, with the corpus hash, keeping the existing baseline and final evidence files. Every number stays labelled synthetic.

## Phases

| Phase | Work | Acceptance |
| --- | --- | --- |
| 0 | Extract the normalize, signals, qualify, policy and explain modules from the assessment entry point, with no behaviour change. Add the import-boundary test and the catastrophic-backtracking test | Full suite passes; held-out counts identical to the current run; only the policy version differs; the detection package provably imports nothing beyond the contracts package and Node crypto |
| 1 | Honest states, advisory wording from the chosen column, the deduplication reset fix, and the observer coverage change | No certainty string remains in the renderer; the no-supported-signal state is never rendered as safe; spoken text matches displayed text; the observer reports complete coverage when its walk finishes |
| 2 | Qualifiers as annotations, with demotion in the policy | Quoted and educational development fixtures pass; held-out false positives stay at or below the current two |
| 3 | New categories: delivery, benefits, investment, technical support, family emergency, business compromise | Development split reports no false negatives and no false positives; held-out reported honestly and untuned |

## Risks and assumptions

Richer rules mean more false positives on real banking and commerce pages. For this audience that is a serious harm rather than a nuisance, because a warning on a genuine bank page teaches distrust of the real thing. The mitigation is keeping the suspicious state corroboration-gated and tracking false positives by category at every phase.

Normalization that folds visually confusable characters can both create false positives and break the verbatim-excerpt invariant if the offset map is wrong. The property test on excerpt grounding is the guard.

The synthetic corpus cannot support any claim about real correspondence. No phase produces a real-world accuracy figure, and none is claimed.

The detector stays advisory throughout. It does not click, submit, contact anyone, authorize a payment, or assert that a page is safe.

## Out of scope

Cloud speech, cloud classification in the packaged build, optical character recognition, browser extensions, the production-shaped evaluation split that would measure the partial-coverage path directly, installer signing, and clean-machine installation testing.
