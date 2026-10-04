import type {
  Observation,
  SourceIdentity,
} from "../../contracts/src/observation.ts";
import type { JevProvider } from "../../providers/src/jev.ts";
import { redact } from "./redact.ts";
import { normalize } from "./normalize.ts";
import { qualify } from "./qualify.ts";
import { decide } from "./policy.ts";
import { extractors } from "./signals/registry.ts";
import type { SignalExtractor } from "./types.ts";
export const detectionPolicyVersion = "local-4";
export interface Assessment {
  state: "no_detected_signal" | "caution" | "high_risk" | "unknown";
  source: SourceIdentity;
  revision: number;
  evidence: { ruleId: string; spanIndex: number; excerpt: string }[];
  providerHealth: "local_only" | "available" | "unavailable";
  coverage: "complete" | "partial";
  assessedAt: number;
}
export function sourceId(source: SourceIdentity): string {
  return `${source.processId}:${source.windowHandle}:${source.processStartedAt}`;
}
// Categories whose negated matches were suppressed entirely by the legacy
// implementation; the pipeline reproduces that by filtering them from
// evidence, while the policy (see qualify.ts/policy.ts) discounts them too.
const NEGATION_SUPPRESSED_EVIDENCE = ["credential", "remote_access", "money"];
export async function assess(
  observation: Observation,
  options: {
    provider?: JevProvider;
    signal?: AbortSignal;
    now?: number;
    extractors?: SignalExtractor[];
    policy?: typeof decide;
  } = {},
): Promise<Assessment> {
  options.signal?.throwIfAborted();
  observation = structuredClone(observation);
  const input = normalize(observation);
  const stages = options.extractors ?? extractors;
  const signals = qualify(stages.flatMap((e) => e.extract(input)), input);
  const { state: decided } = (options.policy ?? decide)(
    signals,
    observation.coverage,
  );
  const evidence: Assessment["evidence"] = signals
    .filter(
      (s) =>
        !s.qualifiers.includes("negated") ||
        !NEGATION_SUPPRESSED_EVIDENCE.includes(s.category),
    )
    .map((s) => ({
      ruleId: s.category,
      spanIndex: s.spanIndex,
      excerpt: s.excerpt,
    }));
  const legacy: Record<string, Assessment["state"]> = {
    suspicious: "high_risk",
    caution: "caution",
    unknown_incomplete: "unknown",
    no_supported_signal: "no_detected_signal",
  };
  let state = legacy[decided]!;
  if (
    state === "no_detected_signal" &&
    !observation.spans.some((span) => span.text.trim())
  )
    state = "unknown";
  const high = state === "high_risk";
  const caution = state === "caution";
  let providerHealth: Assessment["providerHealth"] = "local_only";
  if (options.provider) {
    try {
      const response = await options.provider.classify(
        redact(observation.spans.map((s) => s.text).join("\n")),
        options.signal,
      );
      providerHealth = "available";
      if (!high && !caution) {
        if (response.category === "insufficient_context") state = "unknown";
        else if (response.category !== "benign") state = "caution";
      }
    } catch {
      options.signal?.throwIfAborted();
      providerHealth = "unavailable";
      if (!high && !caution) state = "unknown";
    }
  }
  options.signal?.throwIfAborted();
  return {
    state,
    source: { ...observation.source },
    revision: observation.revision,
    evidence,
    providerHealth,
    coverage: observation.coverage,
    assessedAt: options.now ?? Date.now(),
  };
}
