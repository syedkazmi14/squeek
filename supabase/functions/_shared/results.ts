// JSON shape returned to both apps. The iPhone decodes it as `CheckResult` (apps/ios/ClickeyCore/Models.swift).

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

/** Runs work after the response when the Edge Runtime supports it; otherwise waits for it. */
export async function inBackground(work: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const safe = work.catch((err) => console.error(JSON.stringify({ background_error: String(err).slice(0, 200) })));
  if (runtime) runtime.waitUntil(safe);
  else await safe;
}
