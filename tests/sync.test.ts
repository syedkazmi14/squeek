import assert from "node:assert/strict";
import { test } from "node:test";
import { createSync, incidentFor, SAME_WARNING_MS, type SyncStorage } from "../apps/desktop/src/main/sync.ts";
import type { Assessment } from "../packages/detection/src/index.ts";

const config = { url: "https://example.supabase.co", anonKey: "anon-key" };
const source = { processId: 1, windowHandle: "0x1", processStartedAt: 1 };
function assessment(state: Assessment["state"], excerpts: string[]): Assessment {
  return {
    state, source, revision: 1, coverage: "complete", providerHealth: "local_only", assessedAt: 0,
    evidence: excerpts.map((excerpt, spanIndex) => ({ ruleId: `rule-${spanIndex}`, spanIndex, excerpt })),
  };
}
function memory(initial?: string): SyncStorage & { value: string | undefined } {
  const store = {
    value: initial,
    async load() { return store.value; },
    async save(v: string) { store.value = v; },
    async clear() { store.value = undefined; },
  };
  return store;
}
interface Call { url: string; method: string; headers: Headers; body: unknown }
/** A fake Supabase: records calls, answers the few endpoints the module uses. */
function backend(overrides: Record<string, (call: Call) => Response> = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const handlers: Record<string, (call: Call) => Response> = {
    "POST /functions/v1/demo-sign-in": () => json({ email: "syed@example.com", tokenHash: "hash-1" }),
    "POST /auth/v1/verify": () => json({ access_token: `a${++tokens}`, refresh_token: `r${tokens}`, expires_in: 3600, user: { id: "u1", email: "syed@example.com" } }),
    "POST /auth/v1/token": () => json({ access_token: `a${++tokens}`, refresh_token: `r${tokens}`, expires_in: 3600, user: { id: "u1", email: "syed@example.com" } }),
    "POST /rest/v1/devices": () => new Response(null, { status: 201 }),
    "GET /rest/v1/profiles": () => json([{ history_sync: true }]),
    "POST /rest/v1/incidents": () => new Response(null, { status: 201 }),
    "GET /rest/v1/incidents": () => json([]),
    ...overrides,
  };
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const call: Call = {
      url: input, method: init?.method ?? "GET", headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = handlers[`${call.method} ${url.pathname}`];
    return handler ? handler(call) : new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl, json };
}
const to = (calls: Call[], method: string, path: string) => calls.filter((c) => c.method === method && new URL(c.url).pathname === path);

test("only warnings become incidents, and excerpts are redacted and capped", () => {
  assert.equal(incidentFor(assessment("no_detected_signal", []), "browser"), undefined);
  assert.equal(incidentFor(assessment("unknown", []), "browser"), undefined);
  const long = "x".repeat(400);
  const made = incidentFor(assessment("high_risk", ["Call 555 123 4567 or write help@scam.example", long]), "browser")!;
  assert.equal(made.risk, "high_risk");
  assert.equal(made.surface, "browser");
  assert.ok(!/4567|help@scam/.test(made.evidence!), "private details are removed");
  assert.ok(made.evidence!.length <= 280);
  assert.deepEqual(made.ruleIds, ["rule-0", "rule-1"]);
  assert.equal(incidentFor(assessment("caution", ["Verify your account today"]), "text")!.risk, "caution");
});

test("signing in with an email uses the demo sign-in, then registers this PC", async () => {
  const fake = backend();
  const store = memory();
  const sync = createSync(config, fake.fetchImpl, store, { newId: () => "device-1", deviceName: "Syed's PC" });
  await sync.signIn("  Syed@Example.com ");
  assert.deepEqual(to(fake.calls, "POST", "/functions/v1/demo-sign-in")[0]!.body, { email: "syed@example.com" });
  assert.deepEqual(to(fake.calls, "POST", "/auth/v1/verify")[0]!.body, { type: "email", token_hash: "hash-1" });
  const device = to(fake.calls, "POST", "/rest/v1/devices")[0]!;
  assert.deepEqual(
    { ...(device.body as object), last_seen_at: undefined },
    { id: "device-1", user_id: "u1", platform: "windows", name: "Syed's PC", app_version: "0.1.0", monitoring_status: "paused", last_seen_at: undefined },
  );
  assert.equal(device.headers.get("Authorization"), "Bearer a1");
  assert.equal(device.headers.get("apikey"), "anon-key");
  assert.deepEqual(sync.view(), { configured: true, connected: true, email: "syed@example.com" });
  assert.ok(store.value, "the session is saved");
});

test("a failed sign-in leaves nothing behind and says why", async () => {
  const fake = backend({
    "POST /functions/v1/demo-sign-in": () => new Response(JSON.stringify({ error: "demo sign-in is off" }), { status: 404 }),
  });
  const store = memory();
  const sync = createSync(config, fake.fetchImpl, store);
  await assert.rejects(sync.signIn("a@b.co"), /demo sign-in is off/);
  assert.equal(sync.view().connected, false);
  assert.equal(sync.view().error, "demo sign-in is off");
  assert.equal(store.value, undefined);
});

