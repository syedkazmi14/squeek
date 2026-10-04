// POST { incidentId }, signed in. Called when someone taps "Continue anyway" on the payment pause
// for a likely scam: phones their helpers once, so they can call before money moves. Only the
// person's own high-risk incident counts, and only if they share warnings with helpers.

import { adminClient, profileFlags, requireCaller } from "../_shared/context.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { escalationText } from "../_shared/trusted.ts";
import { sendAlert } from "../_shared/twilio.ts";

serve("notify-helpers", async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson<{ incidentId?: unknown }>(req);
  const incidentId = typeof body.incidentId === "string" ? body.incidentId : "";
  if (!/^[0-9a-f-]{36}$/i.test(incidentId)) throw new HttpError(400, "incidentId is required");

  // Read as the caller, so row-level security proves the incident is theirs.
  const { data: incident } = await caller.db.from("incidents").select("id, risk, surface")
    .eq("id", incidentId).eq("user_id", caller.user.id).maybeSingle();
  if (!incident) throw new HttpError(404, "no such warning");
  if (incident.risk !== "high_risk") return json({ sent: 0, skipped: "not a likely scam" });
  const flags = await profileFlags(caller);
  if (!flags.share_incidents_with_helpers) return json({ sent: 0, skipped: "not sharing with helpers" });

  const db = adminClient();
  // Claim the incident first: a second tap, or a retry, must not phone anyone twice.
  const { error: claimError } = await db.from("helper_alerts").insert({ incident_id: incidentId });
  if (claimError) {
    if (claimError.code === "23505") return json({ sent: 0, skipped: "already told" });
    throw new Error(`helper_alerts: ${claimError.message}`);
  }

  const { data: mine } = await db.from("household_members").select("household_id").eq("user_id", caller.user.id);
  const householdIds = (mine ?? []).map((m) => m.household_id as string);
  const { data: helpers } = householdIds.length
    ? await db.from("household_members").select("user_id").in("household_id", householdIds)
      .eq("role", "helper").neq("user_id", caller.user.id)
    : { data: [] };
  const helperIds = [...new Set((helpers ?? []).map((h) => h.user_id as string))];
  const { data: phones } = helperIds.length
    ? await db.from("profiles").select("alert_phone").in("id", helperIds).not("alert_phone", "is", null)
    : { data: [] };

  const from = await fromNumber(caller.user.id);
  const text = escalationText(flags.display_name, incident.surface as string);
  let sent = 0;
  if (from) {
    for (const p of phones ?? []) {
      if ((await sendAlert(p.alert_phone as string, from, text)) === "sent") sent++;
    }
  }
  // Nobody was reached (no helper has a phone yet): free the claim so a later try can work.
  if (sent === 0) await db.from("helper_alerts").delete().eq("incident_id", incidentId);
  return json({ sent });
});

/** Squeek's number to call from: the person's own line, or the shared Twilio number. */
async function fromNumber(userId: string): Promise<string | null> {
  const { data } = await adminClient().from("screening_lines").select("e164").eq("user_id", userId).maybeSingle();
  return (data?.e164 as string | undefined) ?? Deno.env.get("TWILIO_PHONE_NUMBER") ?? null;
}
