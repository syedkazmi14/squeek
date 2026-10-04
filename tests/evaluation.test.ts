import assert from "node:assert/strict";
import { test } from "node:test";
import { assess } from "../packages/detection/src/index.ts";
import { observation } from "../scripts/evaluation/corpus.ts";
import { development } from "../scripts/evaluation/development.ts";
import { counts, type Row } from "../scripts/evaluate-detection.ts";
import { spawnSync } from "node:child_process";

test("development regressions preserve alerts, safety guidance and observed evidence", async () => {
  for (const item of development) {
    const result = await assess(observation(item));
    const alert = ["caution", "high_risk"].includes(result.state);
    if (item.label === "scam") assert.ok(alert, item.id);
    if (item.label === "legitimate") assert.equal(result.state, "no_detected_signal", item.id);
    if (item.label === "ambiguous") assert.equal(result.state, "unknown", item.id);
    assert.ok(result.evidence.every(e => item.texts[e.spanIndex]?.includes(e.excerpt)), item.id);
  }
});
test("live evaluation rejects absent or invalid caps before loading credentials", () => {
  for (const args of [[], ["--request-cap", "0"], ["--request-cap", "101"], ["--request-cap", "NaN"]]) {
    const result = spawnSync(process.execPath, ["scripts/evaluate-detection.ts", "--jev", "--credential-file", "nonexistent-private-file", ...args], { encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Evaluation failed/);
    assert.ok(!result.stderr.includes("nonexistent-private-file"));
  }
});
test("metrics include unknown scams as misses and exclude ambiguous labels from binary denominators", () => {
  const row = (label: Row["label"], state: Row["state"]): Row => ({ id: "metric", category: "metric", label, state, coverage: "partial", providerHealth: "local_only", limitation: null });
  assert.deepEqual(counts([row("scam", "unknown"), row("scam", "caution"), row("legitimate", "high_risk"), row("legitimate", "unknown"), row("ambiguous", "caution"), row("ambiguous", "unknown"), row("ambiguous", "no_detected_signal")]), {
    cases: 7, scams: 2, legitimate: 2, ambiguous: 3, falseNegatives: 1, falsePositives: 1, truePositives: 1,
    ambiguousAlerts: 1, ambiguousUnknown: 1, ambiguousNoSignal: 1, unknown: 3,
  });
});
