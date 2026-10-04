// Puts the demo story into two real accounts, so signing in on a phone shows what the Simulator's
// demo mode shows: syed@example.com (the protected person) and aisha@example.com (their trusted
// person), a family group between them, and the sample warnings, screened calls and block list.
// Run it again to reset both accounts to this state. It writes to the project it points at, using
// the service key, so use it on a throwaway project.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-net --allow-env scripts/seed-demo.ts [--check-in open|ok|call_me]
//
// Optional phone numbers (E.164) that Squeek will really call during the demo:
//   SEED_SYED_PHONE=+1... SEED_AISHA_PHONE=+1...
// Without them no alert phone is set, so no calls are placed.

import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  Deno.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const checkInArg = Deno.args[Deno.args.indexOf("--check-in") + 1];
const SAFE_WORD = "blue moon";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function ensureUser(email: string): Promise<string> {
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  if (created.data.user) return created.data.user.id;
  // Already there: find it.
  for (let page = 1; page < 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  throw new Error(`could not create or find ${email}`);
}

async function must<T>(label: string, run: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await run;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as NonNullable<T>;
}

const syed = await ensureUser("syed@example.com");
const aisha = await ensureUser("aisha@example.com");
console.log("accounts ready");

// Start clean: this seed owns both accounts' demo rows.
for (const table of ["screened_calls", "incidents"]) await must(`clear ${table}`, db.from(table).delete().in("user_id", [syed, aisha]));
// Check-ins come from the trusted-person migration; the seed still works on a project without it.
const { error: noCheckIns } = await db.from("check_ins").delete().in("protected_user_id", [syed, aisha]);
const hasCheckIns = !noCheckIns;
await must("clear block numbers", db.from("blocked_numbers").delete().in("owner_user_id", [syed, aisha]));
await must("clear block domains", db.from("blocked_domains").delete().in("owner_user_id", [syed, aisha]));
await must("clear groups", db.from("households").delete().in("created_by", [syed, aisha]));

// Profiles come from a signup trigger.
const phone = (name: string) => Deno.env.get(name) ?? null;
await must("syed profile", db.from("profiles").update({
  display_name: "Syed", history_sync: true, share_incidents_with_helpers: true, alert_phone: phone("SEED_SYED_PHONE"),
}).eq("id", syed));
await must("aisha profile", db.from("profiles").update({
  display_name: "Aisha", history_sync: true, share_incidents_with_helpers: false, alert_phone: phone("SEED_AISHA_PHONE"),
}).eq("id", aisha));

// The family group, with the safe word hashed the way set_safe_word() does it.
const [{ id: household }] = await must("group", db.from("households").insert({ name: "Kazmi family", created_by: syed }).select("id"));
const hashInput = new TextEncoder().encode(`${household}:${SAFE_WORD}`);
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", hashInput))].map((b) => b.toString(16).padStart(2, "0")).join("");
await must("safe word", db.from("households").update({ safe_word_hash: hash }).eq("id", household));
await must("members", db.from("household_members").insert([
  { household_id: household, user_id: syed, role: "protected" },
  { household_id: household, user_id: aisha, role: "helper" },
]));

// Warnings (the same story as the demo mode).
type Seed = { key: string; user: string; platform: "ios" | "windows"; surface: string; risk: string; categories: string[]; rules: string[];
  evidence: string | null; kind?: "phone" | "domain"; value?: string; action?: string; minutes: number };
const incidents: Seed[] = [
  { key: "d0", user: syed, platform: "ios", surface: "call", risk: "high_risk", categories: ["impersonation", "payment", "pressure", "secrecy"],
    rules: ["call_family_no_safe_word", "call_gift_card"], evidence: "Mike, the grandson · gift cards to pay bail", kind: "phone", value: "+15555550188", minutes: 1 },
  { key: "d1", user: syed, platform: "windows", surface: "email", risk: "high_risk", categories: ["impersonation", "payment"], rules: ["gift_card"],
    evidence: "This is the IRS. A warrant for your arrest will be issued today. Pay with Google Play gift cards…", minutes: 2 },
  { key: "d5", user: syed, platform: "ios", surface: "call", risk: "clear", categories: [], rules: [],
    evidence: "Dr. Lee's office · to confirm Tuesday's appointment", kind: "phone", value: "+15555550142", minutes: 60 * 3 },
  { key: "d6", user: syed, platform: "ios", surface: "browser", risk: "high_risk", categories: ["link"], rules: ["link_dangerous"],
    evidence: "secure-bank-login.example", kind: "domain", value: "secure-bank-login.example", minutes: 60 * 4 },
  { key: "d4", user: syed, platform: "ios", surface: "link", risk: "caution", categories: ["link"], rules: ["brand_mismatch"],
    evidence: "paypal-account-verify.example", kind: "domain", value: "paypal-account-verify.example", action: "dismissed", minutes: 60 * 50 },
  { key: "d2", user: syed, platform: "ios", surface: "call", risk: "high_risk", categories: ["reported"], rules: ["user_report"],
    evidence: null, kind: "phone", value: "+15555550100", action: "reported", minutes: 60 * 20 },
  { key: "d3", user: aisha, platform: "ios", surface: "sms", risk: "caution", categories: ["delivery", "link"], rules: ["delivery_problem"],
    evidence: "USPS: Your package could not be delivered. A redelivery fee is required…", kind: "domain", value: "usps-redelivery-fee.example", minutes: 60 * 30 },
];
const ids = new Map<string, string>();
for (const i of incidents) {
  const [row] = await must(`incident ${i.key}`, db.from("incidents").insert({
    user_id: i.user, platform: i.platform, surface: i.surface, risk: i.risk, categories: i.categories, rule_ids: i.rules,
    evidence_redacted: i.evidence, indicator_kind: i.kind ?? null, indicator_value: i.value ?? null, user_action: i.action ?? null,
    created_at: ago(i.minutes),
  }).select("id"));
  ids.set(i.key, row.id);
}

// What the caller told Squeek, for the two call warnings.
await must("screened calls", db.from("screened_calls").insert([
  { user_id: syed, conversation_id: "seed_call_scam", caller_e164: "+15555550188", duration_secs: 74, risk: "high_risk",
    categories: ["impersonation", "payment", "pressure", "secrecy"], caller_claims: "Mike, the grandson",
    caller_wants: "gift cards to pay bail, and for nobody to know", safe_word: "wrong", incident_id: ids.get("d0"), created_at: ago(1) },
  { user_id: syed, conversation_id: "seed_call_clear", caller_e164: "+15555550142", duration_secs: 41, risk: "clear", categories: [],
    caller_claims: "Dr. Lee's office", caller_wants: "to confirm Tuesday's appointment", callback_e164: "+15555550142",
    incident_id: ids.get("d5"), created_at: ago(60 * 3) },
]));

await must("blocked numbers", db.from("blocked_numbers").insert([
  { owner_user_id: syed, e164: "+15555550100", label: "Fake bank call", source: "user", created_by: syed },
  { household_id: household, e164: "+15555550123", source: "household", created_by: aisha },
]));
await must("blocked domains", db.from("blocked_domains").insert({
  owner_user_id: syed, domain: "paypal-account-verify.example", source: "user", created_by: syed,
}));

if ((checkInArg === "open" || checkInArg === "ok" || checkInArg === "call_me") && !hasCheckIns) {
  console.log("skipped the check-in: apply supabase/migrations/20261005000000_trusted_person.sql first");
} else if (checkInArg === "open" || checkInArg === "ok" || checkInArg === "call_me") {
  const answered = checkInArg !== "open";
  await must("check-in", db.from("check_ins").insert({
    household_id: household, protected_user_id: syed, helper_id: aisha, status: checkInArg === "open" ? "asked" : checkInArg,
    created_at: ago(answered ? 15 : 2), answered_at: answered ? ago(10) : null,
  }));
}

console.log("seeded. Sign in on the phone as syed@example.com (the protected person) or aisha@example.com (the trusted person).");
