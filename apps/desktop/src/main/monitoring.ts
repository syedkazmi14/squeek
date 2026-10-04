import type { ObserverClient } from "./observer-client.ts";
import type {
  Foreground,
  Link,
  Observation,
  ObserverCommand,
  ObserverEvent,
  Rect,
} from "../../../../packages/contracts/src/observation.ts";
import { sameSource } from "../../../../packages/contracts/src/protocol.ts";

export type MonitoringHealth = {
  state: "available" | "unsupported" | "paused" | "unavailable";
  code: string;
};
export interface MonitoringOptions {
  createSession: () => {
    observer: Pick<ObserverClient, "request" | "close">;
    sessionId: string;
  };
  onObservation: (observation: Observation) => void;
  onHealth: (health: MonitoringHealth) => void;
  /** Receives the link under the cursor (or none) while a page is watched. */
  onLink?: (link: Link | undefined) => void;
  pollIntervalMs?: number;
  hoverIntervalMs?: number;
}
type Session = ReturnType<MonitoringOptions["createSession"]>;
// Browsers build their accessibility tree lazily and live pages drop nodes mid-read;
// these keep the watched scope and retry on the next tick instead of tearing down.
const TRANSIENT_READ = ["no_visible_text", "read_failed"];
function sameRegion(a: Rect, b: Rect): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/** Main-process only. Each start is explicit opt-in; stop kills pending native reads. */
export class Monitoring {
  private readonly options: MonitoringOptions;
  private readonly interval: number;
  private epoch = 0;
  private selected: "chrome" | "msedge" | undefined;
  private session: Session | undefined;
  private scope: Foreground | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryRead = false;
  private hoverTimer: ReturnType<typeof setInterval> | undefined;
  private hovering = false;
  // The observer answers one request at a time; page reads and hover checks take turns.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: MonitoringOptions) {
    this.options = options;
    const interval = options.pollIntervalMs ?? 2000;
    if (!Number.isFinite(interval))
      throw new Error("Invalid monitoring interval");
    this.interval = Math.min(60_000, Math.max(2000, interval));
  }

  async start(processName: "chrome" | "msedge"): Promise<void> {
    if (processName !== "chrome" && processName !== "msedge")
      throw new Error("Unsupported monitoring app");
    this.stop();
    this.selected = processName;
    const epoch = ++this.epoch;
    if (this.options.onLink)
      this.hoverTimer = setInterval(
        () => void this.hover(epoch),
        this.options.hoverIntervalMs ?? 300,
      );
    await this.poll(epoch);
  }

  stop(): void {
    const active = this.selected !== undefined;
    ++this.epoch;
    this.selected = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.hoverTimer) clearInterval(this.hoverTimer);
    this.hoverTimer = undefined;
    this.disconnect();
    if (active) this.options.onHealth({ state: "paused", code: "paused" });
  }

  private disconnect(): void {
    const session = this.session;
    this.session = undefined;
    this.scope = undefined;
    this.retryRead = false;
    // A closed session's requests must not hold up the next session's.
    this.queue = Promise.resolve();
    session?.observer.close();
    this.options.onLink?.(undefined);
  }

  private send(session: Session, command: ObserverCommand) {
    const result = this.queue.then(() => session.observer.request(command));
    this.queue = result.catch(() => {});
    return result;
  }

  /** Hover checks never tear the session down; the page poll owns health. */
  private async hover(epoch: number): Promise<void> {
    const session = this.session,
      scope = this.scope;
    if (this.hovering || !session || !scope || !this.current(epoch, session))
      return;
    this.hovering = true;
    try {
      const reply = await this.send(session, {
        kind: "link",
        version: 1,
        sessionId: session.sessionId,
        source: scope.source,
        region: scope.region,
      });
      if (!this.current(epoch, session) || this.scope !== scope) return;
      this.options.onLink?.(reply.kind === "link" ? reply : undefined);
    } catch {
      if (this.current(epoch, session)) this.options.onLink?.(undefined);
    } finally {
      this.hovering = false;
    }
  }

  private current(epoch: number, session: Session): boolean {
    return (
      this.epoch === epoch &&
      this.selected !== undefined &&
      this.session === session
    );
  }

  private reject(health: MonitoringHealth): void {
    this.disconnect();
    this.options.onHealth(health);
  }

  private async poll(epoch: number): Promise<void> {
    try {
      if (epoch !== this.epoch || !this.selected) return;
      const session = this.session ?? this.options.createSession();
      this.session = session;
      const request = (kind: ObserverCommand["kind"], scope?: Foreground) =>
        this.send(
          session,
          scope
            ? {
                kind: kind as "watch" | "observe",
                version: 1,
                sessionId: session.sessionId,
                source: scope.source,
                region: scope.region,
              }
            : {
                kind: kind as "foreground" | "changes",
                version: 1,
                sessionId: session.sessionId,
              },
        );
      const foreground = await request("foreground");
      if (!this.current(epoch, session)) return;
      if (
        foreground.kind !== "foreground" ||
        foreground.processName !== this.selected
      ) {
        this.reject(
          foreground.kind === "health"
            ? foreground
            : { state: "unsupported", code: "unsupported_app" },
        );
        return;
      }
      if (
        this.scope &&
        (!sameSource(this.scope.source, foreground.source) ||
          !sameRegion(this.scope.region, foreground.region))
      ) {
        this.reject({ state: "unsupported", code: "foreground_changed" });
        return;
      }
      let shouldRead = !this.scope;
      if (!this.scope) {
        const watching = await request("watch", foreground);
        if (!this.current(epoch, session)) return;
        if (
          watching.kind !== "health" ||
          watching.state !== "available" ||
          watching.code !== "watching"
        ) {
          this.reject(
            watching.kind === "health"
              ? watching
              : { state: "unavailable", code: "invalid_response" },
          );
          return;
        }
        this.scope = foreground;
        this.options.onHealth({ state: watching.state, code: watching.code });
      } else {
        const changes = await request("changes");
        if (!this.current(epoch, session)) return;
        if (
          changes.kind !== "health" ||
          changes.state !== "available" ||
          !["changed", "unchanged"].includes(changes.code)
        ) {
          this.reject(
            changes.kind === "health"
              ? changes
              : { state: "unavailable", code: "invalid_response" },
          );
          return;
        }
        shouldRead = changes.code === "changed" || this.retryRead;
      }
      if (!shouldRead || !this.current(epoch, session)) return;
      this.retryRead = false;
      const observation = await request("observe", foreground);
      if (!this.current(epoch, session)) return;
      if (
        observation.kind === "health" &&
        TRANSIENT_READ.includes(observation.code)
      ) {
        this.retryRead = true;
        return;
      }
      if (observation.kind !== "observation") {
        this.reject(
          observation.kind === "health"
            ? observation
            : { state: "unavailable", code: "invalid_response" },
        );
        return;
      }
      // Validate metadata again before exposing spans, even if native extraction succeeded.
      const after = await request("foreground");
      if (!this.current(epoch, session)) return;
      if (
        after.kind !== "foreground" ||
        after.processName !== this.selected ||
        !sameSource(foreground.source, after.source) ||
        !sameSource(observation.source, after.source) ||
        !sameRegion(foreground.region, after.region)
      ) {
        this.reject({ state: "unsupported", code: "foreground_changed" });
        return;
      }
      this.options.onObservation(observation);
    } catch {
      if (epoch === this.epoch && this.selected)
        this.reject({ state: "unavailable", code: "observer_failed" });
    } finally {
      if (epoch === this.epoch && this.selected)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.poll(epoch);
        }, this.interval);
    }
  }
}
