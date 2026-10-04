// Full link check: offline heuristics, block lists, safe redirect expansion for shortened links,
// and Google Safe Browsing. Network results are cached in link_verdicts for a few hours.

import { analyzeLink, type LinkAnalysis, type LinkVerdict, type Reason } from "./detection/src/index.ts";
import { adminClient, rules } from "./context.ts";
import { sha256Hex } from "./http.ts";

const SAFE_BROWSING_KEY = Deno.env.get("GOOGLE_SAFE_BROWSING_KEY");
const CACHE_HOURS = 6;
const MAX_HOPS = 5;

export type SafeBrowsingStatus = "match" | "no_match" | "unavailable" | "disabled";
export type RedirectStatus = "expanded" | "not_needed" | "failed";

export interface LinkOutcome {
  url: string | null;
  finalUrl: string | null;
  domain: string | null;
  verdict: LinkVerdict;
  reasons: Reason[];
  safeBrowsing: SafeBrowsingStatus;
  redirects: RedirectStatus;
}

interface NetworkFacts {
  finalUrl: string | null;
  safeBrowsing: SafeBrowsingStatus;
  redirects: RedirectStatus;
}

// ---------------------------------------------------------------------------
// SSRF guards: only follow redirects to public hosts on standard ports.
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
    v.startsWith("::ffff:");
}

async function isPublicTarget(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isPrivateIPv4(host);
  if (host.includes(":")) return !isPrivateIPv6(host);
  try {
    const [a, aaaa] = await Promise.all([
      Deno.resolveDns(host, "A").catch(() => [] as string[]),
      Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ]);
    if (a.length === 0 && aaaa.length === 0) return false;
    return a.every((ip) => !isPrivateIPv4(ip)) && aaaa.every((ip) => !isPrivateIPv6(ip));
  } catch {
    return false; // DNS unavailable: don't fetch.
  }
}

/** Follows up to MAX_HOPS redirects without downloading page bodies. */
async function expandRedirects(start: string): Promise<{ finalUrl: string; status: RedirectStatus }> {
  let current = new URL(start);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!(await isPublicTarget(current))) return { finalUrl: current.toString(), status: "failed" };
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "ClickeyLinkCheck/0.1" },
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      return { finalUrl: current.toString(), status: "failed" };
    }
    await res.body?.cancel();
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      return { finalUrl: current.toString(), status: hop === 0 ? "not_needed" : "expanded" };
    }
    try {
      current = new URL(location, current);
    } catch {
      return { finalUrl: current.toString(), status: "failed" };
    }
  }
  return { finalUrl: current.toString(), status: "failed" };
}

async function safeBrowsing(urls: string[]): Promise<SafeBrowsingStatus> {
  if (!SAFE_BROWSING_KEY) return "disabled";
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${SAFE_BROWSING_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "clickey", clientVersion: "0.1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [...new Set(urls)].map((url) => ({ url })),
        },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "unavailable";
    const body = await res.json() as { matches?: unknown[] };
    return body.matches && body.matches.length > 0 ? "match" : "no_match";
  } catch {
    return "unavailable";
  }
}

async function networkFacts(analysis: LinkAnalysis): Promise<NetworkFacts> {
  const url = analysis.url!;
  const key = await sha256Hex(url);
  const db = adminClient();
  const { data: cached } = await db
    .from("link_verdicts")
    .select("result, expires_at")
    .eq("url_hash", key)
    .maybeSingle();
  if (cached && new Date(cached.expires_at) > new Date()) return cached.result as NetworkFacts;

  let finalUrl: string | null = null;
  let redirects: RedirectStatus = "not_needed";
  if (analysis.findings.some((f) => f.id === "shortener")) {
    const expanded = await expandRedirects(url);
    redirects = expanded.status;
    if (expanded.finalUrl !== url) finalUrl = expanded.finalUrl;
  }
  const sb = await safeBrowsing(finalUrl ? [url, finalUrl] : [url]);
  const facts: NetworkFacts = { finalUrl, safeBrowsing: sb, redirects };

  // Don't cache failures, so a later check can succeed.
  if (sb !== "unavailable" && redirects !== "failed") {
    await db.from("link_verdicts").upsert({
      url_hash: key,
      domain: analysis.domain,
      verdict: sb === "match" ? "malicious" : "unknown",
      result: facts,
      checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_HOURS * 3600_000).toISOString(),
    });
  }
  return facts;
}

/** Checks one link. `useNetwork` = false gives offline heuristics plus block lists only. */
export async function checkLink(input: string, blockedDomains: string[], useNetwork = true): Promise<LinkOutcome> {
  const first = analyzeLink(input, rules, blockedDomains);
  if (!first.url) {
    return { url: null, finalUrl: null, domain: null, verdict: "unknown", reasons: [], safeBrowsing: "disabled", redirects: "not_needed" };
  }

  const facts: NetworkFacts = useNetwork
    ? await networkFacts(first)
    : { finalUrl: null, safeBrowsing: "disabled", redirects: "not_needed" };

  const reasons: Reason[] = first.findings.map((f) => ({
    id: f.id,
    label: f.label,
    source: f.id === "blocked_domain" ? "blocklist" : "link",
  }));
  let score = first.score;
  let blocked = first.verdict === "malicious";

  if (facts.finalUrl) {
    const final = analyzeLink(facts.finalUrl, rules, blockedDomains);
    reasons.push({ id: "redirects", label: `Actually goes to ${final.domain ?? "another website"}`, source: "link" });
    for (const f of final.findings) {
      if (!reasons.some((r) => r.id === f.id)) {
        reasons.push({ id: f.id, label: f.label, source: f.id === "blocked_domain" ? "blocklist" : "link" });
      }
    }
    score = Math.max(score, final.score);
    blocked ||= final.verdict === "malicious";
  }
  if (facts.safeBrowsing === "match") {
    reasons.unshift({ id: "safe_browsing", label: "Google Safe Browsing lists this site as dangerous", source: "link" });
  }

  const verdict: LinkVerdict = blocked || facts.safeBrowsing === "match" ? "malicious" : score >= 3 ? "suspicious" : "no_signal";
  return {
    url: first.url,
    finalUrl: facts.finalUrl,
    domain: first.domain,
    verdict,
    reasons,
    safeBrowsing: facts.safeBrowsing,
    redirects: facts.redirects,
  };
}
