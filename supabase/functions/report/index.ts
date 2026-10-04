// POST { kind: "phone" | "domain", value, label?, householdId?, deviceId?, platform? }
// Records a community report and adds the value to the caller's own (or household's) block list right away.

import { analyzeLink, normalizeE164 } from "../_shared/detection/src/index.ts";
import { parsePlatform, profileFlags, recordIncident, requireCaller, rules } from "../_shared/context.ts";
import { HttpError, json, optionalUuid, readJson, requireString, serve } from "../_shared/http.ts";

serve("report", async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson<Record<string, unknown>>(req);
  const kind = body.kind === "phone" || body.kind === "domain" ? body.kind : null;
  if (!kind) throw new HttpError(400, "kind must be phone or domain");
  const raw = requireString(body.value, "value", 2048);
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : null;
  const householdId = optionalUuid(body.householdId);
  const deviceId = optionalUuid(body.deviceId);
  const platform = parsePlatform(body.platform);

  let value: string | null;
  if (kind === "phone") {
    value = normalizeE164(raw);
    if (!value) throw new HttpError(400, "that doesn't look like a phone number");
  } else {
    const analysis = analyzeLink(raw, rules);
    value = analysis.domain;
    if (!value || !value.includes(".")) throw new HttpError(400, "that doesn't look like a website");
  }

  const uid = caller.user.id;
  const { error: reportError } = await caller.db
    .from("reports")
    .upsert({ reporter_id: uid, kind, value }, { onConflict: "reporter_id,kind,value", ignoreDuplicates: true });
  if (reportError) throw new Error(`report: ${reportError.message}`);

  const table = kind === "phone" ? "blocked_numbers" : "blocked_domains";
  const row = {
    owner_user_id: householdId ? null : uid,
    household_id: householdId,
    [kind === "phone" ? "e164" : "domain"]: value,
    label,
    source: householdId ? "household" : "user",
    created_by: uid,
  };
  const { error: blockError } = await caller.db.from(table).insert(row);
  // 23505 = already on the list, which is fine.
  if (blockError && blockError.code !== "23505") {
    throw new HttpError(blockError.code === "42501" ? 403 : 400, "couldn't add to the block list");
  }

  const flags = await profileFlags(caller);
  const incidentId = await recordIncident(caller, flags, {
    platform,
    surface: kind === "phone" ? "call" : "link",
    deviceId,
    risk: "high_risk",
    categories: ["reported"],
    ruleIds: ["user_report"],
    evidence: null,
    indicatorKind: kind,
    indicatorValue: value,
    userAction: "reported",
  });

  return json({ kind, value, incidentId });
});
