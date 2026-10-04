import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  EventContext,
  ObserverCommand,
  ObserverEvent,
} from "../../../../packages/contracts/src/observation.ts";
import {
  MAX_FRAME_BYTES,
  parseCommand,
  parseEvent,
} from "../../../../packages/contracts/src/protocol.ts";

interface Pending {
  kind: ObserverCommand["kind"];
  resolve: (event: ObserverEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ObserverError extends Error {
  constructor(code: string) {
    super(`Observer ${code}`);
    this.name = "ObserverError";
  }
}

export class ObserverClient {
  readonly ready: Promise<void>;
  private child: ChildProcessWithoutNullStreams;
  private context: EventContext;
  private timeoutMs: number;
  private buffer = Buffer.alloc(0);
  private pending: Pending | undefined;
  private busy = false;
  private started = false;
  private failure: ObserverError | undefined;
  private startupTimer: ReturnType<typeof setTimeout>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(
    child: ChildProcessWithoutNullStreams,
    sessionId: string,
    timeoutMs = 2000,
  ) {
    this.child = child;
    this.context = { sessionId, lastRevision: 0 };
    this.timeoutMs = timeoutMs;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Startup can fail before a caller makes a request; do not leak an unhandled rejection.
    void this.ready.catch(() => {});
    this.startupTimer = setTimeout(
      () => this.fail("startup_timeout"),
      timeoutMs,
    );
    child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    child.stdout.on("end", () => this.fail("ended"));
    child.stdout.on("error", () => this.fail("transport_error"));
    child.stdin.on("error", () => this.fail("transport_error"));
    child.stderr.resume();
    child.on("error", () => this.fail("launch_failed"));
    child.on("exit", () => this.fail("exited"));
  }

  async request(command: ObserverCommand): Promise<ObserverEvent> {
    if (this.failure) throw this.failure;
    if (this.busy) throw new ObserverError("busy");
    const line = JSON.stringify(command);
    const approved = parseCommand(line, this.context.sessionId);
    this.busy = true;
    try {
      await this.ready;
      if (this.failure) throw this.failure;
      if (approved.kind === "observe")
        this.context.source = { ...approved.source };
      else delete this.context.source;
      return await new Promise<ObserverEvent>((resolve, reject) => {
        this.pending = {
          kind: approved.kind,
          resolve,
          reject,
          timer: setTimeout(() => this.fail("request_timeout"), this.timeoutMs),
        };
        this.child.stdin.write(line + "\n");
      });
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    this.fail("closed");
  }

  private fail(code: string): void {
    if (this.failure) return;
    this.failure = new ObserverError(code);
    clearTimeout(this.startupTimer);
    this.rejectReady(this.failure);
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failure);
      this.pending = undefined;
    }
    delete this.context.source;
    this.buffer = Buffer.alloc(0);
    this.child.kill();
  }

  private receive(chunk: Buffer): void {
    if (this.failure) return;
    // Never accumulate an unbounded unterminated line, even when a helper misbehaves.
    let offset = 0;
    while (offset < chunk.length && !this.failure) {
      const newline = chunk.indexOf(10, offset);
      const end = newline === -1 ? chunk.length : newline;
      if (this.buffer.length + end - offset > MAX_FRAME_BYTES) {
        this.fail("protocol_error");
        return;
      }
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, end)]);
      if (newline === -1) return;
      const frame = this.buffer;
      this.buffer = Buffer.alloc(0);
      offset = newline + 1;
      try {
        this.deliver(
          parseEvent(
            new TextDecoder("utf-8", { fatal: true }).decode(frame),
            this.context,
          ),
        );
      } catch {
        this.fail("protocol_error");
      }
    }
  }

  private deliver(event: ObserverEvent): void {
    if (!this.started) {
      if (event.kind !== "ready") {
        this.fail("protocol_error");
        return;
      }
      this.started = true;
      clearTimeout(this.startupTimer);
      this.resolveReady();
      return;
    }
    const pending = this.pending;
    if (
      !pending ||
      !(
        (pending.kind === "observe" &&
          ["observation", "health"].includes(event.kind)) ||
        (["hello", "pause", "watch", "changes"].includes(pending.kind) &&
          event.kind === "health") ||
        (pending.kind === "foreground" &&
          ["foreground", "health"].includes(event.kind)) ||
        (pending.kind === "shutdown" && event.kind === "stopped")
      )
    ) {
      this.fail("protocol_error");
      return;
    }
    if (event.kind === "observation")
      this.context.lastRevision = event.revision;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve(event);
    if (event.kind === "stopped") this.close();
  }
}

export function observerEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    "systemroot",
    "windir",
    "path",
    "temp",
    "tmp",
    "comspec",
  ]);
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => allowed.has(key.toLowerCase()) && value !== undefined,
    ),
  );
}

// Fixed development resource path; the renderer never supplies executable paths.
export function createObserverClient(executablePath?: string): {
  observer: ObserverClient;
  sessionId: string;
} {
  const sessionId = randomUUID();
  const executable =
    executablePath ??
    fileURLToPath(
      new URL(
        "../../../../artifacts/observer/Squeek.Observer.exe",
        import.meta.url,
      ),
    );
  const child = spawn(executable, ["--session", sessionId], {
    stdio: "pipe",
    windowsHide: true,
    env: observerEnvironment(),
  });
  return { observer: new ObserverClient(child, sessionId), sessionId };
}
