// POST { personId }, signed in as a helper. Starts a "are you OK?" check-in with someone they look
// out for (the person sees it in Squeek) and phones them too if they have an alert phone, since
// they may not have the app open. Asking again while one is still open does nothing new.

import { adminClient, profileFlags, requireCaller } from "../_shared/context.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { checkInText } from "../_shared/trusted.ts";
import { sendAlert } from "../_shared/twilio.ts";

serve("check-in", async (req) => {
  const caller = await requireCaller(req);
  const body = await readJson<{ personId?: unknown }>(req);
  const personId = typeof body.personId === "string" ? body.personId : "";
  if (!/^[0-9a-f-]{36}$/i.test(personId)) throw new HttpError(400, "personId is required");

  // The database checks the caller is this person's helper.
  const { data, error } = await caller.db.rpc("ask_check_in", { p_person: personId });
  if (error) throw new HttpError(403, "you are not their helper");
  const { id, is_new: isNew } = (data as { id: string; is_new: boolean }[])[0];
  if (!isNew) return json({ id, alerted: false });

  const db = adminClient();
  const { data: person } = await db.from("profiles").select("alert_phone").eq("id", personId).maybeSingle();
  const phone = person?.alert_phone as string | undefined;
  const from = await fromNumber(personId);
  let alerted = false;
  if (phone && from) {
    const helper = await profileFlags(caller);
    alerted = (await sendAlert(phone, from, checkInText(helper.display_name))) === "sent";
  }
  return json({ id, alerted });
});

async function fromNumber(userId: string): Promise<string | null> {
  const { data } = await adminClient().from("screening_lines").select("e164").eq("user_id", userId).maybeSingle();
  return (data?.e164 as string | undefined) ?? Deno.env.get("TWILIO_PHONE_NUMBER") ?? null;
}
