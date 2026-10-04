// Auth, Supabase clients, rules, quotas and incident writes shared by the functions.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import rulesJson from "./detection/rules.json" with { type: "json" };
import type { RuleSet } from "./detection/src/index.ts";
import { HttpError } from "./http.ts";

export const rules = rulesJson as unknown as RuleSet;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const PLATFORMS = ["windows", "ios"] as const;
export const SURFACES = ["email", "sms", "call", "link", "share", "screenshot", "browser", "text"] as const;
export type Platform = typeof PLATFORMS[number];
export type Surface = typeof SURFACES[number];

let admin: SupabaseClient | null = null;
/** Service-role client. Bypasses RLS, so use it only for tables clients can't touch. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  return admin;
}

export interface Caller {
  user: User;
  /** Client acting as the caller, so RLS applies to its reads and writes. */
  db: SupabaseClient;
}

export async function requireCaller(req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "sign in required");
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "sign in required");
  return { user: data.user, db };
}

export function parsePlatform(value: unknown): Platform {
  return PLATFORMS.includes(value as Platform) ? (value as Platform) : "ios";
}

export function parseSurface(value: unknown, fallback: Surface): Surface {
  return SURFACES.includes(value as Surface) ? (value as Surface) : fallback;
}

const DAILY_ASSESSMENTS = Number(Deno.env.get("SQUEEK_DAILY_ASSESSMENTS") ?? 300);
const DAILY_LINK_CHECKS = Number(Deno.env.get("SQUEEK_DAILY_LINK_CHECKS") ?? 1000);

/** Counts one request against today's quota and rejects it when the limit is reached. */
export async function chargeUsage(userId: string, kind: "assessment" | "link", tokens = 0) {
  const { data, error } = await adminClient().rpc("increment_usage", {
    p_user: userId,
    p_assessments: kind === "assessment" ? 1 : 0,
    p_link_checks: kind === "link" ? 1 : 0,
    p_tokens: tokens,
  });
  if (error) throw new Error(`usage: ${error.message}`);
  if (kind === "assessment" && data.assessments > DAILY_ASSESSMENTS) throw new HttpError(429, "daily check limit reached");
  if (kind === "link" && data.link_checks > DAILY_LINK_CHECKS) throw new HttpError(429, "daily link check limit reached");
}

export async function addTokens(userId: string, tokens: number) {
  if (tokens > 0) {
    await adminClient().rpc("increment_usage", { p_user: userId, p_assessments: 0, p_link_checks: 0, p_tokens: tokens });
  }
}

export interface ProfileFlags {
  history_sync: boolean;
  share_incidents_with_helpers: boolean;
  display_name: string | null;
}

export async function profileFlags(caller: Caller): Promise<ProfileFlags> {
  const { data } = await caller.db
    .from("profiles")
    .select("history_sync, share_incidents_with_helpers, display_name")
    .eq("id", caller.user.id)
    .maybeSingle();
  return data ?? { history_sync: false, share_incidents_with_helpers: false, display_name: null };
}

export async function blockedDomainsFor(caller: Caller): Promise<string[]> {
  const { data, error } = await caller.db.rpc("my_block_list");
  if (error) return [];
  return (data as { kind: string; value: string }[]).filter((r) => r.kind === "domain").map((r) => r.value);
}

export interface IncidentInput {
  platform: Platform;
  surface: Surface;
  deviceId: string | null;
  risk: "caution" | "high_risk" | "unknown";
  categories: string[];
  ruleIds: string[];
  evidence: string | null;
  indicatorKind?: "domain" | "phone";
  indicatorValue?: string | null;
  userAction?: string | null;
}

/** Inserts an incident as the caller (RLS-checked). Returns its id, or null if history sync is off. */
export async function recordIncident(caller: Caller, flags: ProfileFlags, input: IncidentInput): Promise<string | null> {
  if (!flags.history_sync) return null;
  const { data, error } = await caller.db
    .from("incidents")
    .insert({
      user_id: caller.user.id,
      device_id: input.deviceId,
      platform: input.platform,
      surface: input.surface,
      risk: input.risk,
      categories: input.categories,
      rule_ids: input.ruleIds,
      evidence_redacted: input.evidence ? input.evidence.slice(0, 280) : null,
      indicator_kind: input.indicatorKind ?? null,
      indicator_value: input.indicatorValue ?? null,
      user_action: input.userAction ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error(JSON.stringify({ incident_insert_error: error.message }));
    return null;
  }
  return data.id as string;
}
