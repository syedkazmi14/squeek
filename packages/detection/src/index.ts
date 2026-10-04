import type {
  Observation,
  SourceIdentity,
} from "../../contracts/src/observation.ts";
import type { JevProvider } from "../../providers/src/jev.ts";
import { redact } from "./redact.ts";
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
const rules: [string, RegExp][] = [
  ["impersonation", /\b(IRS|government|bank agent|police|support agent)\b/i],
  ["payment", /\b(gift cards?|crypto|wire transfer|bitcoin)\b/i],
  [
    "credential",
    /\b(send|share|give|provide)\b[^.!?\n]{0,40}\b(password|verification code|one.time code|PIN|recovery phrase)\b/i,
  ],
  ["pressure", /\b(immediately|urgent|secret|do not tell|today|arrest)\b/i],
  [
    "remote_access",
    /\b(install|download|allow)\b[^.!?\n]{0,40}\b(anydesk|teamviewer|remote access)\b/i,
  ],
  ["romance", /\b(love|sweetheart|romance)\b/i],
  [
    "money",
    /\b(send|transfer|pay)\b[^.!?\n]{0,40}\b(money|payment|funds|gift cards?|crypto)\b/i,
  ],
];
function negatedRequest(text: string, index: number): boolean {
  const prefix =
    text
      .slice(Math.max(0, index - 80), index)
      .split(/[.!?\n]/)
      .at(-1) ?? "";
  return /\b(?:never|do not|don't|must not|should not|will not|won't|does not)\s+(?:\w+\s+){0,4}$/i.test(
    prefix,
  );
}
export async function assess(
  observation: Observation,
  options: { provider?: JevProvider; signal?: AbortSignal; now?: number } = {},
): Promise<Assessment> {
  options.signal?.throwIfAborted();
  observation = structuredClone(observation);
  const evidence: Assessment["evidence"] = [];
  for (const [ruleId, pattern] of rules)
    for (const [spanIndex, span] of observation.spans.entries()) {
      for (const match of span.text.matchAll(
        new RegExp(pattern.source, "gi"),
      )) {
        if (
          ["credential", "remote_access", "money"].includes(ruleId) &&
          negatedRequest(span.text, match.index)
        )
          continue;
        evidence.push({ ruleId, spanIndex, excerpt: match[0] });
        break;
      }
    }
  const has = (id: string) => evidence.some((e) => e.ruleId === id);
  const high =
    has("credential") ||
    has("remote_access") ||
    (has("impersonation") && has("payment") && has("money")) ||
    (has("pressure") && has("money") && has("payment")) ||
    (has("romance") && has("money"));
  const caution = has("money") && (has("pressure") || has("payment"));
  let state: Assessment["state"] = high
    ? "high_risk"
    : caution
      ? "caution"
      : observation.coverage === "partial" ||
          !observation.spans.some((span) => span.text.trim())
        ? "unknown"
        : "no_detected_signal";
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
