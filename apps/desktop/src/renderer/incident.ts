interface Incident {
  state: string;
  coverage: string;
  evidence: { excerpt: string }[];
  source?: {
    processId: number;
    windowHandle: string;
    processStartedAt: number;
  };
}
/** Bookkeeping updates must not replay the same spoken incident. */
export function incidentKey(assessment: Incident | undefined): string {
  if (!assessment) return "unknown";
  return JSON.stringify([
    assessment.source ?? null,
    assessment.state,
    assessment.coverage,
    assessment.evidence.map((item) => item.excerpt),
  ]);
}
