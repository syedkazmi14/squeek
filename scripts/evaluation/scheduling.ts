import assert from "node:assert/strict";
import { AssessmentScheduler, type SchedulerClock } from "../../packages/detection/src/scheduler.ts";
import { assess, type Assessment } from "../../packages/detection/src/index.ts";
import { observation, type Case } from "./corpus.ts";
class Clock implements SchedulerClock {
  time = 0; next = 0; timers = new Map<number, { at: number; fn: () => void }>();
  now() { return this.time; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; }
  clearTimeout(id: unknown) { this.timers.delete(id as number); }
  tick(ms: number) { this.time += ms; for (const [id, timer] of this.timers) if (timer.at <= this.time) { this.timers.delete(id); timer.fn(); } }
}
const flush = () => new Promise<void>(r => setImmediate(r));
export async function schedulingProbe() {
  const item: Case = { id: "scheduler", category: "technical", label: "legitimate", coverage: "complete", texts: ["Synthetic unchanged scheduling payload"] };
  const clock = new Clock(), results: Assessment[] = [];
  const scheduler = new AssessmentScheduler({ clock, assess: (o, signal) => assess(o, { signal }), onResult: result => results.push(result) });
  scheduler.observe(observation(item)); clock.tick(400); await flush();
  for (let revision = 2; revision <= 20; revision++) {
    const input = observation(item, revision); input.spans[0]!.rect.x = revision;
    scheduler.observe(input);
  }
  const repeated = { observations: 20, ...scheduler.counters };
  assert.equal(repeated.requests, 1); assert.equal(repeated.cacheHits, 19);
  clock.tick(60000); scheduler.observe(observation(item, 21)); clock.tick(400); await flush();
  assert.equal(scheduler.counters.requests, 2);
  const expired = { ...scheduler.counters };
  scheduler.pause(); assert.equal(scheduler.counters.cacheEntries, 0);
  const budgetResults: Assessment[] = [];
  const budget = new AssessmentScheduler({ clock, maxRequests: 1, assess: (o, signal) => assess(o, { signal }), onResult: result => budgetResults.push(result) });
  budget.observe(observation(item)); clock.tick(400); await flush();
  budget.observe(observation({ ...item, texts: ["changed technical payload"] }, 2)); clock.tick(400); await flush();
  assert.equal(budgetResults.at(-1)?.state, "unknown");
  const pending: { result: Promise<Assessment>; resolve: (result: Assessment) => void }[] = [];
  const concurrentResults: Assessment[] = [];
  const concurrent = new AssessmentScheduler({ clock, assess: o => new Promise(resolve => pending.push({ result: assess(o), resolve })), onResult: result => concurrentResults.push(result) });
  for (let revision = 1; revision <= 3; revision++) {
    concurrent.observe(observation({ ...item, texts: [`synthetic changed content ${revision}`] }, revision)); clock.tick(400);
  }
  const saturated = { ...concurrent.counters };
  assert.equal(saturated.inFlight, 2); assert.equal(saturated.cancelled, 2);
  pending[0]!.resolve(await pending[0]!.result); await flush();
  assert.equal(pending.length, 3);
  for (const request of pending.slice(1)) request.resolve(await request.result);
  await flush(); assert.equal(concurrentResults.at(-1)?.revision, 3);
  return { conditions: "Fake-clock scheduling with synthetic local assessments and cancellation-ignoring deferred transports; no HTTP requests. Requests count assessment starts, not provider HTTP attempts.",
    debounceMs: 400, maximumCoalescingMs: 1000, cacheTtlMs: 60000, cacheCapacity: 32, maximumInFlight: 2,
    repeated, afterExpiry: expired, afterPause: scheduler.counters, oneRequestBudget: budget.counters,
    saturated, afterCapacityRecovery: concurrent.counters, recoveredRevision: concurrentResults.at(-1)?.revision };
}
