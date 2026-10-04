// The ElevenLabs agent calls this (a server tool) when a caller says the secret word. It answers
// only true or false, so the word never leaves the database and the agent can't be talked into
// revealing it. If it's true the agent puts the caller through to the person's phone.
//
//   POST ?line=<the Squeek number that was called>   { word }   ->   { match: boolean }
//
// Not a signed-in call: ElevenLabs sends the shared secret in `x-squeek-tool-secret`
// (SQUEEK_TOOL_SECRET, made by scripts/setup-call-screener.ts).

import { adminClient } from "../_shared/context.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { decideGate } from "../_shared/safeword.ts";

const encoder = new TextEncoder();

function sameSecret(given: string | null, expected: string): boolean {
  const a = encoder.encode(given ?? "");
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

serve("verify-safe-word", async (req) => {
  const secret = Deno.env.get("SQUEEK_TOOL_SECRET");
  if (!secret) throw new HttpError(503, "tool secret not set");
  if (!sameSecret(req.headers.get("x-squeek-tool-secret"), secret)) throw new HttpError(401, "not allowed");

  const line = new URL(req.url).searchParams.get("line");
  if (!line || !/^\+[1-9][0-9]{7,14}$/.test(line)) throw new HttpError(400, "line is required");
  const body = await readJson<{ word?: unknown }>(req, 2_000);
  const word = typeof body.word === "string" ? body.word.slice(0, 200) : null;

  const db = adminClient();
  const { data: owner } = await db.from("screening_lines").select("user_id").eq("e164", line).maybeSingle();
  const userId = owner?.user_id as string | undefined;
  if (!userId) return json({ match: false });

  const { data: memberships } = await db.from("household_members").select("household_id").eq("user_id", userId);
  const householdIds = (memberships ?? []).map((m) => m.household_id as string);
  const { data: households } = householdIds.length
    ? await db.from("households").select("id, safe_word_hash").in("id", householdIds).not("safe_word_hash", "is", null)
    : { data: [] };

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: countError } = await db.from("safe_word_attempts").select("id", { count: "exact", head: true })
    .eq("line", line).gte("created_at", since);
  // Without the try counter anyone could guess word after word, so the gate stays shut instead.
  // (A HEAD request that fails can come back with no error object, only a missing count.)
  if (countError || count === null) throw new Error(`safe_word_attempts: ${countError?.message ?? "unavailable"}`);

  const decision = await decideGate(
    word,
    (households ?? []).map((h) => ({ householdId: h.id as string, hash: h.safe_word_hash as string })),
    count ?? 0,
  );
  if (decision.countAsWrong) {
    await db.from("safe_word_attempts").insert({ line });
    // Old tries are of no use; keep the table small.
    await db.from("safe_word_attempts").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  }
  console.log(JSON.stringify({ gate: decision.match ? "open" : decision.locked ? "locked" : decision.result }));
  return json({ match: decision.match });
});
