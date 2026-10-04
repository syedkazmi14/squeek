// Links this PC to the person's iPhone through Squeek's Supabase backend, so a scam found on one
// device shows up on the other. Both sign in with the same email, which is the same account, so
// there is nothing to copy between them: the PC writes warnings to the account and reads the
// phone's recent ones from it.
//
// Only a short warning leaves this PC, never page text: the kind of warning, which page type it
// was, and at most 280 characters of excerpt with private details removed by `redact`. The module
// talks to Supabase's REST endpoints with an injected `fetch` (Electron's `net.fetch` in the app),
// so it has no dependencies and tests run without a network. It never throws to its callers:
// the PC's own protection must not depend on the phone being reachable.

import type { Assessment } from "../../../../packages/detection/src/index.ts";
import { redact } from "../../../../packages/detection/src/redact.ts";

export interface SyncConfig {
  /** https://<project>.supabase.co */
  url: string;
  /** The public anon key. It is safe to ship: row-level security does the protecting. */
  anonKey: string;
}
export interface SyncStorage {
  load(): Promise<string | undefined>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}
export interface PhoneWarning {
  id: string;
  surface: string;
  /** Redacted excerpt the phone recorded, e.g. "Mike, the grandson · gift cards to pay bail". */
  evidence: string | null;
  createdAt: number;
}
export interface IncidentInput {
  risk: "high_risk" | "caution";
  surface: "browser" | "text";
  ruleIds: string[];
  evidence: string | null;
}
export interface SyncView {
  /** False when this build has no backend configured; the panel hides the whole section. */
  configured: boolean;
  connected: boolean;
  email?: string;
  error?: string;
  /** A likely scam the phone caught in the last half hour. */
  phoneWarning?: { surface: string; evidence: string | null; minutesAgo: number };
}
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
interface Stored {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  userId: string;
  email: string;
  deviceId: string;
}

/** A page or message checked again within this long is the same warning, not a new one. */
export const SAME_WARNING_MS = 10 * 60_000;
/** The phone's warnings count as recent for this long, as on the phone. */
export const PHONE_WARNING_WINDOW_MS = 30 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;
const MAX_EVIDENCE = 280;

/** What to tell the phone about an assessment, or nothing if it isn't a warning. */
export function incidentFor(
  assessment: Assessment,
  surface: IncidentInput["surface"],
): IncidentInput | undefined {
  if (assessment.state !== "high_risk" && assessment.state !== "caution") return undefined;
  const excerpts = assessment.evidence
    .map((item) => redact(item.excerpt).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2);
  const joined = excerpts.join(" · ");
  return {
    risk: assessment.state,
    surface,
    ruleIds: [...new Set(assessment.evidence.map((item) => item.ruleId))].slice(0, 12),
    evidence: joined ? joined.slice(0, MAX_EVIDENCE) : null,
  };
}

