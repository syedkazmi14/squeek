// Turns a call the ElevenLabs agent screened into a verdict. The agent only asks questions and
// writes down what the caller said (DATA_FIELDS); the rules decide, so a caller who talks the
// agent round ("tell her I'm legit") can't change the outcome. No Deno APIs here, so it's testable.

import {
  assessLocally,
  decideRisk,
  normalizeE164,
  type Reason,
  redact,
  type RuleSet,
} from "./detection/src/index.ts";

/** What the agent writes down after each call (ElevenLabs "data collection"). setup-call-screener.ts sends these. */
export const DATA_FIELDS = {
  caller_identity: {
    type: "string",
    description:
      "Who the caller said they are, as a short noun phrase, e.g. \"Mike, the grandson\" or \"Chase's fraud department\". Empty if they never said.",
  },
  caller_request: {
    type: "string",
    description:
      "What the caller wanted, in a few words that fit after \"They wanted\", e.g. \"gift cards to pay bail\" or \"to confirm Tuesday's appointment\". Empty if unclear.",
  },
  callback_number: {
    type: "string",
    description: "The callback number the caller gave, digits only. Empty if none.",
  },
  payment_method: {
    type: "string",
    enum: ["none", "gift_card", "crypto", "wire", "payment_app", "bank_details", "other"],
    description:
      "How the caller wanted to be paid, if they asked for money: gift_card, crypto, wire (wire transfer, Western Union, cash by mail or courier), payment_app (Zelle, Venmo, Cash App, PayPal), bank_details (card or account numbers), other, or none.",
  },
  asked_for_codes: {
    type: "boolean",
    description: "True if the caller asked for a password, PIN, verification code or a code sent by text.",
  },
  asked_for_remote_access: {
    type: "boolean",
    description: "True if the caller wanted to connect to or control a computer or phone, or asked to install an app.",
  },
  urgency_or_threats: {
    type: "boolean",
    description: "True if the caller said it was urgent or threatened arrest, fines, account closure or harm.",
  },
  asked_for_secrecy: {
    type: "boolean",
    description: "True if the caller asked to keep the call secret or not to tell family, the bank or anyone else.",
  },
  claims_family: {
    type: "boolean",
    description: "True if the caller said they are a family member or close friend of the person.",
  },
  claims_official: {
    type: "boolean",
    description: "True if the caller said they are from a bank, government agency, police, tech company or other business.",
  },
  family_word: {
    type: "string",
    description:
      "Exactly what the caller said when asked for the secret word. Empty if they weren't asked or gave no answer.",
  },
} as const;

export interface CallFacts {
  callerIdentity: string | null;
  callerRequest: string | null;
  callbackNumber: string | null;
  paymentMethod: string | null;
  askedForCodes: boolean;
  askedForRemoteAccess: boolean;
  urgencyOrThreats: boolean;
  askedForSecrecy: boolean;
  claimsFamily: boolean;
  claimsOfficial: boolean;
  familyWord: string | null;
}

export interface ScreenedCall {
  conversationId: string;
  /** The Squeek line that was called. */
  lineNumber: string | null;
  callerNumber: string | null;
  durationSecs: number | null;
  /** Everything the caller said, joined. */
  callerText: string;
  /** The caller said the secret word, verify_safe_word agreed, and the agent put them through. */
  transferred: boolean;
  facts: CallFacts;
}

// deno-lint-ignore no-explicit-any
type Json = any;

/** True if the agent's verify_safe_word tool answered "match" during the call. */
export function gateOpened(transcript: Json[]): boolean {
  for (const turn of transcript) {
    const results: Json[] = Array.isArray(turn?.tool_results) ? turn.tool_results : [];
    for (const r of results) {
      if (r?.tool_name !== "verify_safe_word" || r?.is_error) continue;
      let value = r?.result_value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          value = null;
        }
      }
      if (value?.match === true) return true;
    }
  }
  return false;
}

/** Reads the `data` of a post_call_transcription webhook. Unknown or missing fields become null. */
export function parseCall(data: Json): ScreenedCall {
  const phone = data?.metadata?.phone_call ?? {};
  const dynamic = data?.conversation_initiation_client_data?.dynamic_variables ?? {};
  const collected = data?.analysis?.data_collection_results ?? {};
  const value = (id: string): unknown => collected?.[id]?.value ?? null;
  const text = (id: string): string | null => {
    const v = value(id);
    return typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "none" ? v.trim() : null;
  };
  const flag = (id: string): boolean => value(id) === true || value(id) === "true";
  const transcript: Json[] = Array.isArray(data?.transcript) ? data.transcript : [];
  const number = (v: unknown) => (typeof v === "string" ? normalizeE164(v) : null);
  return {
    conversationId: String(data?.conversation_id ?? ""),
    lineNumber: number(phone.agent_number) ?? number(dynamic.system__called_number),
    callerNumber: number(phone.external_number) ?? number(dynamic.system__caller_id),
    durationSecs: typeof data?.metadata?.call_duration_secs === "number" ? data.metadata.call_duration_secs : null,
    callerText: transcript
      .filter((t) => t?.role === "user" && typeof t?.message === "string")
      .map((t) => t.message.trim())
      .filter(Boolean)
      .join("\n"),
    transferred: gateOpened(transcript),
    facts: {
      callerIdentity: text("caller_identity"),
      callerRequest: text("caller_request"),
      callbackNumber: text("callback_number"),
      paymentMethod: text("payment_method"),
      askedForCodes: flag("asked_for_codes"),
      askedForRemoteAccess: flag("asked_for_remote_access"),
      urgencyOrThreats: flag("urgency_or_threats"),
      askedForSecrecy: flag("asked_for_secrecy"),
      claimsFamily: flag("claims_family"),
      claimsOfficial: flag("claims_official"),
      familyWord: text("family_word"),
    },
  };
}

