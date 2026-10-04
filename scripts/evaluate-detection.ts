import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { assess, detectionPolicyVersion, type Assessment } from "../packages/detection/src/index.ts";
import { createJevProvider, type JevProvider } from "../packages/providers/src/jev.ts";
import { observation, type Case } from "./evaluation/corpus.ts";
import { development } from "./evaluation/development.ts";
import { heldOut } from "./evaluation/held-out.ts";
import { schedulingProbe } from "./evaluation/scheduling.ts";

export interface Row {
  id: string; category: string; label: Case["label"]; coverage: Case["coverage"];
  state: Assessment["state"]; providerHealth: Assessment["providerHealth"];
  limitation: string | null;
}
export function counts(rows: Row[]) {
  const alerts = (row: Row) => row.state === "high_risk" || row.state === "caution";
  const scams = rows.filter(r => r.label === "scam");
  const legitimate = rows.filter(r => r.label === "legitimate");
  const ambiguous = rows.filter(r => r.label === "ambiguous");
  return {
    cases: rows.length, scams: scams.length, legitimate: legitimate.length, ambiguous: ambiguous.length,
    falseNegatives: scams.filter(r => !alerts(r)).length,
    falsePositives: legitimate.filter(alerts).length,
    truePositives: scams.filter(alerts).length,
    ambiguousAlerts: ambiguous.filter(alerts).length,
    ambiguousUnknown: ambiguous.filter(r => r.state === "unknown").length,
    ambiguousNoSignal: ambiguous.filter(r => r.state === "no_detected_signal").length,
    unknown: rows.filter(r => r.state === "unknown").length,
  };
}
function grouped(rows: Row[], key: "category" | "coverage") {
  return Object.fromEntries([...new Set(rows.map(r => r[key]))].sort().map(value => [value, counts(rows.filter(r => r[key] === value))]));
}
function latency(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
  return { samples: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) ?? null };
}
async function profile(cases: Case[], mode: "idle" | "activity" | "stress") {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const before = process.memoryUsage();
  let peakRssBytes = before.rss, assessments = 0;
  if (mode !== "idle") {
    while (performance.now() - start < 1000) {
      for (let i = 0; i < (mode === "stress" ? 100 : 1); i++) {
        await assess(observation(cases[assessments % cases.length]!));
        assessments++;
      }
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      if (mode === "stress") await new Promise<void>(r => setImmediate(r));
      else await new Promise<void>(r => setTimeout(r, 100));
    }
  } else await new Promise<void>(r => setTimeout(r, 1000));
  const elapsedMs = performance.now() - start;
  const used = process.cpuUsage(cpu);
  const after = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, after.rss);
  return { elapsedMs, assessments, cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
    cpuPercentOfOneCore: (used.user + used.system) / (elapsedMs * 10),
    rssBeforeBytes: before.rss, rssAfterBytes: after.rss, sampledPeakRssBytes: peakRssBytes,
    heapUsedBeforeBytes: before.heapUsed, heapUsedAfterBytes: after.heapUsed };
}
async function evaluate(cases: Case[], provider?: JevProvider) {
  const rows: Row[] = [], times: number[] = [];
  for (const item of cases) {
    const start = performance.now();
    const result = await assess(observation(item), provider ? { provider } : {});
    times.push(performance.now() - start);
    const grounded = result.evidence.every(e => item.texts[e.spanIndex]?.includes(e.excerpt));
    if (!grounded) throw Error("Evaluation found ungrounded evidence");
    rows.push({ id: item.id, category: item.category, label: item.label, coverage: item.coverage,
      state: result.state, providerHealth: result.providerHealth, limitation: item.limitation ?? null });
  }
  return { counts: counts(rows), byCategory: grouped(rows, "category"), byCoverage: grouped(rows, "coverage"), latency: latency(times), rows };
}
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--split", "--output", "--jev", "--request-cap", "--credential-file"]);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (!allowed.has(key) || values.has(key)) throw Error("Invalid evaluation arguments");
    if (key === "--jev") values.set(key, "true");
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw Error("Missing evaluation argument");
      values.set(key, value);
    }
  }
  const split = values.get("--split") ?? "held-out";
  if (split !== "held-out" && split !== "development") throw Error("Invalid evaluation split");
  const cases = split === "held-out" ? heldOut : development;
  let live: unknown = { status: "not_tested", reason: "Live Jev requires --jev, explicit --request-cap and private development credential." };
  // Validate request cap before loading credentials or making any request.
  if (values.has("--request-cap") && !values.has("--jev")) throw Error("Request cap requires --jev");
  if (values.has("--credential-file") && !values.has("--jev")) throw Error("Credential loading requires --jev");
  const cap = Number(values.get("--request-cap"));
  if (values.has("--jev") && (!Number.isSafeInteger(cap) || cap < 1 || cap > 100))
    throw Error("Live evaluation requires an explicit HTTP request cap from 1 to 100");
  const local = await evaluate(cases);
  const simulatedProviderFailure = await evaluate(cases, { classify: async () => { throw Error("synthetic outage"); } });
  const scheduling = await schedulingProbe();
  // Separate warm local latency from first-pass latency and quality counts.
  for (const item of cases) await assess(observation(item));
  const warmTimes: number[] = [];
  for (let repeat = 0; repeat < 100; repeat++) for (const item of cases) {
    const start = performance.now(); await assess(observation(item)); warmTimes.push(performance.now() - start);
  }
  const idle = await profile(cases, "idle"), activity = await profile(cases, "activity"), stress = await profile(cases, "stress");
  if (values.has("--jev")) {
    if (values.has("--credential-file")) process.loadEnvFile(resolve(values.get("--credential-file")!));
    const key = process.env.TYPESAFE_API_KEY;
    if (!key?.trim()) throw Error("Private development credential unavailable; no live requests made");
    let httpAttempts = 0, starts = 0, successes = 0, failures = 0, inputTokens = 0;
    const requestTimes: number[] = [];
    const provider = createJevProvider(key, { maxRequests: cap, fetch: async (url, init) => {
      httpAttempts++; return globalThis.fetch(url, init);
    } });
    const measured: JevProvider = { classify: async (text, signal) => {
      starts++; const start = performance.now();
      try { const result = await provider.classify(text, signal); successes++; inputTokens += result.inputTokens; return result; }
      catch { failures++; throw Error("Provider unavailable"); }
      finally { requestTimes.push(performance.now() - start); }
    } };
    // Sequential, bounded, synthetic only. Stop rather than counting untested cases as failures.
    const tested: Case[] = [], rows: Row[] = [];
    for (const item of cases) {
      if (httpAttempts >= cap) break;
      const result = await evaluate([item], measured); rows.push(...result.rows); tested.push(item);
    }
    live = { status: "tested", model: "jev-1.13.0", requestCap: cap, httpAttempts, classificationStarts: starts,
      successes, failures, returnedInputTokens: inputTokens, billedCost: null,
      tokenNote: "Only validated returned input_tokens are exposed by this adapter; other token usage and billed cost are unknown. Failed requests may have unreturned usage.",
      requestLatency: latency(requestTimes), localPlusJev: { counts: counts(rows), byCategory: grouped(rows, "category"), byCoverage: grouped(rows, "coverage"), rows },
      localOnSameSubset: (await evaluate(tested)).counts, untestedCases: cases.length - tested.length,
      optionOrderStability: "pending; this run uses the fixed production category order" };
  }
  const report = { schemaVersion: 1, corpusSha256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"), split,
    conditions: { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, detectionPolicyVersion,
      syntheticOnly: true, alertThreshold: "caution or high_risk", unknownScamsCountAsFalseNegatives: true,
      ambiguousExcludedFromBinaryDenominators: true, latencyRepeats: 100,
      performanceScope: "This Node detector process only, after warmup; 1s idle, 1s synthetic burst at up to 10 assessments/s, then 1s saturated stress. RSS sampled between batches, not a guaranteed peak. CPU includes all process threads and may exceed one core. Not Electron/native observer or browser monitoring." },
    local, simulatedProviderFailure: { conditions: "Fake provider fails every classification; not live Jev quality, latency, or reliability", classificationStarts: cases.length, httpRequests: 0, ...simulatedProviderFailure },
    scheduling, warmLocalLatency: latency(warmTimes), processProfile: { idle, activity, stress }, live,
    pending: ["Real Chrome/Edge extraction", "Windows steady-state monitoring CPU/memory", "Autonomous browser-to-warning-to-speech latency", "Representative real-world accuracy", "Intended-user testing"] };
  const output = resolve(values.get("--output") ?? `artifacts/evaluation/${split}.json`);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, split, corpusSha256: report.corpusSha256, local: local.counts,
    warmLocalLatency: report.warmLocalLatency, processProfile: report.processProfile, live }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename))
  main().catch(() => { console.error("Evaluation failed; verify arguments, credential availability, or evidence grounding. No credential or response body is logged."); process.exitCode = 1; });
