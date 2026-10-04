# Detection evaluation

This implementation has synthetic technical tests only. It has not been evaluated against real correspondence or a live TypeSafe account. No provider credential or private-content request was used.

## Implemented checks

- Local deterministic evidence references observed span indices and matching excerpts. An isolated gift-card mention is insufficient for high risk. Credential/code requests, remote-access requests, and combinations of impersonation/payment, pressure/payment, and romance/money produce local signals independently of Jev availability.
- Partial observations and provider failures preserve uncertainty. Provider categories can raise caution but cannot fabricate evidence, establish high risk alone, execute an action, or authorize a review.
- Outgoing text is bounded and redacts numeric identifiers, emails, phone/card-like sequences, labeled credentials/recovery phrases, hexadecimal private keys, and URL queries/fragments. Redaction is defense in depth and cannot guarantee removal of every secret or personal detail.
- Jev uses the pinned `jev-1.13.0` model, typed `scam_category` choice including `benign` and `insufficient_context`, bounded retries for 429/5xx and a session-wide 100 HTTP-attempt budget including retries, cancellation and timeout, and validated category/token fields. Probabilities are not presented as real-world fraud probabilities.
- Scheduling uses a 400 ms debounce, one-second maximum coalescing, 60-second cache, 32-entry bound, two in-flight cap, and a default 100-request lifetime budget. Source/context/content keys invalidate stale results. Pause clears pending work and cache. Budget or concurrency exhaustion publishes degraded unknown coverage.
- Controlled-action approval binds source identity/revision, recipient, amount, destination, and message for 30 seconds. Approval is consumed once; changed, stale, pending, or expired actions fail. The review class never executes actions.

## Verification

RED baselines failed with missing implementation modules before implementation. Review regression RED baselines demonstrated negated safety-guidance false positives, invalid budgets, and reset-revision session loss. `node --test tests/detection.test.ts tests/scheduler.test.ts tests/jev.test.ts tests/action-review.test.ts` passes 18 focused tests. `npm.cmd run typecheck` passed after the review fixes.

Transport checks use fake fetch responses only, covering authentication failure, malformed category, transient retry exhaustion, timeout, and cancellation. Scheduler checks use fake time and deferred responses. These results do not establish live provider reliability, Windows/browser coverage, detection accuracy, sensitivity, specificity, calibration, option-order stability, or usability.

## Remaining evaluation

Use user-approved representative scam, legitimate, ambiguous, and adversarial examples before relying on detection quality. Measure false positives/negatives per category and coverage level, test option-order effects against a configured live account using approved non-private fixtures, and separately record live token counts and latency. Local rules are English heuristics with narrow negated-request suppression and may miss paraphrases, complex negation, image-only messages, split context, hidden destinations, and unfamiliar payment methods. Real-world evaluation and live smoke testing remain pending.

API contract source: [TypeSafe API reference](https://docs.typesafe.ai/api), checked during implementation. Provider availability is distinct from observation completeness.