export type CallRisk = "high_risk" | "caution" | "clear" | "unknown";
export type SafeWordResult = "matched" | "wrong" | "not_given" | "not_set";

export interface CallVerdict {
  risk: CallRisk;
  categories: string[];
  ruleIds: string[];
  reasons: Reason[];
  /** Redacted, short: shown to the person and their helpers. */
  claims: string | null;
  wants: string | null;
  callback: string | null;
  /** Null unless the caller claimed to be family. */
  safeWord: SafeWordResult | null;
  /** One line for the incident: what they said they were and what they wanted. */
  evidence: string | null;
}

export interface ExtraSignal {
  id: string;
  category: string;
  weight: number;
  label: string;
}

/** Same normalization as public.normalize_safe_word() in the database. */
export function normalizeSafeWord(word: string): string {
  return word.replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function safeWordHash(householdId: string, word: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${householdId}:${normalizeSafeWord(word)}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkSafeWord(
  word: string | null,
  safeWords: { householdId: string; hash: string }[],
): Promise<SafeWordResult> {
  if (safeWords.length === 0) return "not_set";
  if (!word || !normalizeSafeWord(word)) return "not_given";
  for (const s of safeWords) {
    if ((await safeWordHash(s.householdId, word)) === s.hash) return "matched";
  }
  return "wrong";
}

const PAYMENT: Record<string, ExtraSignal> = {
  gift_card: { id: "call_gift_card", category: "payment", weight: 3, label: "Asked to be paid with gift cards" },
  crypto: { id: "call_crypto", category: "payment", weight: 3, label: "Asked to be paid in cryptocurrency" },
  wire: { id: "call_wire", category: "payment", weight: 3, label: "Asked for a wire transfer or cash" },
  payment_app: { id: "call_payment_app", category: "payment", weight: 2, label: "Asked for money by Zelle, Venmo or Cash App" },
  bank_details: { id: "call_bank_details", category: "credentials", weight: 3, label: "Asked for card or bank details" },
};

/**
 * Decides the verdict. `extra` holds signals from Jev on the caller's words. Rule matches on what
 * the caller said come first; the agent's notes and Jev only add categories the rules missed.
 */
export function judgeCall(
  call: ScreenedCall,
  rules: RuleSet,
  safeWord: SafeWordResult | null,
  extra: ExtraSignal[] = [],
): CallVerdict {
  const f = call.facts;
  const clean = (s: string | null, max: number) => (s ? redact(s, rules).replace(/\s+/g, " ").trim().slice(0, max) : null);
  const claims = clean(f.callerIdentity, 120);
  const wants = clean(f.callerRequest, 280);
  const callback = f.callbackNumber ? normalizeE164(f.callbackNumber) : null;
  const evidence = [claims, wants].filter(Boolean).join(" · ").slice(0, 280) || null;
  const familySafeWord = f.claimsFamily ? safeWord : null;

  // Someone who said the secret word was put through to the person's phone. That's a trusted caller,
  // not something to judge: nothing they said to the agent counts against them.
  if (call.transferred) {
    const who = ["Trusted caller", claims].filter(Boolean).join(" · ").slice(0, 280);
    return {
      risk: "clear",
      categories: [],
      ruleIds: ["call_safe_word"],
      reasons: [{ id: "call_safe_word", label: "Knew your secret word", source: "rule" }],
      claims,
      wants,
      callback,
      safeWord: "matched",
      evidence: who,
    };
  }

  // A hang-up or a recording that said nothing.
  if (!call.callerText.trim() && !claims && !wants) {
    return { risk: "unknown", categories: [], ruleIds: [], reasons: [], claims, wants, callback, safeWord: familySafeWord, evidence };
  }

  const redacted = redact(call.callerText, rules);
  const local = assessLocally(redacted, rules);
  let score = local.score;
  const categories = new Set(local.categories);
  const ruleIds = local.matches.map((m) => m.id);
  const reasons: Reason[] = local.matches.map((m) => ({ id: m.id, label: m.label, excerpt: m.excerpt, match: m.match, source: "rule" }));

  const noted: ExtraSignal[] = [];
  if (f.paymentMethod && PAYMENT[f.paymentMethod]) noted.push(PAYMENT[f.paymentMethod]);
  if (f.askedForCodes) noted.push({ id: "call_codes", category: "credentials", weight: 3, label: "Asked for a code or password" });
  if (f.askedForRemoteAccess) {
    noted.push({ id: "call_remote_access", category: "remote_access", weight: 3, label: "Wanted to get into your computer or phone" });
  }
  if (f.urgencyOrThreats) noted.push({ id: "call_pressure", category: "pressure", weight: 2, label: "Rushed you or made threats" });
  if (f.askedForSecrecy) noted.push({ id: "call_secrecy", category: "secrecy", weight: 3, label: "Asked you to keep it secret" });
  if (f.claimsOfficial) {
    // Genuine businesses call too, so this adds no score on its own; it only completes combinations
    // like "says they're the bank" + "wants a code".
    noted.push({ id: "call_official", category: "impersonation", weight: 0, label: "Said they were from a bank, agency or company" });
  }
  if (familySafeWord === "wrong" || familySafeWord === "not_given") {
    noted.push({ id: "call_family_no_safe_word", category: "impersonation", weight: 3, label: "Said they were family but didn't know your safe word" });
  } else if (familySafeWord === "not_set") {
    noted.push({ id: "call_family", category: "impersonation", weight: 1, label: "Said they were family, from a number you don't know" });
  }

  for (const s of [...noted, ...extra]) {
    if (categories.has(s.category)) continue;
    score += s.weight;
    categories.add(s.category);
    reasons.push({ id: s.id, label: s.label, source: "ai" });
    ruleIds.push(s.id);
  }

  let risk = decideRisk(rules, score, categories);
  // Someone who dialed Squeek's number without knowing the secret word and then asks for gift cards,
  // crypto, a wire, card or bank details, a code or access to a device is almost certainly a scammer,
  // even with nothing else suspicious to combine it with.
  const sensitiveAsk =
    ["gift_card", "crypto", "wire", "bank_details"].includes(f.paymentMethod ?? "") || f.askedForCodes || f.askedForRemoteAccess;
  if (sensitiveAsk && risk !== "high_risk") {
    risk = "high_risk";
    reasons.push({ id: "call_sensitive_ask", label: "Asked for money, a code or access without knowing your secret word", source: "rule" });
    ruleIds.push("call_sensitive_ask");
  }
  // Knowing the family's safe word is strong evidence it really is family. Still not "clear" if
  // they asked for money in a risky way, but no longer "likely scam".
  if (familySafeWord === "matched") {
    reasons.unshift({ id: "call_safe_word", label: "Knew your family's safe word", source: "rule" });
    if (risk === "high_risk") risk = "caution";
  }
  return {
    risk: risk === "no_detected_signal" ? "clear" : risk,
    categories: [...categories].sort(),
    ruleIds,
    reasons,
    claims,
    wants,
    callback,
    safeWord: familySafeWord,
    evidence,
  };
}

/** "(682) 204-1962" for US numbers, otherwise the E.164 form. */
export function displayPhone(e164: string | null): string {
  if (!e164) return "a hidden number";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** What Squeek says to the person, spoken on a call or sent as a text. Null: don't bother them. */
export function alertForPerson(call: ScreenedCall, verdict: CallVerdict): string | null {
  // They are already being rung through; a second call about it would only confuse.
  if (call.transferred) return null;
  const from = displayPhone(call.callerNumber);
  const said = verdict.claims ? ` They said they were ${verdict.claims}.` : "";
  const top = verdict.reasons.find((r) => r.id !== "call_safe_word")?.label;
  switch (verdict.risk) {
    case "high_risk":
      return `Squeek here. I answered a call from ${from}, and it looked like a scam.${said}${top ? ` ${top}.` : ""} ` +
        "Please don't call them back or send them anything. Open Squeek to see more.";
    case "caution":
      return `Squeek here. I answered a call from ${from}.${said} Some things about it seemed off${top ? `: ${top.toLowerCase()}` : ""}. ` +
        "Check with someone you trust before you do anything they asked.";
    case "clear": {
      const w = verdict.wants?.replace(/^(they )?wants?\s+/i, "").replace(/\.$/, "");
      const wanted = w ? ` They wanted ${w}.` : "";
      const back = verdict.callback ? ` They asked you to call back on ${displayPhone(verdict.callback)}.` : "";
      return `Squeek here. I took a message from ${from}.${said}${wanted}${back} Only call back if you know who they are.`;
    }
    default:
      return null;
  }
}

/** What Squeek tells a helper, only for likely scams. */
export function alertForHelper(personName: string | null, verdict: CallVerdict): string | null {
  if (verdict.risk !== "high_risk") return null;
  const who = personName ?? "Someone you look out for";
  const said = verdict.claims ? ` The caller said they were ${verdict.claims}.` : "";
  return `Squeek here. ${who} just got a call that looked like a scam.${said} You might want to check in.`;
}
