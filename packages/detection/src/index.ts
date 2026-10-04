import type {
  Observation,
  SourceIdentity,
} from "../../contracts/src/observation.ts";
import type { JevProvider } from "../../providers/src/jev.ts";
import { redact } from "./redact.ts";
import { normalize } from "./normalize.ts";
import { qualify } from "./qualify.ts";
import { decide } from "./policy.ts";
import { segment } from "./segment.ts";
import { extractors } from "./signals/registry.ts";
import type { RiskState, Signal, SignalExtractor } from "./types.ts";
export const detectionPolicyVersion = "local-5";
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
const SEVERITY: Record<RiskState, number> = {
  no_supported_signal: 0,
  unknown_incomplete: 1,
  caution: 2,
  suspicious: 3,
};
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
  const policy = options.policy ?? decide;
  // Each unit of text (one email body, one inbox row) is judged on its own, so
  // a word in one message never corroborates a demand in another.
  const units = segment(observation.spans.map((span) => span.rect));
  const byUnit = new Map<number, Signal[]>();
  for (const s of signals) {
    const unit = units[s.spanIndex] ?? -1;
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), s]);
  }
  let decided = policy([], observation.coverage).state;
  let findings = new Set<Signal>();
  for (const unitSignals of byUnit.values()) {
    const result = policy(unitSignals, observation.coverage);
    if (SEVERITY[result.state] > SEVERITY[decided]) {
      decided = result.state;
      findings = new Set(result.rationale.findings);
    } else if (result.state === decided)
      for (const f of result.rationale.findings) findings.add(f);
  }
  // Only the words behind the warning are evidence, in extractor order, each
  // quoted once.
  const quoted = new Set<string>();
  const evidence: Assessment["evidence"] = signals
    .filter((s) => {
      const key = s.excerpt.toLowerCase();
      if (!findings.has(s) || quoted.has(key)) return false;
      quoted.add(key);
      return true;
    })
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
