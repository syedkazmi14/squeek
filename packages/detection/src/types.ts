import type { Observation } from "../../contracts/src/observation.ts";

export type RiskState =
  | "suspicious" | "caution" | "unknown_incomplete" | "no_supported_signal";
export type Qualifier = "negated" | "quoted" | "conditional" | "educational";
export type Weight = "weak" | "strong";

export interface Signal {
  category: string;
  spanIndex: number;
  /** Verbatim substring of the original span text at spanIndex. */
  excerpt: string;
  weight: Weight;
  qualifiers: Qualifier[];
}
export interface NormalizedSpan {
  index: number;
  original: string;
  normalized: string;
  /** map[i] is the offset in `original` that produced normalized[i]. */
  map: number[];
}
export interface NormalizedObservation {
  spans: NormalizedSpan[];
  coverage: Observation["coverage"];
}
export interface SignalExtractor {
  readonly id: string;
  extract(input: NormalizedObservation): Signal[];
}
export interface Rationale {
  findings: Signal[];
  combination: string;
  notObserved: string[];
}
