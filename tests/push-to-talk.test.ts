import test from "node:test";
import assert from "node:assert/strict";
import { PushToTalk } from "../apps/desktop/src/main/push-to-talk.ts";

function setup() {
  const calls: string[] = [];
  let now = 0;
  let pending: (() => void) | undefined;
  const talk = new PushToTalk({
    start: () => calls.push("start"),
    finish: () => calls.push("finish"),
    cancel: () => calls.push("cancel"),
    now: () => now,
    setTimeout: (callback) => (pending = callback),
    clearTimeout: () => (pending = undefined),
  });
  return {
    talk,
    calls,
    // Advances time, firing the hold timer if it is still waiting.
    hold: (ms: number) => {
      now += ms;
      const fire = pending;
      pending = undefined;
      fire?.();
    },
  };
}

test("holding Ctrl alone listens, and letting go finishes the turn", () => {
  const f = setup();
  f.talk.key("down");
  assert.deepEqual(f.calls, []);
  f.hold(250);
  assert.deepEqual(f.calls, ["start"]);
  f.hold(2000);
  f.talk.key("up");
  assert.deepEqual(f.calls, ["start", "finish"]);
});

test("a quick tap or a quick shortcut never starts listening", () => {
  const f = setup();
  f.talk.key("down");
  f.talk.key("up");
  f.talk.key("down");
  f.talk.key("other");
  f.hold(500);
  f.talk.key("up");
  assert.deepEqual(f.calls, []);
});

test("a shortcut pressed after listening started is discarded", () => {
  const f = setup();
  f.talk.key("down");
  f.hold(250);
  f.talk.key("other");
  f.talk.key("up");
  assert.deepEqual(f.calls, ["start", "cancel"]);
  // The next hold works normally.
  f.talk.key("down");
  f.hold(250);
  f.hold(1000);
  f.talk.key("up");
  assert.deepEqual(f.calls, ["start", "cancel", "start", "finish"]);
});

test("letting go almost immediately after listening starts is discarded", () => {
  const f = setup();
  f.talk.key("down");
  f.hold(250);
  f.hold(100);
  f.talk.key("up");
  assert.deepEqual(f.calls, ["start", "cancel"]);
});
