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
  assert.throws(() => validateInput("resize", { phase: "start", x: 0, y: 0 }));
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

test("talking accepts only bounded recorded audio and known listening states", () => {
  const audio = new Uint8Array([1, 2, 3]);
  assert.equal(validateInput("talk", audio), audio);
  assert.throws(() => validateInput("talk", new Uint8Array(0)));
  assert.throws(() => validateInput("talk", new Uint8Array(5 * 1024 * 1024 + 1)));
  assert.throws(() => validateInput("talk", "base64 audio"));
  assert.equal(validateInput("listening", "start"), "start");
  assert.equal(validateInput("listening", "hold"), "hold");
  assert.throws(() => validateInput("listening", "stop"));
  assert.throws(() => validateInput("listening", true));
});

test("linking to the iPhone takes only a plausible email, and signing out takes nothing", () => {
  assert.equal(validateInput("sync-signin", "  syed@example.com "), "syed@example.com");
  for (const bad of ["", "no-at-sign", "a b@c.co", `${"x".repeat(250)}@c.co`, 5, undefined, { email: "a@b.co" }])
    assert.throws(() => validateInput("sync-signin", bad));
  assert.equal(validateInput("sync-signout", undefined), undefined);
  assert.throws(() => validateInput("sync-signout", true));
});
