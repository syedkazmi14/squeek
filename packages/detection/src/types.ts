// Shared detection types. Field names match the JSON returned by the Edge Functions,
// which the iPhone app decodes with the same names (see apps/ios/ClickeyCore).

export type Risk = "no_detected_signal" | "caution" | "high_risk" | "unknown";
export type LinkVerdict = "malicious" | "suspicious" | "no_signal" | "unknown";
export type ReasonSource = "rule" | "ai" | "link" | "blocklist";

export interface RedactionRule {
  id: string;
  pattern: string;
  replacement: string;
}

export interface SignalRule {
  id: string;
  category: string;
  weight: number;
  label: string;
  patterns: string[];
}

export interface MessageTemplate {
  headline: string;
  speech: string;
}

export interface RuleSet {
  version: string;
  redaction: RedactionRule[];
  signals: SignalRule[];
  policy: {
    cautionScore: number;
    highRiskScore: number;
    highRiskCombos: string[][];
    excerptRadius: number;
  };
  links: {
    shorteners: string[];
    suspiciousTlds: string[];
    secondLevelSuffixes: string[];
    lureWords: string[];
    brands: Record<string, string[]>;
    shortBrandMaxLength: number;
  };
  messages: Record<string, MessageTemplate> & { reasons_prefix: string };
}

export interface Reason {
  id: string;
  label: string;
  excerpt?: string;
  source: ReasonSource;
}

export interface SignalMatch {
  id: string;
  category: string;
  weight: number;
  label: string;
  excerpt: string;
}

export interface LocalAssessment {
  risk: Risk;
  score: number;
  categories: string[];
  matches: SignalMatch[];
}

export interface LinkFinding {
  id: string;
  label: string;
  weight: number;
}

export interface LinkAnalysis {
  input: string;
  url: string | null;
  host: string | null;
  domain: string | null;
  score: number;
  verdict: LinkVerdict;
  findings: LinkFinding[];
}
