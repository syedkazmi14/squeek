// QR pairing so nobody types a password on the PC. JWT verification is off for this function
// (see supabase/config.toml); each action checks its own credentials.
//
//   PC:     { action: "create" }               -> { code, pollSecret, expiresAt }   (shows code as a QR)
//   iPhone: { action: "claim", code }          -> { ok: true }                      (signed-in user)
//   PC:     { action: "poll", pollSecret }     -> { status: "waiting" | "ready", email?, tokenHash? }
//   PC then calls supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" }).

import { adminClient, requireCaller } from "../_shared/context.ts";
import { HttpError, json, readJson, requireString, serve, sha256Hex } from "../_shared/http.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TTL_MS = 5 * 60_000;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/^SQUEEK-PAIR:/, "").replace(/[^A-Z0-9]/g, "");
}

serve("pair-device", async (req) => {
  const body = await readJson<Record<string, unknown>>(req, 2_000);
  const db = adminClient();

  switch (body.action) {
    case "create": {
      const code = randomCode();
      const pollSecret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
      const { error } = await db.from("pairing_codes").insert({
        code_hash: await sha256Hex(code),
        poll_hash: await sha256Hex(pollSecret),
        expires_at: expiresAt,
      });
      if (error) throw new Error(`pairing create: ${error.message}`);
      return json({ code, qr: `squeek-pair:${code}`, pollSecret, expiresAt });
    }

    case "claim": {
      const caller = await requireCaller(req);
      const code = normalizeCode(requireString(body.code, "code", 64));
      const { data, error } = await db
        .from("pairing_codes")
        .update({ user_id: caller.user.id, claimed_at: new Date().toISOString() })
        .eq("code_hash", await sha256Hex(code))
        .is("claimed_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("code_hash");
      if (error) throw new Error(`pairing claim: ${error.message}`);
      if (!data || data.length === 0) throw new HttpError(404, "that code is wrong or has expired");
      return json({ ok: true });
    }

    case "poll": {
      const secret = requireString(body.pollSecret, "pollSecret", 128);
      const { data: row } = await db
        .from("pairing_codes")
        .select("*")
        .eq("poll_hash", await sha256Hex(secret))
        .maybeSingle();
      if (!row) throw new HttpError(404, "unknown pairing request");
      if (row.consumed_at) throw new HttpError(410, "already used");
      if (!row.claimed_at) {
        if (new Date(row.expires_at) < new Date()) throw new HttpError(410, "expired");
        return json({ status: "waiting" });
      }
      // Mark consumed first so the sign-in token can only be issued once.
      const { data: consumed } = await db
        .from("pairing_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("code_hash", row.code_hash)
        .is("consumed_at", null)
        .select("code_hash");
      if (!consumed || consumed.length === 0) throw new HttpError(410, "already used");

      const { data: userData, error: userError } = await db.auth.admin.getUserById(row.user_id);
      const email = userData?.user?.email;
      if (userError || !email) throw new HttpError(409, "this account has no email address to sign in with");
      const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: "magiclink", email });
      if (linkError || !link?.properties?.hashed_token) throw new Error(`generateLink: ${linkError?.message}`);
      return json({ status: "ready", email, tokenHash: link.properties.hashed_token });
    }

    default:
      throw new HttpError(400, "unknown action");
  }
});