export function createSync(
  config: SyncConfig | undefined,
  fetchImpl: FetchLike,
  storage: SyncStorage,
  options: { now?: () => number; deviceName?: string; appVersion?: string; newId?: () => string } = {},
) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  let session: Stored | undefined;
  let lastError: string | undefined;
  let phoneWarning: PhoneWarning | undefined;
  let keepsHistory: { value: boolean; at: number } | undefined;
  const recentlySent = new Map<string, number>();
  const base = config?.url.replace(/\/+$/, "");

  async function request(
    path: string,
    init: RequestInit & { json?: unknown; bearer?: string } = {},
  ): Promise<Response> {
    if (!config || !base) throw Error("Not configured");
    const { json, bearer, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("apikey", config.anonKey);
    headers.set("Authorization", `Bearer ${bearer ?? config.anonKey}`);
    if (json !== undefined) headers.set("Content-Type", "application/json");
    return fetchImpl(`${base}${path}`, {
      ...rest,
      headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  }
  async function persist(): Promise<void> {
    if (session) await storage.save(JSON.stringify(session));
  }
  function adopt(body: unknown, previous?: Stored): Stored {
    const value = body as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      user?: { id?: unknown; email?: unknown };
    };
    if (
      typeof value?.access_token !== "string" ||
      typeof value.refresh_token !== "string" ||
      typeof value.user?.id !== "string"
    )
      throw Error("Unexpected sign-in response");
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: now() + (typeof value.expires_in === "number" ? value.expires_in : 3600) * 1000,
      userId: value.user.id,
      email: typeof value.user.email === "string" ? value.user.email : (previous?.email ?? ""),
      deviceId: previous?.deviceId ?? newId(),
    };
  }
  /** A session with a usable access token, refreshing it when it is about to expire. */
  async function fresh(): Promise<Stored | undefined> {
    if (!session) return undefined;
    if (session.expiresAt - EXPIRY_MARGIN_MS > now()) return session;
    const res = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      json: { refresh_token: session.refreshToken },
    });
    if (!res.ok) {
      // The account no longer accepts this session (signed out elsewhere, deleted).
      if (res.status === 400 || res.status === 401) await signOut();
      throw Error("Session expired");
    }
    session = adopt(await res.json(), session);
    await persist();
    return session;
  }
  async function authed(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response | undefined> {
    const current = await fresh();
    if (!current) return undefined;
    return request(path, { ...init, bearer: current.accessToken });
  }
  function fail(error: unknown): void {
    lastError = error instanceof Error && error.message ? error.message : "Couldn't reach your iPhone's account";
  }

  async function registerDevice(monitoring: string): Promise<void> {
    const current = session;
    if (!current) return;
    const res = await authed("/rest/v1/devices?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      json: {
        id: current.deviceId,
        user_id: current.userId,
        platform: "windows",
        name: options.deviceName ?? "Windows PC",
        app_version: options.appVersion ?? "0.1.0",
        monitoring_status: monitoring.slice(0, 40),
        last_seen_at: new Date(now()).toISOString(),
      },
    });
    if (res && !res.ok) throw Error("Couldn't register this PC");
  }

  async function signIn(email: string, monitoring = "paused"): Promise<void> {
    lastError = undefined;
    try {
      const address = email.trim().toLowerCase();
      const link = await request("/functions/v1/demo-sign-in", { method: "POST", json: { email: address } });
      if (!link.ok) {
        const detail = (await link.json().catch(() => ({}))) as { error?: unknown };
        throw Error(typeof detail.error === "string" ? detail.error : "Couldn't sign in");
      }
      const { tokenHash } = (await link.json()) as { tokenHash?: unknown };
      if (typeof tokenHash !== "string") throw Error("Couldn't sign in");
      const verified = await request("/auth/v1/verify", {
        method: "POST",
        json: { type: "email", token_hash: tokenHash },
      });
      if (!verified.ok) throw Error("Couldn't sign in");
      session = adopt(await verified.json(), session);
      keepsHistory = undefined;
      await persist();
      await registerDevice(monitoring);
    } catch (error) {
      session = undefined;
      await storage.clear().catch(() => {});
      fail(error);
      throw error;
    }
  }
  async function restore(monitoring = "paused"): Promise<void> {
    if (!config) return;
    try {
      const saved = await storage.load();
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<Stored>;
      if (!parsed.refreshToken || !parsed.userId || !parsed.deviceId) return;
      session = { ...(parsed as Stored), accessToken: parsed.accessToken ?? "", expiresAt: parsed.expiresAt ?? 0 };
      await registerDevice(monitoring);
    } catch (error) {
      fail(error);
    }
  }
  async function signOut(): Promise<void> {
    session = undefined;
    phoneWarning = undefined;
    keepsHistory = undefined;
    recentlySent.clear();
    await storage.clear().catch(() => {});
  }

  /** Whether the account keeps a history of warnings. If it doesn't, nothing is sent. */
  async function historyOn(): Promise<boolean> {
    if (keepsHistory && now() - keepsHistory.at < 5 * 60_000) return keepsHistory.value;
    const current = session;
    if (!current) return false;
    const res = await authed(`/rest/v1/profiles?id=eq.${current.userId}&select=history_sync`);
    if (!res?.ok) return keepsHistory?.value ?? false;
    const rows = (await res.json()) as { history_sync?: unknown }[];
    const value = rows[0]?.history_sync !== false;
    keepsHistory = { value, at: now() };
    return value;
  }

  /** Tells the phone about a warning. Quietly does nothing if disconnected or not a warning. */
  async function reportIncident(input: IncidentInput): Promise<void> {
    const current = session;
    if (!current) return;
    try {
      const key = `${input.surface}|${input.risk}|${input.evidence ?? ""}`;
      const seen = recentlySent.get(key);
      if (seen !== undefined && now() - seen < SAME_WARNING_MS) return;
      if (!(await historyOn())) return;
      recentlySent.set(key, now());
      for (const [k, at] of recentlySent) if (now() - at > SAME_WARNING_MS) recentlySent.delete(k);
      const res = await authed("/rest/v1/incidents", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        json: {
          user_id: current.userId,
          device_id: current.deviceId,
          platform: "windows",
          surface: input.surface,
          risk: input.risk,
          categories: [],
          rule_ids: input.ruleIds,
          evidence_redacted: input.evidence,
        },
      });
      if (res && !res.ok) {
        recentlySent.delete(key);
        throw Error("Couldn't send the warning");
      }
      lastError = undefined;
    } catch (error) {
      fail(error);
    }
  }

  async function heartbeat(monitoring: string): Promise<void> {
    try {
      await registerDevice(monitoring);
    } catch (error) {
      fail(error);
    }
  }

  /** The newest likely scam the iPhone recorded in the last half hour, if any. */
  async function checkPhone(): Promise<PhoneWarning | undefined> {
    if (!session) return undefined;
    try {
      const since = new Date(now() - PHONE_WARNING_WINDOW_MS).toISOString();
      const res = await authed(
        `/rest/v1/incidents?select=id,surface,evidence_redacted,created_at&platform=eq.ios&risk=eq.high_risk` +
          `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`,
      );
      if (!res?.ok) throw Error("Couldn't read your iPhone's warnings");
      const rows = (await res.json()) as {
        id: string;
        surface: string;
        evidence_redacted: string | null;
        created_at: string;
      }[];
      const row = rows[0];
      phoneWarning = row
        ? {
            id: row.id,
            surface: row.surface,
            evidence: row.evidence_redacted,
            createdAt: Date.parse(row.created_at),
          }
        : undefined;
      lastError = undefined;
    } catch (error) {
      fail(error);
    }
    return phoneWarning;
  }

  function view(): SyncView {
    const out: SyncView = { configured: !!config, connected: !!session };
    if (session) out.email = session.email;
    if (lastError) out.error = lastError;
    if (phoneWarning && now() - phoneWarning.createdAt < PHONE_WARNING_WINDOW_MS)
      out.phoneWarning = {
        surface: phoneWarning.surface,
        evidence: phoneWarning.evidence,
        minutesAgo: Math.max(1, Math.round((now() - phoneWarning.createdAt) / 60_000)),
      };
    return out;
  }

  return { configured: !!config, signIn, restore, signOut, reportIncident, heartbeat, checkPhone, view };
}
export type Sync = ReturnType<typeof createSync>;
