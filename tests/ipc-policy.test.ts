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

test("sidebar visibility requests are payload-free and limited to its frame", () => {
  assert.equal(validateInput("show", undefined), undefined);
  assert.equal(validateInput("hide", undefined), undefined);
  assert.throws(() => validateInput("hide", { enabled: false }));
  assert.equal(allowedFrame("squeek://app/halo.html", true), false);
});

test("browser selection requires a string rather than a coercible value", () => {
  assert.throws(() =>
    validateInput("monitor", { enabled: true, browser: ["chrome"] }),
  );
});
