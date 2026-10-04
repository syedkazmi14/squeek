# Detection evaluation

The current branch contains a reproducible **synthetic detector evaluation**, separate from shipped product wording. It is not a real-mail study or a Windows/browser compatibility result. No private correspondence, live Jev request, API credential, payment, or external message was used in this work.

## Reproduce

Use Node 24+ and the npm lockfile:

```powershell
npm.cmd ci
npm.cmd run evaluate
npm.cmd run evaluate -- --split development --output artifacts/evaluation/development.json
```

On this macOS host, the equivalent commands ran through `npx --yes --package=node@24 --call 'npm run evaluate'` because the installed default Node was 22. The measured runtime was Node v24.21.0, macOS arm64. The retained final measurement was taken October 3, 2026 (America/Chicago); machine timestamps in JSON are UTC.

The report includes corpus hash, conditions, per-case outcomes without message text, category/coverage counts, first-pass and warm local latency, Node process CPU/RSS/heap samples, scheduling counters, simulated outage behavior, and live-provider status. Output defaults to ignored `artifacts/evaluation/held-out.json`. Retained evidence: [starting local rules](results/detection-baseline.json), [final local rules](results/detection-final.json).

## Corpus and denominators

`scripts/evaluation/development.ts` has 16 development cases: 10 scam, 5 legitimate, 1 ambiguous. These drive regression tests and focused fixes. `scripts/evaluation/held-out.ts` has 44 different cases: 20 scam, 16 legitimate, 8 ambiguous. The held-out text/labels were authored and frozen before rule changes, then evaluated without tuning fixes against its outcomes. Both runs have corpus SHA-256 `afede8bdc7d4d4a40307956d0064e9949a98458c0cd76de7aeff58f2addf1532`. Future tuning using those outcomes requires a new held-out split.

These are small hand-authored technical fixtures with thematic overlap, authored by the implementation worker, without independent label adjudication or population sampling. They cannot establish real-world fraud probability, calibrated confidence, universal coverage, or intended-user usability. Scenario labels can describe a scam whose demand is outside extracted text; those misses are deliberately included. Fixture `complete` coverage is supplied by the harness and does not prove native extraction completeness.

An **alert** means `caution` or `high_risk`. False positives count alerts among legitimate cases. False negatives count any non-alert among scam cases, including `unknown` and inaccessible/image-only cases. Ambiguous examples are excluded from those binary denominators and reported separately. Unknown legitimate cases are non-alerts for the binary count, but remain explicit unknowns rather than clean-scan proof. Zero-denominator categories have no recall estimate.

| Local policy | Scam misses | Legitimate false alarms | Scam alerts |
| --- | --- | --- | --- |
| Starting checkpoint `967a168` | 11/20 | 5/16 | 9/20 |
| Final `local-2` | 8/20 (40%) | 2/16 (12.5%) | 12/20 |

Development cases improved from 4/10 misses and 3/5 false alarms to 0/10 and 0/5; that is a development result. Held-out ambiguous cases produced 3/8 alerts, 3/8 unknowns, and 2/8 no detected signals. Six total cases were unknown. No detections are described as verified fraud.

| Category | Scam cases | Misses/scams | False alarms/legitimate | Alerts/ambiguous |
| --- | --- | --- | --- | --- |
| adversarial | 3 | 2/3 | 1/2 | 0/1 |
| coverage | 4 | 2/4 | 0/2 | 0/1 |
| irs | 3 | 1/3 | 0/2 | 0/1 |
| ordinary | 0 | 0/0 | 0/3 | 0/1 |
| payment | 3 | 1/3 | 1/2 | 1/1 |
| phishing | 3 | 1/3 | 0/2 | 0/1 |
| remote_access | 1 | 0/1 | 0/1 | 1/1 |
| romance | 3 | 1/3 | 0/2 | 1/1 |

| Fixture coverage | Cases | Misses/scams | False alarms/legitimate | Unknown cases |
| --- | --- | --- | --- | --- |
| complete | 37 | 6/17 | 2/15 | 0 |
| partial | 7 | 2/3 | 0/1 | 6 |

## Focused fixes and remaining limitations

Development regressions cover Bitcoin/wire demands and requests to buy gift cards; typographic apostrophes in negative safety guidance; disclosure requests phrased as avoiding hesitation; ordinary enthusiasm using “love”; and password-reset instructions versus asking for the password itself. All returned evidence excerpts must occur in their referenced observed span. An isolated gift-card mention still cannot establish high risk. High risk remains grounded in local rules; provider categories alone cannot establish it or authorize an action. Redaction, partial coverage and failure uncertainty remain intact.

Eight held-out misses remain: h03 payment paraphrase, h09 relationship context/paraphrase, h15 login lure and unverified destination, h21 changed-bank-details/business-email compromise, h29 obfuscated text, h30 non-English text, h35 image-only demand, h36 demand outside observed region. The two false alarms are h23 ordinary payment with a deadline and h31 a quoted scam request in training guidance. Authentic romantic/shared-rent requests and authorized support may also trigger alerts because identity/relationship/authorization cannot be verified. General negation, quotation, cross-span context, legitimate urgent purchases, hidden destinations and arbitrary secrets are not comprehensively handled. OCR is not shipped. Jev cannot repair an observation that never captured the necessary content.

