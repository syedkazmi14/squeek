// The call gate's decision: does what the caller said match the family's secret word, and have
// there been too many wrong tries on this line lately? No Deno APIs, so it's testable.

import { checkSafeWord, type SafeWordResult } from "./calls.ts";

/** Wrong tries on one line in an hour before the gate stops listening. */
export const MAX_WRONG_PER_HOUR = 6;

export interface GateDecision {
  /** True only when the word is right and the line isn't locked. */
  match: boolean;
  locked: boolean;
  result: SafeWordResult;
  /** Whether this try should be counted against the line. */
  countAsWrong: boolean;
}

export async function decideGate(
  word: string | null,
  safeWords: { householdId: string; hash: string }[],
  recentWrong: number,
): Promise<GateDecision> {
  // After too many wrong tries nobody gets in, not even with the right word, until the hour passes.
  if (recentWrong >= MAX_WRONG_PER_HOUR) return { match: false, locked: true, result: "wrong", countAsWrong: false };
  const result = await checkSafeWord(word, safeWords);
  return { match: result === "matched", locked: false, result, countAsWrong: result === "wrong" };
}
