import type { Observation } from "../../packages/contracts/src/observation.ts";
export interface Case {
  id: string;
  category: string;
  label: "scam" | "legitimate" | "ambiguous";
  coverage: "complete" | "partial";
  texts: string[];
  limitation?: string;
}
export function observation(item: Case, revision = 1): Observation {
  return {
    version: 1, kind: "observation", sessionId: "synthetic-evaluation",
    source: { processId: 1, windowHandle: "1", processStartedAt: 1 },
    revision, observedAt: 0, provenance: "accessibility", coverage: item.coverage,
    spans: item.texts.map((text, index) => ({ text, rect: { x: 0, y: index * 20, width: 300, height: 20 } })),
  };
}
