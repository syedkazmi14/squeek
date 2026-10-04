import { NEGATION_SENSITIVE } from "./qualify.ts";
import type { Rationale, RiskState, Signal } from "./types.ts";

export interface Combination {
  id: string;
  state: "suspicious" | "caution";
  /** Every category here must be present. */
  all: string[];
  /** At least one of these must be present, when given. */
  any?: string[];
}

/** Order matters: the first matching entry wins. Add a row to add a category. */
export const combinations: Combination[] = [
  { id: "credential-request", state: "suspicious", all: ["credential"] },
  { id: "remote-access-request", state: "suspicious", all: ["remote_access"] },
  { id: "authority-payment-demand", state: "suspicious", all: ["impersonation", "payment", "money"] },
  { id: "pressured-payment-demand", state: "suspicious", all: ["pressure", "money", "payment"] },
  { id: "romance-money-request", state: "suspicious", all: ["romance", "money"] },
  { id: "corroborated-amount-request", state: "suspicious", all: ["amount", "money"],
    any: ["pressure", "impersonation", "romance", "destination"] },
  { id: "safe-account-demand", state: "suspicious", all: ["safe_account"], any: ["money", "pressure", "impersonation", "payment"] },
  { id: "hardship-loan-request", state: "suspicious", all: ["money_ask", "amount"], any: ["hardship", "pressure", "romance"] },
  { id: "hardship-payment-request", state: "suspicious", all: ["hardship", "payment"], any: ["money", "money_ask", "pressure"] },
  { id: "callback-billing", state: "suspicious", all: ["callback", "billing_bait"], any: ["amount", "pressure"] },
  { id: "prize-fee", state: "suspicious", all: ["prize"], any: ["fee_demand", "payment", "money"] },
  { id: "extortion-payment", state: "suspicious", all: ["extortion"], any: ["payment", "money", "amount"] },
  { id: "investment-pitch", state: "suspicious", all: ["investment"], any: ["romance", "payment", "pressure"] },
  { id: "pressured-money-mention", state: "caution", all: ["money"], any: ["pressure", "payment"] },
  { id: "personal-money-request", state: "caution", all: ["money_ask"], any: ["hardship", "pressure", "romance", "amount"] },
  { id: "callback-billing-mention", state: "caution", all: ["callback", "billing_bait"] },
  { id: "fee-demand", state: "caution", all: ["fee_demand"], any: ["money", "pressure", "amount"] },
  { id: "safe-account-mention", state: "caution", all: ["safe_account"] },
  { id: "directed-amount-request", state: "caution", all: ["money"], any: ["amount", "destination"] },
];

/**
 * A negated signal in a negation-sensitive category cannot support a
 * combination. Other categories keep the legacy behaviour until phase 2.
 */
function counts(signal: Signal): boolean {
  return !(signal.qualifiers.includes("negated") &&
    (NEGATION_SENSITIVE as readonly string[]).includes(signal.category));
}

export function decide(
  signals: Signal[],
  coverage: "partial" | "complete",
): { state: RiskState; rationale: Rationale } {
  const usable = signals.filter(counts);
  const present = new Set(usable.map(s => s.category));
  const has = (id: string) => present.has(id);
  for (const rule of combinations) {
    if (!rule.all.every(has)) continue;
    if (rule.any && !rule.any.some(has)) continue;
    const used = new Set([...rule.all, ...(rule.any ?? [])]);
    return {
      state: rule.state,
      rationale: {
        findings: usable.filter(s => used.has(s.category)),
        combination: rule.id,
        notObserved: coverage === "partial" ? ["content outside the readable region"] : [],
      },
    };
  }
  return {
    state: coverage === "partial" ? "unknown_incomplete" : "no_supported_signal",
    rationale: { findings: [], combination: "none", notObserved: [] },
  };
}