test("a saved session is restored, and an expired access token is refreshed", async () => {
  const saved = JSON.stringify({ accessToken: "old", refreshToken: "r0", expiresAt: 0, userId: "u1", email: "syed@example.com", deviceId: "device-1" });
  const fake = backend();
  const sync = createSync(config, fake.fetchImpl, memory(saved), { now: () => 1_000_000 });
  await sync.restore("monitoring");
  assert.equal(sync.view().connected, true);
  const refresh = to(fake.calls, "POST", "/auth/v1/token")[0]!;
  assert.deepEqual(refresh.body, { refresh_token: "r0" });
  assert.equal(to(fake.calls, "POST", "/rest/v1/devices")[0]!.headers.get("Authorization"), "Bearer a1");
  assert.equal((to(fake.calls, "POST", "/rest/v1/devices")[0]!.body as { monitoring_status: string }).monitoring_status, "monitoring");
});

test("a session the account rejects signs the PC out", async () => {
  const saved = JSON.stringify({ accessToken: "old", refreshToken: "r0", expiresAt: 0, userId: "u1", email: "e@x.co", deviceId: "d" });
  const fake = backend({ "POST /auth/v1/token": () => new Response("{}", { status: 400 }) });
  const store = memory(saved);
  const sync = createSync(config, fake.fetchImpl, store);
  await sync.restore();
  assert.equal(sync.view().connected, false);
  assert.equal(store.value, undefined);
});

test("warnings are sent once, with only the short redacted fields", async () => {
  const fake = backend();
  let clock = 0;
  const sync = createSync(config, fake.fetchImpl, memory(), { now: () => clock, newId: () => "device-1" });
  await sync.signIn("syed@example.com");
  const input = incidentFor(assessment("high_risk", ["Pay with gift cards and do not tell anyone"]), "browser")!;
  await sync.reportIncident(input);
  await sync.reportIncident(input);
  clock += SAME_WARNING_MS - 1;
  await sync.reportIncident(input);
  assert.equal(to(fake.calls, "POST", "/rest/v1/incidents").length, 1, "repeats within ten minutes are one warning");
  const sent = to(fake.calls, "POST", "/rest/v1/incidents")[0]!.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(sent).sort(), ["categories", "device_id", "evidence_redacted", "platform", "risk", "rule_ids", "surface", "user_id"]);
  assert.equal(sent.platform, "windows");
  assert.equal(sent.device_id, "device-1");
  clock += 2;
  await sync.reportIncident(input);
  assert.equal(to(fake.calls, "POST", "/rest/v1/incidents").length, 2, "the same warning later is new again");
});

test("nothing is sent when the account keeps no history, or when signed out", async () => {
  const off = backend({ "GET /rest/v1/profiles": () => new Response(JSON.stringify([{ history_sync: false }]), { status: 200 }) });
  const sync = createSync(config, off.fetchImpl, memory());
  const input = incidentFor(assessment("high_risk", ["Send a gift card code"]), "text")!;
  await sync.reportIncident(input);
  await sync.signIn("a@b.co");
  await sync.reportIncident(input);
  assert.equal(to(off.calls, "POST", "/rest/v1/incidents").length, 0);
});

test("a failed send is reported on the view but never thrown, and can be retried", async () => {
  let fail = true;
  const fake = backend({ "POST /rest/v1/incidents": () => (fail ? new Response("no", { status: 500 }) : new Response(null, { status: 201 })) });
  const sync = createSync(config, fake.fetchImpl, memory());
  await sync.signIn("a@b.co");
  const input = incidentFor(assessment("caution", ["Verify your account now"]), "browser")!;
  await sync.reportIncident(input);
  assert.match(sync.view().error ?? "", /Couldn't send/);
  fail = false;
  await sync.reportIncident(input);
  assert.equal(sync.view().error, undefined);
  assert.equal(to(fake.calls, "POST", "/rest/v1/incidents").length, 2);
});

test("the phone's recent likely scam is read and shown with its age", async () => {
  let clock = Date.parse("2026-10-04T12:00:00Z");
  const row = { id: "p1", surface: "call", evidence_redacted: "Mike, the grandson · gift cards", created_at: "2026-10-04T11:55:00Z" };
  const fake = backend({ "GET /rest/v1/incidents": () => new Response(JSON.stringify([row]), { status: 200 }) });
  const sync = createSync(config, fake.fetchImpl, memory(), { now: () => clock });
  assert.equal(await sync.checkPhone(), undefined, "signed out reads nothing");
  await sync.signIn("a@b.co");
  const warning = await sync.checkPhone();
  assert.equal(warning?.id, "p1");
  const query = new URL(to(fake.calls, "GET", "/rest/v1/incidents")[0]!.url).searchParams;
  assert.equal(query.get("platform"), "eq.ios");
  assert.equal(query.get("risk"), "eq.high_risk");
  assert.deepEqual(sync.view().phoneWarning, { surface: "call", evidence: "Mike, the grandson · gift cards", minutesAgo: 5 });
  clock += 40 * 60_000;
  assert.equal(sync.view().phoneWarning, undefined, "older than half an hour is no longer recent");
});

test("without a backend configured everything is inert", async () => {
  const fake = backend();
  const sync = createSync(undefined, fake.fetchImpl, memory());
  await sync.restore();
  await sync.reportIncident({ risk: "high_risk", surface: "browser", ruleIds: [], evidence: null });
  assert.equal(await sync.checkPhone(), undefined);
  assert.deepEqual(sync.view(), { configured: false, connected: false });
  assert.equal(fake.calls.length, 0);
});

test("signing out forgets the session", async () => {
  const fake = backend();
  const store = memory();
  const sync = createSync(config, fake.fetchImpl, store);
  await sync.signIn("a@b.co");
  await sync.signOut();
  assert.equal(sync.view().connected, false);
  assert.equal(store.value, undefined);
});
