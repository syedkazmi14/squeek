import { test } from "node:test";
import assert from "node:assert/strict";
import { incidentKey } from "../apps/desktop/src/renderer/incident.ts";
test("speech incident ignores bookkeeping revisions and changes with actual source or evidence", () => {
  const assessment = {
    state: "high_risk",
    coverage: "partial",
    source: { processId: 1, windowHandle: "2", processStartedAt: 3 },
    evidence: [{ excerpt: "technical signal" }],
    revision: 1,
  };
  const revised = { ...assessment, revision: 2 };
  assert.equal(incidentKey(assessment), incidentKey(revised));
  assert.notEqual(
    incidentKey(assessment),
    incidentKey({
      ...assessment,
      source: { ...assessment.source, processStartedAt: 4 },
    }),
  );
  assert.notEqual(
    incidentKey(assessment),
    incidentKey({
      ...assessment,
      evidence: [{ excerpt: "changed technical signal" }],
    }),
  );
  assert.notEqual(incidentKey(assessment), incidentKey(undefined));
});
