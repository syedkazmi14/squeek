import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateInput,
  allowedFrame,
} from "../apps/desktop/src/main/ipc-policy.ts";
test("IPC excludes foreign frames and unbounded or malformed commands", () => {
  assert.equal(allowedFrame("squeek://app/index.html", true), true);
  assert.equal(allowedFrame("https://example.org", true), false);
  assert.equal(allowedFrame("squeek://app/index.html", false), false);
  assert.throws(() => validateInput("check", "x".repeat(8001)));
  assert.throws(() =>
    validateInput("monitor", { enabled: true, browser: "other" }),
  );
  assert.throws(() => validateInput("execute", "anything"));
  assert.deepEqual(
    validateInput("monitor", { enabled: true, browser: "chrome" }),
    { enabled: true, browser: "chrome" },
  );
});
