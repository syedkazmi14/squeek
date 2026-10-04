import type { SignalExtractor } from "../types.ts";
import { coreExtractors } from "./core.ts";

/** Order is load-bearing: evidence is emitted extractor-major, then span-major. */
export const extractors: SignalExtractor[] = [...coreExtractors];
