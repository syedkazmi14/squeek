// POST { text, speed? } -> audio/mpeg, signed in. Speaks a short warning in Squeek's ElevenLabs voice
// for the iPhone, so the ElevenLabs key stays here and never ships in the app. The app falls back to
// the phone's own voice if this is slow or unavailable. The text is a warning sentence the app is
// about to read aloud, already redacted; it is sent to ElevenLabs and not stored here.

import { chargeUsage, requireCaller } from "../_shared/context.ts";
import { corsHeaders, HttpError, readJson, requireString, serve } from "../_shared/http.ts";

const VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "s3TPKV1kjDlVtZbl4Ksh";
const MODEL_ID = Deno.env.get("ELEVENLABS_MODEL_ID") ?? "eleven_flash_v2_5";
const MAX_CHARACTERS = 600;

serve("speak", async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson<{ text?: unknown; speed?: unknown }>(req, 4_000);
  const text = requireString(body.text, "text", MAX_CHARACTERS).trim();
  const speed = Math.min(1.2, Math.max(0.7, typeof body.speed === "number" && Number.isFinite(body.speed) ? body.speed : 1));
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) throw new HttpError(503, "voice unavailable");

  // Spoken warnings count against the same daily allowance as checks, so a stolen sign-in can't run up the bill.
  await chargeUsage(caller.user.id, "assessment");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { speed } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok || !res.body) {
    console.error(JSON.stringify({ elevenlabs_status: res.status }));
    throw new HttpError(502, "voice unavailable");
  }
  return new Response(res.body, {
    headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" },
  });
});
