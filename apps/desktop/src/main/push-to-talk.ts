import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { observerEnvironment } from "./observer-client.ts";

export type KeyEvent = "down" | "up" | "other";
interface Options {
  /** Ctrl has been held on its own long enough: start listening. */
  start: () => void;
  /** Ctrl released: the user's turn is over. */
  finish: () => void;
  /** It was a shortcut (Ctrl+C, Ctrl+click) or too short a press: discard. */
  cancel: () => void;
  holdMs?: number;
  minTalkMs?: number;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Hold Ctrl to talk, let go to finish. Ctrl is also part of everyday shortcuts, so
 * it only counts when held alone: a short wait before listening keeps quick
 * Ctrl+C presses silent, and any other key or click during the hold cancels.
 */
export class PushToTalk {
  private readonly options: Options;
  private state: "idle" | "pending" | "talking" | "chord" = "idle";
  private timer: unknown;
  private startedAt = 0;
  constructor(options: Options) {
    this.options = options;
  }

  key(event: KeyEvent): void {
    const now = this.options.now ?? Date.now;
    if (event === "down" && this.state === "idle") {
      this.state = "pending";
      this.timer = (this.options.setTimeout ?? setTimeout)(() => {
        this.timer = undefined;
        if (this.state !== "pending") return;
        this.state = "talking";
        this.startedAt = now();
        this.options.start();
      }, this.options.holdMs ?? 250);
    } else if (event === "other") {
      if (this.state === "talking") this.options.cancel();
      this.clear();
      if (this.state !== "idle") this.state = "chord";
    } else if (event === "up") {
      if (this.state === "talking") {
        if (now() - this.startedAt < (this.options.minTalkMs ?? 300))
          this.options.cancel();
        else this.options.finish();
      }
      this.clear();
      this.state = "idle";
    }
  }

  private clear(): void {
    if (this.timer === undefined) return;
    (
      this.options.clearTimeout ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    )(this.timer);
    this.timer = undefined;
  }
}

/**
 * Runs the observer's key mode (a low-level keyboard hook) and passes on its events.
 * It reports only Ctrl down/up and "another key or click while Ctrl was held".
 */
export function watchTalkKey(
  executable: string,
  onEvent: (event: KeyEvent) => void,
): { stop: () => void } {
  const child = spawn(executable, ["--keys"], {
    stdio: "pipe",
    windowsHide: true,
    env: observerEnvironment(),
  });
  child.on("error", () => {});
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const event = line.trim();
    if (event === "down" || event === "up" || event === "other") onEvent(event);
  });
  return {
    stop: () => {
      lines.close();
      child.stdin.end();
      child.kill();
    },
  };
}
