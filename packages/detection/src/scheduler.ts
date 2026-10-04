import type { Observation } from "../../contracts/src/observation.ts";
import { detectionPolicyVersion, sourceId, type Assessment } from "./index.ts";
export interface SchedulerClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const defaultClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};
interface Options {
  assess: (
    observation: Observation,
    signal: AbortSignal,
  ) => Promise<Assessment>;
  onResult: (assessment: Assessment) => void;
  clock?: SchedulerClock;
  maxRequests?: number;
}
export class AssessmentScheduler {
  private readonly options: Options;
  private readonly clock: SchedulerClock;
  private timer: unknown;
  private first: number | undefined;
  private latest: Observation | undefined;
  private generation = 0;
  private paused = false;
  private active = new Map<AbortController, number>();
  private waitingForCapacity = false;
  private cache = new Map<
    string,
    { assessment: Assessment; expires: number }
  >();
  private stats = {
    requests: 0,
    cacheHits: 0,
    cancelled: 0,
    stale: 0,
    degraded: 0,
  };
  constructor(options: Options) {
    if (
      options.maxRequests !== undefined &&
      (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 0)
    )
      throw Error("Invalid request budget");
    this.options = options;
    this.clock = options.clock ?? defaultClock;
  }
  get counters() {
    return {
      ...this.stats,
      inFlight: this.active.size,
      cacheEntries: this.cache.size,
    };
  }
  observe(input: Observation): void {
    if (this.paused) return;
    const observation = structuredClone(input);
    const sameContext =
      this.latest?.sessionId === observation.sessionId &&
      sourceId(this.latest.source) === sourceId(observation.source);
    if (
      sameContext &&
      this.latest &&
      observation.revision < this.latest.revision
    )
      return;
    if (this.latest && !sameContext) this.cache.clear();
    const unchanged =
      this.latest && this.key(this.latest) === this.key(observation);
    this.latest = observation;
    if (unchanged && (this.timer !== undefined || [...this.active].some(([controller, generation]) =>
      generation === this.generation && !controller.signal.aborted))) return;
    this.waitingForCapacity = false;
    this.generation++;
    for (const controller of this.active.keys()) {
      if (!controller.signal.aborted) {
        controller.abort();
        this.stats.cancelled++;
      }
    }
    const key = this.key(observation);
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.clock.now()) {
      this.stats.cacheHits++;
      this.clearTimer();
      this.options.onResult({
        ...structuredClone(cached.assessment),
        source: observation.source,
        revision: observation.revision,
      });
      return;
    }
    this.first ??= this.clock.now();
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = undefined;
        this.first = undefined;
        void this.run();
      },
      Math.max(0, Math.min(400, 1000 - (this.clock.now() - this.first))),
    );
  }
  pause(): void {
    this.paused = true;
    this.generation++;
    this.clearTimer();
    this.latest = undefined;
    this.cache.clear();
    this.waitingForCapacity = false;
    for (const controller of this.active.keys()) {
      if (!controller.signal.aborted) {
        controller.abort();
        this.stats.cancelled++;
      }
    }
  }
  private clearTimer() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.first = undefined;
  }
  private key(o: Observation) {
    return JSON.stringify([
      detectionPolicyVersion,
      "jev-1.13.0",
      o.sessionId,
      o.source,
      o.coverage,
      o.provenance,
      o.spans.map((s) => s.text),
    ]);
  }
  private degraded(o: Observation) {
    this.stats.degraded++;
    this.options.onResult({
      state: "unknown",
      source: o.source,
      revision: o.revision,
      evidence: [],
      providerHealth: "unavailable",
      coverage: "partial",
      assessedAt: this.clock.now(),
    });
  }
  private async run(): Promise<void> {
    const observation = this.latest;
    if (!observation || this.paused) return;
    const generation = this.generation;
    if (this.stats.requests >= (this.options.maxRequests ?? 100)) {
      this.degraded(observation);
      return;
    }
    if (this.active.size >= 2) {
      this.waitingForCapacity = true;
      this.degraded(observation);
      return;
    }
    this.waitingForCapacity = false;
    const controller = new AbortController();
    this.active.set(controller, generation);
    this.stats.requests++;
    try {
      const result = await this.options.assess(observation, controller.signal);
      if (
        controller.signal.aborted ||
        generation !== this.generation ||
        this.paused
      ) {
        this.stats.stale++;
        return;
      }
      if (
        result.revision !== observation.revision ||
        sourceId(result.source) !== sourceId(observation.source)
      ) {
        this.degraded(observation);
        return;
      }
      for (const [key, value] of this.cache)
        if (value.expires <= this.clock.now()) this.cache.delete(key);
      if (this.cache.size >= 32)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(this.key(observation), {
        assessment: structuredClone(result),
        expires: this.clock.now() + 60000,
      });
      this.options.onResult({
        ...result,
        revision: this.latest?.revision ?? result.revision,
      });
    } catch {
      if (
        !controller.signal.aborted &&
        generation === this.generation &&
        !this.paused
      )
        this.degraded(observation);
    } finally {
      this.active.delete(controller);
      // A cancelled transport may settle late. Dispatch retained latest content
      // when capacity returns, even if the native source emits no further event.
      if (this.waitingForCapacity && !this.paused && this.active.size < 2 && this.timer === undefined) {
        this.waitingForCapacity = false;
        void this.run();
      }
    }
  }
}
