import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderGate } from "../apps/desktop/src/main/provider-gate.ts";
test("provider gate requires configured explicit opt-in and enforces session budget", async () => {
  let calls = 0;
  const gate = new ProviderGate(
    {
      classify: async () => {
        calls++;
        return { category: "benign", inputTokens: 5 };
      },
    },
    1,
  );
  assert.equal(gate.provider(), undefined);
  gate.setEnabled(true);
  const provider = gate.provider();
  assert.ok(provider);
  await provider.classify("redacted");
  assert.equal(calls, 1);
  await assert.rejects(provider.classify("redacted"), /budget/i);
  gate.setEnabled(false);
  assert.equal(gate.provider(), undefined);
  assert.equal(gate.counters.inputTokens, 5);
  const unavailable = new ProviderGate(undefined);
  assert.throws(() => unavailable.setEnabled(true));
});
