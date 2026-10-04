// Demo sign-in for the hackathon: type an email on an allowed demo domain and you're signed in to
// that account, created the first time. There's no password, so it's limited to the domains in the
// secret SQUEEK_DEMO_SIGN_IN_DOMAINS (comma-separated, e.g. "squeek.example"), and off when that's
// unset. "*" allows every email, which lets anyone sign in as anyone: only for a throwaway project.
//
//   App: { email } -> { email, tokenHash }, then supabase.auth.verifyOTP(tokenHash, type: email)

import { adminClient } from "../_shared/context.ts";
import { HttpError, json, readJson, requireString, serve } from "../_shared/http.ts";

const DOMAINS = (Deno.env.get("SQUEEK_DEMO_SIGN_IN_DOMAINS") ?? "")
  .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

serve("demo-sign-in", async (req) => {
  if (DOMAINS.length === 0) throw new HttpError(404, "demo sign-in is off");
  const body = await readJson<Record<string, unknown>>(req, 2_000);
  const email = requireString(body.email, "email", 254).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "that doesn't look like an email address");
  const domain = email.split("@")[1];
  if (!DOMAINS.includes("*") && !DOMAINS.includes(domain)) {
    throw new HttpError(403, `demo sign-in only works for ${DOMAINS.map((d) => "@" + d).join(", ")} addresses`);
  }

  const db = adminClient();
  // Creating an account that already exists fails harmlessly; either way the link below works.
  await db.auth.admin.createUser({ email, email_confirm: true });
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.properties?.hashed_token) throw new Error(`generateLink: ${error?.message}`);
  return json({ email, tokenHash: link.properties.hashed_token });
});
