// JSON shape returned to both apps. The iPhone decodes it as `CheckResult` (apps/ios/SqueekCore/Models.swift).

import type { LinkVerdict, Reason, Risk } from "./detection/src/index.ts";

export type Level = "danger" | "caution" | "clear" | "unknown";

export interface LinkSummary {
  url: string;
  domain: string | null;
  verdict: LinkVerdict;
  reasons: Reason[];
}

export interface CheckResult {
  kind: "text" | "link";
  level: Level;
  headline: string;
  speech: string;
  reasons: Reason[];
  links?: LinkSummary[];
  checks: { ai?: string; safeBrowsing?: string; redirects?: string };
  incidentId: string | null;
  rulesVersion: string;
  url?: string | null;
  finalUrl?: string | null;
  domain?: string | null;
  isLocal: false;
}

export function levelForRisk(risk: Risk): Level {
  return { high_risk: "danger", caution: "caution", no_detected_signal: "clear", unknown: "unknown" }[risk] as Level;
}

export function levelForVerdict(v: LinkVerdict): Level {
  return { malicious: "danger", suspicious: "caution", no_signal: "clear", unknown: "unknown" }[v] as Level;
}

export function riskForVerdict(v: LinkVerdict): Risk {
  return { malicious: "high_risk", suspicious: "caution", no_signal: "no_detected_signal", unknown: "unknown" }[v] as Risk;
}
