// POST { text, surface, platform, deviceId? } -> CheckResult
// Checks a message: redaction, shared rules, links in the message, then Jev when configured.
// Clients should redact before sending; the server redacts again and never stores raw text.

import {
  assessLocally,
  decideRisk,
  extractUrls,
  MAX_TEXT_LENGTH,
  messageFor,
  type Reason,
  redact,
  type Risk,
} from "../_shared/detection/src/index.ts";
import {
  addTokens,
  blockedDomainsFor,
  chargeUsage,
  parsePlatform,
  parseSurface,
  profileFlags,
  recordIncident,
  requireCaller,
  rules,
} from "../_shared/context.ts";
import { json, optionalUuid, readJson, requireString, serve } from "../_shared/http.ts";
import { assessWithJev } from "../_shared/jev.ts";
import { checkLink } from "../_shared/linkcheck.ts";
import { type CheckResult, levelForRisk, type LinkSummary } from "../_shared/results.ts";

// Must match LocalChecker.suspiciousLinkWeight in apps/ios/SqueekCore.
const SUSPICIOUS_LINK_WEIGHT = 2;
// Only the first links get network checks, to bound latency and cost.
const NETWORK_LINK_CHECKS = 2;

serve("assess-text", async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson<Record<string, unknown>>(req);
  const text = requireString(body.text, "text", MAX_TEXT_LENGTH);
  const surface = parseSurface(body.surface, "text");
  const platform = parsePlatform(body.platform);
  const deviceId = optionalUuid(body.deviceId);
  await chargeUsage(caller.user.id, "assessment");

  const redacted = redact(text, rules);
  const local = assessLocally(redacted, rules);
  let score = local.score;
  const categories = new Set(local.categories);
  const ruleIds = local.matches.map((m) => m.id);
  const reasons: Reason[] = local.matches.map((m) => ({ id: m.id, label: m.label, excerpt: m.excerpt, match: m.match, source: "rule" }));

  const [blocked, flags] = await Promise.all([blockedDomainsFor(caller), profileFlags(caller)]);

  // Links in the message.
  const outcomes = await Promise.all(
    extractUrls(redacted).map((u, i) => checkLink(u, blocked, i < NETWORK_LINK_CHECKS)),
  );
  const links: LinkSummary[] = [];
  let dangerousDomain: string | null = null;
  for (const o of outcomes) {
    if (!o.url) continue;
    links.push({ url: o.url, domain: o.domain, verdict: o.verdict, reasons: o.reasons });
    if (o.verdict === "malicious") {
      dangerousDomain ??= o.domain;
      const listed = o.reasons.some((r) => r.id === "blocked_domain");
      reasons.push({
        id: listed ? "link_blocked" : "link_dangerous",
        label: listed ? "Contains a link on your block list" : "Contains a link known to be dangerous",
        excerpt: o.domain ?? undefined,
        source: listed ? "blocklist" : "link",
      });
      ruleIds.push(listed ? "link_blocked" : "link_dangerous");
    } else if (o.verdict === "suspicious") {
      score += SUSPICIOUS_LINK_WEIGHT;
      categories.add("link");
      reasons.push({ id: "link_suspicious", label: "Contains a suspicious link", excerpt: o.domain ?? undefined, source: "link" });
      ruleIds.push("link_suspicious");
    }
  }

  // Jev adds signals only for categories the rules didn't already find, so nothing counts twice.
  const jev = await assessWithJev(redacted, surface);
  for (const s of jev.signals) {
    if (categories.has(s.category)) continue;
    score += s.weight;
    categories.add(s.category);
    reasons.push({ id: s.id, label: s.label, source: "ai" });
    ruleIds.push(s.id);
  }
  await addTokens(caller.user.id, jev.tokens);

  const risk: Risk = dangerousDomain ? "high_risk" : decideRisk(rules, score, categories);
  const message = messageFor(rules, risk, reasons);

  let incidentId: string | null = null;
  if (risk === "high_risk" || risk === "caution") {
    incidentId = await recordIncident(caller, flags, {
      platform,
      surface,
      deviceId,
      risk,
      categories: [...categories].sort(),
      ruleIds,
      evidence: reasons.find((r) => r.excerpt)?.excerpt ?? null,
      indicatorKind: dangerousDomain ? "domain" : undefined,
      indicatorValue: dangerousDomain,
    });
  }

  const result: CheckResult = {
    kind: "text",
    level: levelForRisk(risk),
    headline: message.headline,
    speech: message.speech,
    reasons,
    links,
    checks: { ai: jev.status },
    incidentId,
    rulesVersion: rules.version,
    isLocal: false,
  };
  return json(result);
});
