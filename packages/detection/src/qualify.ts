import type { NormalizedObservation, Qualifier, Signal } from "./types.ts";

/** Categories whose signals the policy discounts when negated. */
export const NEGATION_SENSITIVE = ["credential", "remote_access", "money"] as const;

function negated(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 80), index)
    .split(/[.!?\n]/).at(-1)?.replace(/[’‘]/g, "'") ?? "";
  // Negating hesitation or delay still asks for disclosure; it is not safety advice.
  if (/\b(?:do not|don't|must not|should not)\s+(?:hesitate|delay|forget|refuse)\b/i.test(prefix))
    return false;
  return /\b(?:never|do not|don't|must not|should not|will not|won't|does not)\s+(?:\w+\s+){0,4}$/i.test(prefix);
}

export function qualify(signals: Signal[], input: NormalizedObservation): Signal[] {
  return signals.map(signal => {
    const span = input.spans[signal.spanIndex];
    if (!span) return signal;
    const at = span.original.indexOf(signal.excerpt);
    const qualifiers: Qualifier[] = [];
    if (at >= 0 && negated(span.original, at)) qualifiers.push("negated");
    return qualifiers.length ? { ...signal, qualifiers } : signal;
  });
}
