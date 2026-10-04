// Offline link heuristics. No network access here; Safe Browsing and redirect expansion
// live in the check-link Edge Function. Mirrored in Swift by LinkAnalyzer.swift.

import type { LinkAnalysis, LinkFinding, RuleSet } from "./types.ts";

const URL_IN_TEXT = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"')\]]*)/gi;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function extractUrls(text: string, limit = 5): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const candidate = m[0].replace(/[.,;:!?]+$/, "");
    if (!found.includes(candidate)) found.push(candidate);
    if (found.length >= limit) break;
  }
  return found;
}

export function normalizeUrl(input: string): URL | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

export function registrableDomain(host: string, rules: RuleSet): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (IPV4.test(h) || h.includes(":")) return h;
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const lastTwo = labels.slice(-2).join(".");
  if (rules.links.secondLevelSuffixes.includes(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

export function isBlockedDomain(host: string, blocked: Iterable<string>): boolean {
  const h = host.toLowerCase();
  for (const d of blocked) if (hostMatchesDomain(h, d.toLowerCase())) return true;
  return false;
}

export function analyzeLink(input: string, rules: RuleSet, blockedDomains: Iterable<string> = []): LinkAnalysis {
  const url = normalizeUrl(input);
  if (!url) {
    return { input, url: null, host: null, domain: null, score: 0, verdict: "unknown", findings: [] };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const domain = registrableDomain(host, rules);
  const findings: LinkFinding[] = [];
  const add = (id: string, label: string, weight: number) => findings.push({ id, label, weight });

  if (isBlockedDomain(host, blockedDomains)) {
    add("blocked_domain", "This website is on your Clickey block list", 10);
  }
  if (url.protocol === "http:") add("not_https", "Not a secure (https) link", 1);
  if (IPV4.test(host) || host.includes(":")) add("ip_host", "Goes to a number address instead of a website name", 3);
  if (host.split(".").some((l) => l.startsWith("xn--"))) add("punycode", "Uses look-alike letters in the address", 3);
  if (url.username || url.password || /^[^/]*@/.test(input.replace(/^[a-z]+:\/\//i, ""))) {
    add("at_sign", "Hides the real address behind an @ sign", 3);
  }
  if (rules.links.shorteners.includes(domain)) add("shortener", "Shortened link hides where it goes", 1);
  const tld = domain.split(".").pop() ?? "";
  if (rules.links.suspiciousTlds.includes(tld)) add("suspicious_tld", "Uses an address ending often used by scams", 2);
  if (host.split(".").length >= 5) add("many_subdomains", "Unusually long website address", 1);
  if (input.length > 200) add("long_url", "Very long link", 1);

  const tokens = host.split(/[.-]/).filter(Boolean);
  const officialBrandDomain = Object.values(rules.links.brands).some((domains) =>
    domains.some((d) => hostMatchesDomain(host, d))
  );
  if (!officialBrandDomain) {
    // Sorted so the reported brand is deterministic and matches the Swift implementation.
    for (const brand of Object.keys(rules.links.brands).sort()) {
      const short = brand.length <= rules.links.shortBrandMaxLength;
      const hit = short ? tokens.includes(brand) : tokens.some((t) => t.includes(brand));
      if (hit) {
        add("brand_mismatch", `Uses the name "${brand}" but isn't that company's website`, 3);
        break;
      }
    }
    if (tokens.some((t) => rules.links.lureWords.some((w) => t.includes(w)))) {
      add("lure_words", "Address uses words like \"verify\" or \"login\"", 1);
    }
  }

  const score = findings.reduce((s, f) => s + f.weight, 0);
  const verdict = findings.some((f) => f.id === "blocked_domain")
    ? "malicious"
    : score >= 3
    ? "suspicious"
    : "no_signal";
  return { input, url: url.toString(), host, domain, score, verdict, findings };
}
