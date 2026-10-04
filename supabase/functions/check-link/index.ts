// POST { url, surface?, platform?, deviceId? } -> CheckResult
// Used by the iPhone app, Share extension and Safari extension, and by the PC when a real destination is known.

import { messageFor } from "../_shared/detection/src/index.ts";
import {
  blockedDomainsFor,
  chargeUsage,
  parsePlatform,
  parseSurface,
  profileFlags,
  recordIncident,
  requireCaller,
  rules,
} from "../_shared/context.ts";
import { HttpError, json, optionalUuid, readJson, requireString, serve } from "../_shared/http.ts";
import { checkLink } from "../_shared/linkcheck.ts";
import { type CheckResult, levelForVerdict, riskForVerdict } from "../_shared/results.ts";

serve("check-link", async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson<Record<string, unknown>>(req);
  const url = requireString(body.url, "url", 2048);
  const surface = parseSurface(body.surface, "link");
  const platform = parsePlatform(body.platform);
  const deviceId = optionalUuid(body.deviceId);
  await chargeUsage(caller.user.id, "link");

  const [blocked, flags] = await Promise.all([blockedDomainsFor(caller), profileFlags(caller)]);
  const outcome = await checkLink(url, blocked, true);
  if (!outcome.url) throw new HttpError(400, "that doesn't look like a web link");

  const key = { malicious: "link_malicious", suspicious: "link_suspicious", no_signal: "link_no_signal", unknown: "link_unknown" }[
    outcome.verdict
  ];
  const message = messageFor(rules, key, outcome.reasons);

  let incidentId: string | null = null;
  if (outcome.verdict === "malicious" || outcome.verdict === "suspicious") {
    incidentId = await recordIncident(caller, flags, {
      platform,
      surface,
      deviceId,
      risk: riskForVerdict(outcome.verdict) as "high_risk" | "caution",
      categories: ["link"],
      ruleIds: outcome.reasons.map((r) => r.id),
      evidence: outcome.domain,
      indicatorKind: "domain",
      indicatorValue: outcome.domain,
    });
  }

  const result: CheckResult = {
    kind: "link",
    level: levelForVerdict(outcome.verdict),
    headline: message.headline,
    speech: message.speech,
    reasons: outcome.reasons,
    checks: { safeBrowsing: outcome.safeBrowsing, redirects: outcome.redirects },
    incidentId,
    rulesVersion: rules.version,
    url: outcome.url,
    finalUrl: outcome.finalUrl,
    domain: outcome.domain,
    isLocal: false,
  };
  return json(result);
});
