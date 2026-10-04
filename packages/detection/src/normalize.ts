import type { Observation } from "../../contracts/src/observation.ts";
import type { NormalizedObservation, NormalizedSpan } from "./types.ts";

/**
 * Identity transform today. The offset map exists so a future folding step
 * can rewrite text while excerpts stay verbatim substrings of the original.
 */
export function normalize(observation: Observation): NormalizedObservation {
  return {
    coverage: observation.coverage,
    spans: observation.spans.map((span, index) => ({
      index,
      original: span.text,
      normalized: span.text,
      map: Array.from({ length: span.text.length }, (_, i) => i),
    })),
  };
}

/** Slice the ORIGINAL text using normalized offsets, so excerpts stay verbatim. */
export function sliceOriginal(span: NormalizedSpan, start: number, end: number): string {
  if (start >= end || start < 0 || start >= span.map.length) return "";
  const first = span.map[start]!;
  const last = span.map[Math.min(end, span.map.length) - 1]!;
  return span.original.slice(first, last + 1);
}
