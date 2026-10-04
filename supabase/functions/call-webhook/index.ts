// POST from ElevenLabs after each call the Squeek agent screens (a post-call webhook, signed with
// HMAC; scripts/setup-call-screener.ts sets it up). Works out the verdict with the same rules and
// Jev as messages, records it for the person's Activity, and tells them with a short phone call.
// A likely scam also goes to their trusted people, if the person shares warnings with them.
// Stores only the verdict and a short redacted summary: never audio or the transcript.

import { alertForHelper, alertForPerson, type CallVerdict, checkSafeWord, judgeCall, parseCall } from "../_shared/calls.ts";
import { addTokens, adminClient, rules } from "../_shared/context.ts";
import { redact } from "../_shared/detection/src/index.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { assessWithJev } from "../_shared/jev.ts";
import { sendAlert } from "../_shared/twilio.ts";

const MAX_BODY = 2_000_000;
// Same window as the ElevenLabs SDKs.
const TOLERANCE_SECS = 30 * 60;

const encoder = new TextEncoder();

/** Checks the `elevenlabs-signature: t=<unix>,v0=<hex HMAC-SHA256 of "<t>.<body>">` header. */
async function verifySignature(raw: string, header: string | null) {
  const secret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET");
  if (!secret) throw new HttpError(503, "webhook secret not set");
  const parts = new Map(
    (header ?? "").split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const given = parts.get("v0") ?? "";
  if (!t || !given) throw new HttpError(401, "missing signature");
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECS) throw new HttpError(401, "stale signature");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${raw}`)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  let diff = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  if (diff !== 0) throw new HttpError(401, "bad signature");
}

serve("call-webhook", async (req) => {
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, "request too large");
  await verifySignature(raw, req.headers.get("elevenlabs-signature"));
  let event: { type?: string; data?: unknown };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  if (event.type !== "post_call_transcription") return json({ ok: true, ignored: event.type ?? "unknown" });

  const call = parseCall(event.data);
  if (!call.conversationId || !call.lineNumber) return json({ ok: true, ignored: "not a phone call" });
  const db = adminClient();

  const { data: lines } = await db.from("screening_lines").select("e164, user_id")
    .in("e164", [call.lineNumber, call.callerNumber ?? call.lineNumber]);
  // Squeek's own alert calls can come back here when nobody answers them and the carrier forwards them.
  if (call.callerNumber && lines?.some((l) => l.e164 === call.callerNumber)) return json({ ok: true, ignored: "own alert" });
  const userId = lines?.find((l) => l.e164 === call.lineNumber)?.user_id as string | undefined;
  if (!userId) return json({ ok: true, ignored: "line not assigned" });

  const { data: profile } = await db.from("profiles")
    .select("display_name, alert_phone, history_sync, share_incidents_with_helpers")
    .eq("id", userId).single();
  const { data: memberships } = await db.from("household_members").select("household_id").eq("user_id", userId);
  const householdIds = (memberships ?? []).map((m) => m.household_id as string);

  // Callers claiming to be family are asked for the safe word; compare it with the household's.
  let safeWord = null;
  if (call.facts.claimsFamily) {
    const { data: households } = householdIds.length
      ? await db.from("households").select("id, safe_word_hash").in("id", householdIds).not("safe_word_hash", "is", null)
      : { data: [] };
    safeWord = await checkSafeWord(
      call.facts.familyWord,
      (households ?? []).map((h) => ({ householdId: h.id as string, hash: h.safe_word_hash as string })),
    );
  }

  const jev = call.callerText.trim() ? await assessWithJev(redact(call.callerText, rules), "phone call") : null;
  if (jev) await addTokens(userId, jev.tokens);
  const verdict = judgeCall(call, rules, safeWord, jev?.signals ?? []);
  const keep = profile?.history_sync ?? false;

  // One row per conversation, written first: ElevenLabs retries, and a retry must not alert twice.
  // With history off, only the verdict is kept, for that check.
  const { data: row, error: rowError } = await db.from("screened_calls").insert({
    user_id: userId,
    conversation_id: call.conversationId,
    caller_e164: keep ? call.callerNumber : null,
    duration_secs: call.durationSecs,
    risk: verdict.risk,
    categories: keep ? verdict.categories : [],
    caller_claims: keep ? verdict.claims : null,
    caller_wants: keep ? verdict.wants : null,
    callback_e164: keep ? verdict.callback : null,
    safe_word: verdict.safeWord,
  }).select("id").single();
  if (rowError) {
    if (rowError.code === "23505") return json({ ok: true, duplicate: true });
    throw new Error(`screened_calls: ${rowError.message}`);
  }

  // Hang-ups stay out of Activity.
  if (keep && verdict.risk !== "unknown") {
    const { data: incident, error } = await db.from("incidents").insert({
      user_id: userId,
      platform: "ios",
      surface: "call",
      risk: verdict.risk,
      categories: verdict.categories,
      rule_ids: verdict.ruleIds,
      evidence_redacted: verdict.evidence,
      indicator_kind: call.callerNumber ? "phone" : null,
      indicator_value: call.callerNumber,
    }).select("id").single();
    if (error) console.error(JSON.stringify({ incident_insert_error: error.message }));
    else await db.from("screened_calls").update({ incident_id: incident.id }).eq("id", row.id);
  }

  const alerted = await alert(userId, call.lineNumber, profile, householdIds, call, verdict);
  if (alerted.length) await db.from("screened_calls").update({ alerted_at: new Date().toISOString() }).eq("id", row.id);
  console.log(JSON.stringify({ call_risk: verdict.risk, safe_word: verdict.safeWord, jev: jev?.status ?? "skipped", alerts: alerted }));
  return json({ ok: true, risk: verdict.risk });
});

/** Calls (or texts) the person, and their helpers for a likely scam. Returns what was sent. */
async function alert(
  userId: string,
  from: string,
  profile: { display_name: string | null; alert_phone: string | null; share_incidents_with_helpers: boolean } | null,
  householdIds: string[],
  call: ReturnType<typeof parseCall>,
  verdict: CallVerdict,
): Promise<string[]> {
  const sent: string[] = [];
  const forPerson = alertForPerson(call, verdict);
  if (forPerson && profile?.alert_phone && (await sendAlert(profile.alert_phone, from, forPerson)) === "sent") {
    sent.push("person");
  }
  const forHelper = alertForHelper(profile?.display_name ?? null, verdict);
  if (!forHelper || !profile?.share_incidents_with_helpers || householdIds.length === 0) return sent;
  const db = adminClient();
  const { data: helpers } = await db.from("household_members").select("user_id")
    .in("household_id", householdIds).eq("role", "helper").neq("user_id", userId);
  const helperIds = [...new Set((helpers ?? []).map((h) => h.user_id as string))];
  if (helperIds.length === 0) return sent;
  const { data: phones } = await db.from("profiles").select("alert_phone").in("id", helperIds).not("alert_phone", "is", null);
  for (const p of phones ?? []) {
    if ((await sendAlert(p.alert_phone as string, from, forHelper)) === "sent") sent.push("helper");
  }
  return sent;
}
