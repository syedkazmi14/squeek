import type { NormalizedObservation, Signal, SignalExtractor, Weight } from "../types.ts";
import { sliceOriginal } from "../normalize.ts";

// A sum of money, written numerically.
export const amount =
  /(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:dollars?|usd|euros?|pounds)\b)/.source;
// Where the money is asked to go. Alone this is neutral.
export const destination =
  /\b(?:zelle|venmo|cash app|western union|moneygram|paypal|iban|swift code|routing number|account number|wallet address|bitcoin address|bank details)\b/.source;

/** One signal per span at most, preserving the legacy first-match-wins behaviour. */
export function patternExtractor(id: string, pattern: string, weight: Weight): SignalExtractor {
  return {
    id,
    extract(input: NormalizedObservation): Signal[] {
      const signals: Signal[] = [];
      for (const span of input.spans) {
        const match = new RegExp(pattern, "i").exec(span.normalized);
        if (!match) continue;
        signals.push({
          category: id,
          spanIndex: span.index,
          excerpt: sliceOriginal(span, match.index, match.index + match[0].length),
          weight,
          qualifiers: [],
        });
      }
      return signals;
    },
  };
}