## Latency, CPU and memory

Warm latency measures awaited local `assess()` including observation cloning and local evidence; it excludes extraction, scheduling delay, rendering, speech, and network. One unmeasured warmup pass precedes 100 passes × 44 cases (4400 measurements): p50 **0.004083 ms**, p95 **0.006417 ms**, max **1.020417 ms**. The separate first-pass 44-sample latency is in the report. These microbenchmarks are sensitive to host load/JIT/GC and are not end-to-end performance guarantees.

The following samples cover this **Node detector process only**, including its runtime/imports, after warmup. Idle is one second without assessments. Activity is a one-second synthetic burst at up to ten assessments/second. Stress saturates local assessment for one second and is a throughput probe, not representative monitoring. CPU comes from `process.cpuUsage`, summed across process threads and normalized to one core, so it can exceed 100%. RSS is sampled between batches and at endpoints; it is not a guaranteed peak or a leak/steady-state measurement. Heap and sampled RSS maximum are retained in JSON.

| Mode | Wall ms | Assessments | CPU ms | CPU/one core | RSS MiB before → after |
| --- | --- | --- | --- | --- | --- |
| idle | 1001.9 | 0 | 4.054 | 0.405% | 83.42 → 83.48 |
| activity | 1012.1 | 10 | 6.213 | 0.614% | 83.48 → 83.52 |
| stress | 1000.0 | 238300 | 1002.174 | 100.213% | 83.52 → 83.77 |

Whole Electron/native-helper idle CPU and memory, real-browser steady-state measurements, and autonomous observation → warning → speech latency are **pending sections 1/2 integration and a controlled Windows run**. See [release verification](installation.md). Do not substitute this Node profile for the desktop process tree.

## Repeated content, cache, concurrency, cancellation and budgets

The executable fake-clock scheduling probe runs with the evaluation and reports actual counters, with no HTTP calls:

- Twenty observations with identical text and moving rectangles: one assessment start, 19 cache hits, latest revision retained.
- After 60-second expiry: a second assessment start. Pause leaves zero cache entries.
- Two deferred, cancellation-ignoring transports occupy the two slots; changing content aborts both and publishes unknown while saturated. Once capacity returns, the retained latest content is automatically assessed without requiring a further native event. Three total starts, two cancellations, two stale results discarded, zero requests left in flight, recovered revision 3.
- A one-start budget produces exactly one assessment and one degraded unknown for changed content. Existing unit checks separately cover 400ms debounce, one-second maximum coalescing, 32-entry cache bound, session/foreground invalidation, zero/invalid budgets, and pause cancellation/late-result suppression.

Scheduler `requests` count assessment starts, not HTTP attempts. The existing default lifetime scheduler budget is 100 starts; uncached new content degrades to unknown when exhausted, including in local-only use. Provider starts and actual HTTP attempts each have separate limits. Cache hits do not spend a new start; retries do spend HTTP budget. No cached/stale result authorizes an action.

## Local versus Jev

No existing development key was configured in this worktree or process environment, so live comparison is **not tested**. Current live request count is zero; returned token usage and billed cost are **unknown**, not an estimated price. Prior isolated synthetic probes recorded in the starting branch (602 input tokens/431ms direct probe and 557ms desktop guidance check) remain historical smoke evidence only.

The default evaluation also simulates failure on all 44 provider classifications: zero HTTP requests, local alerts preserved, 27 cases are unknown, and the same 8/20 misses and 2/16 false alarms at the alert threshold. This verifies outage policy using a fake provider, not Jev reliability or classification quality. Existing fake transport tests cover 401, a malformed response, 429 retry exhaustion, cancellation, timeout, and retries within a lifetime HTTP-attempt cap.

If a private development key is separately available, this authorized bounded synthetic command compares local-only and local-plus-Jev on exactly the tested subset:

```powershell
npm.cmd run evaluate -- --jev --request-cap 12 --credential-file .env `
  --output artifacts/evaluation/live-held-out.json
```

A cap is mandatory (1–100 actual HTTP attempts), validated before credential-file loading, and includes retries. Tests reject absent/zero/nonfinite/excessive caps. Classification is sequential, uses redacted technical fixture text only and pinned `jev-1.13.0`, and stops at the cap; untested cases never enter quality denominators. Report starts, actual HTTP attempts, validated returned input tokens, failures and latency separately. The adapter exposes only `input_tokens`; output/other token fields and failed-request usage remain unknown. No billed cost is estimated. Category-order stability is explicitly pending. A cap-limited prefix is not a balanced full-corpus result; use the reported same-subset local comparison.

Never print/commit the key, include it in a bundle, or use private correspondence. Packaged classification stays disabled. Backend/authentication/privacy/abuse-control requirements remain in [release gates](installation.md).
