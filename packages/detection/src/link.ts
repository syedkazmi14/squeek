/**
 * Local checks on a hovered link: where it really goes, and whether that
 * address shows the usual signs of a scam. Nothing here touches the network.
 */
export interface LinkAssessment {
  state: "no_detected_signal" | "caution" | "high_risk" | "unknown";
  /** Where the link goes, as a person would read it ("paypal.com"). */
  host: string;
  reasons: { ruleId: string; message: string }[];
}

const STRONG = 3;
const WEAK = 1;

// Real sites for brands scammers copy. A brand's name in any other address is a disguise.
const BRANDS: Record<string, { name: string; domains: string[] }> = {
  paypal: { name: "PayPal", domains: ["paypal.com", "paypal.me"] },
  apple: { name: "Apple", domains: ["apple.com", "icloud.com"] },
  icloud: { name: "iCloud", domains: ["icloud.com", "apple.com"] },
  microsoft: {
    name: "Microsoft",
    domains: ["microsoft.com", "live.com", "office.com", "microsoftonline.com", "outlook.com", "bing.com", "msn.com", "xbox.com"],
  },
  office365: { name: "Microsoft", domains: ["office.com", "microsoft.com"] },
  outlook: { name: "Outlook", domains: ["outlook.com", "live.com", "microsoft.com", "office.com"] },
  amazon: { name: "Amazon", domains: ["amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de", "amazon.in", "amzn.to", "aws.amazon.com"] },
  google: { name: "Google", domains: ["google.com", "youtube.com", "gmail.com", "goo.gl", "g.co"] },
  gmail: { name: "Gmail", domains: ["gmail.com", "google.com"] },
  netflix: { name: "Netflix", domains: ["netflix.com"] },
  facebook: { name: "Facebook", domains: ["facebook.com", "fb.com", "meta.com"] },
  instagram: { name: "Instagram", domains: ["instagram.com"] },
  whatsapp: { name: "WhatsApp", domains: ["whatsapp.com", "wa.me"] },
  chase: { name: "Chase", domains: ["chase.com"] },
  wellsfargo: { name: "Wells Fargo", domains: ["wellsfargo.com"] },
  bankofamerica: { name: "Bank of America", domains: ["bankofamerica.com", "bofa.com"] },
  citibank: { name: "Citibank", domains: ["citi.com", "citibank.com"] },
  irs: { name: "the IRS", domains: ["irs.gov"] },
  usps: { name: "USPS", domains: ["usps.com"] },
  fedex: { name: "FedEx", domains: ["fedex.com"] },
  dhl: { name: "DHL", domains: ["dhl.com"] },
  coinbase: { name: "Coinbase", domains: ["coinbase.com"] },
  binance: { name: "Binance", domains: ["binance.com"] },
  venmo: { name: "Venmo", domains: ["venmo.com"] },
  zelle: { name: "Zelle", domains: ["zellepay.com"] },
  cashapp: { name: "Cash App", domains: ["cash.app"] },
  docusign: { name: "DocuSign", domains: ["docusign.com", "docusign.net"] },
  dropbox: { name: "Dropbox", domains: ["dropbox.com"] },
  linkedin: { name: "LinkedIn", domains: ["linkedin.com", "lnkd.in"] },
  steam: { name: "Steam", domains: ["steampowered.com", "steamcommunity.com"] },
};
const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rb.gy", "ow.ly", "buff.ly",
  "rebrand.ly", "shorturl.at", "tiny.cc", "s.id", "t.ly", "v.gd", "qrco.de",
]);
const RISKY_ENDINGS = new Set([
  "zip", "mov", "top", "xyz", "click", "country", "gq", "tk", "ml", "cf", "ga", "work",
  "support", "rest", "cam", "icu", "buzz", "monster", "sbs", "cfd", "loan", "win", "bid",
]);
const LOGIN_WORDS = [
  "login", "log-in", "signin", "sign-in", "verify", "verification", "secure", "account",
  "update", "wallet", "billing", "confirm", "unlock", "suspended", "recover", "auth",
];
// Second-level labels under which the registrable name is one label further in ("bbc.co.uk").
const SHARED_SUFFIXES = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** "login.paypal.co.uk" -> "paypal.co.uk": the part of a host its owner registered. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const take =
    labels.at(-1)!.length === 2 && SHARED_SUFFIXES.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function belongsTo(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

/** The web address a link's visible text claims to go to, if it shows one. */
function shownDomain(text: string): string | undefined {
  const match = /\b(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i.exec(text);
  return match?.[1]?.toLowerCase().replace(/^www\./, "");
}

export function assessLink(url: string, text = ""): LinkAssessment {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { state: "unknown", host: "", reasons: [] };
  }
  const reasons: (LinkAssessment["reasons"][number] & { weight: number })[] = [];
  const add = (ruleId: string, weight: number, message: string) =>
    reasons.push({ ruleId, weight, message });
  const scheme = parsed.protocol.replace(/:$/, "");

  if (["mailto", "tel", "sms"].includes(scheme))
    return { state: "no_detected_signal", host: parsed.pathname, reasons: [] };
  if (["javascript", "data", "vbscript", "file"].includes(scheme)) {
    add("script_link", STRONG, "It runs something instead of opening a web page");
    return finish(scheme, reasons);
  }
  if (scheme !== "http" && scheme !== "https")
    add("unusual_scheme", WEAK, "It opens something other than a web page");

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const shown = host.replace(/^www\./, "");
  const site = registrableDomain(host);
  const tokens = host.split(/[.-]/);

  if (parsed.username || parsed.password)
    add("hidden_destination", STRONG, "Its address is disguised to hide where it really goes");
  if (isIpAddress(host))
    add("ip_address", STRONG, "It goes to a bare number instead of a website name");
  if (host.split(".").some((label) => label.startsWith("xn--")))
    add("lookalike_letters", STRONG, "Its name uses lookalike letters to copy a real site");

  const claimed = shownDomain(text);
  if (claimed && !isIpAddress(host) && registrableDomain(claimed) !== site)
    add("text_mismatch", STRONG, `It says ${claimed} but really goes to ${shown}`);

  for (const [token, brand] of Object.entries(BRANDS)) {
    if (tokens.includes(token) && !belongsTo(host, brand.domains)) {
      add("brand_impersonation", STRONG, `It pretends to be ${brand.name}, but ${site} isn't ${brand.name}'s site`);
      break;
    }
  }
  if (SHORTENERS.has(site) || SHORTENERS.has(host))
    add("shortened", WEAK, "It's a shortened link that hides where it goes");
  if (RISKY_ENDINGS.has(host.split(".").at(-1) ?? ""))
    add("risky_ending", WEAK, "Its web address ends in a way scammers often use");
  // Only the registered name counts: a real site's own "accounts." subdomain is fine.
  const loginWords = LOGIN_WORDS.filter((word) => site.includes(word));
  if (loginWords.length > 0)
    add("login_lookalike", WEAK, "Its address is dressed up to look like a sign-in page");
  if (scheme === "http" && (loginWords.length > 0 || /log.?in|sign.?in|password|account/i.test(parsed.pathname)))
    add("insecure_login", WEAK, "It asks you to sign in without a secure connection");
  if (host.split(".").length > 5 || host.length > 60)
    add("layered_address", WEAK, "Its address is unusually long and layered");

  return finish(shown, reasons);
}

function finish(
  host: string,
  reasons: (LinkAssessment["reasons"][number] & { weight: number })[],
): LinkAssessment {
  const score = reasons.reduce((sum, reason) => sum + reason.weight, 0);
  reasons.sort((a, b) => b.weight - a.weight);
  return {
    state: score >= STRONG ? "high_risk" : score > 0 ? "caution" : "no_detected_signal",
    host,
    reasons: reasons.map(({ ruleId, message }) => ({ ruleId, message })),
  };
}

/** What Squeek says about a link, in the bubble and aloud. */
export function linkMessage(result: LinkAssessment): string {
  const reason = result.reasons[0]?.message;
  if (result.state === "high_risk")
    return `Careful, this link looks like a scam. ${reason}. Don't open it unless you're sure.`;
  if (result.state === "caution")
    return `Be careful with this link to ${result.host}. ${reason}.`;
  if (result.state === "no_detected_signal")
    return result.host ? `This link goes to ${result.host}. It looks OK.` : "This link looks OK.";
  return "I can't tell where this link goes.";
}
