// Message redaction, rule signals and policy. Pure TypeScript: no Node, Deno or DOM APIs,
// so the same file runs in Edge Functions and in Electron. Mirrored in Swift by
// apps/ios/SqueekCore/Sources/SqueekCore/Engine.swift; tests/fixtures/golden.json keeps them in step.

import type { LocalAssessment, Reason, Risk, RuleSet, SignalMatch } from "./types.ts";

export const MAX_TEXT_LENGTH = 8000;

export function redact(text: string, rules: RuleSet): string {
  let out = text;
  for (const rule of rules.redaction) {
    out = out.replace(new RegExp(rule.pattern, "gi"), rule.replacement);
  }
  return out;
}

function excerptAround(text: string, start: number, end: number, radius: number): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  let excerpt = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (from > 0) excerpt = "…" + excerpt;
  if (to < text.length) excerpt = excerpt + "…";
  return excerpt;
}

/** Runs every signal rule against already-redacted text. Each signal counts once. */
export function findSignals(redactedText: string, rules: RuleSet): SignalMatch[] {
  const matches: SignalMatch[] = [];
  for (const signal of rules.signals) {
    for (const pattern of signal.patterns) {
      const m = new RegExp(pattern, "i").exec(redactedText);
      if (m) {
        matches.push({
          id: signal.id,
          category: signal.category,
          weight: signal.weight,
          label: signal.label,
          excerpt: excerptAround(redactedText, m.index, m.index + m[0].length, rules.policy.excerptRadius),
          match: m[0],
        });
        break;
      }
    }
  }
  return matches;
}

/** Combines weighted signals into a risk level. Extra score/categories come from links or the model. */
export function decideRisk(
  rules: RuleSet,
  score: number,
  categories: Set<string>,
): Risk {
  const { cautionScore, highRiskScore, highRiskCombos } = rules.policy;
  if (score >= highRiskScore) return "high_risk";
  for (const combo of highRiskCombos) {
    if (combo.every((c) => categories.has(c))) return "high_risk";
  }
  if (score >= cautionScore) return "caution";
  return "no_detected_signal";
}

export function assessLocally(redactedText: string, rules: RuleSet): LocalAssessment {
  const matches = findSignals(redactedText, rules);
  const score = matches.reduce((sum, m) => sum + m.weight, 0);
  const categories = new Set(matches.map((m) => m.category));
  return {
    risk: decideRisk(rules, score, categories),
    score,
    categories: [...categories].sort(),
    matches,
  };
}

/** Headline and spoken sentence for a result, built only from approved templates and reason labels. */
export function messageFor(
  rules: RuleSet,
  key: string,
  reasons: Reason[],
): { headline: string; speech: string } {
  const template = rules.messages[key] ?? rules.messages["unknown"];
  if (reasons.length === 0 || key === "no_detected_signal" || key === "link_no_signal") {
    return { headline: template.headline, speech: template.speech };
  }
  const labels = [...new Set(reasons.map((r) => r.label))].slice(0, 3);
  const speech = `${template.speech} ${rules.messages.reasons_prefix} ${labels.join("; ")}.`;
  return { headline: template.headline, speech };
}
