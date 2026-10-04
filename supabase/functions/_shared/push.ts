// Optional APNs alerts to family helpers' iPhones. Does nothing unless the APNS_* secrets are set.
// Development builds use the sandbox host; set APNS_HOST=api.push.apple.com for TestFlight/App Store builds.

import { adminClient } from "./context.ts";

const KEY_P8 = Deno.env.get("APNS_KEY_P8");
const KEY_ID = Deno.env.get("APNS_KEY_ID");
const TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID");
const HOST = Deno.env.get("APNS_HOST") ?? "api.sandbox.push.apple.com";

let cachedJwt: { token: string; issuedAt: number } | null = null;

function base64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function providerToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 40 * 60) return cachedJwt.token;
  const pem = KEY_P8!.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: TEAM_ID, iat: now }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  const token = `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
  cachedJwt = { token, issuedAt: now };
  return token;
}

/** Sends an alert to every helper in households where `ownerId` is a protected member. */
export async function notifyHelpers(ownerId: string, title: string, body: string, incidentId: string | null) {
  if (!KEY_P8 || !KEY_ID || !TEAM_ID || !BUNDLE_ID) return;
  const db = adminClient();
  const { data: memberships } = await db
    .from("household_members")
    .select("household_id")
    .eq("user_id", ownerId)
    .eq("role", "protected");
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (householdIds.length === 0) return;
  const { data: helpers } = await db
    .from("household_members")
    .select("user_id")
    .in("household_id", householdIds)
    .eq("role", "helper")
    .neq("user_id", ownerId);
  const helperIds = [...new Set((helpers ?? []).map((h) => h.user_id))];
  if (helperIds.length === 0) return;
  const { data: devices } = await db
    .from("devices")
    .select("id, apns_token")
    .in("user_id", helperIds)
    .eq("platform", "ios")
    .not("apns_token", "is", null);

  const jwt = await providerToken();
  await Promise.all((devices ?? []).map(async (d) => {
    try {
      const res = await fetch(`https://${HOST}/3/device/${d.apns_token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": BUNDLE_ID,
          "apns-push-type": "alert",
          "apns-priority": "10",
        },
        body: JSON.stringify({ aps: { alert: { title, body }, sound: "default" }, incidentId }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 410 || res.status === 400) {
        await db.from("devices").update({ apns_token: null }).eq("id", d.id);
      }
      await res.body?.cancel();
    } catch (err) {
      console.error(JSON.stringify({ apns_error: String(err).slice(0, 120) }));
    }
  }));
}
