// Run with: deno test --allow-read packages/detection/test
import { analyzeLink, assessLocally, normalizeE164, redact, type RuleSet } from "../src/index.ts";

const rules: RuleSet = JSON.parse(await Deno.readTextFile(new URL("../rules/rules.json", import.meta.url)));
const golden = JSON.parse(await Deno.readTextFile(new URL("../../../tests/fixtures/golden.json", import.meta.url)));

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

for (const c of golden.text) {
  Deno.test(`text: ${c.id}`, () => {
    const result = assessLocally(redact(c.input, rules), rules);
    assertEq(result.risk, c.risk, "risk");
    const ids = result.matches.map((m) => m.id);
    for (const s of c.signals) if (!ids.includes(s)) throw new Error(`missing signal ${s}; got ${ids}`);
    if (c.signals.length === 0) assertEq(ids, [], "signals");
  });
}

for (const c of golden.redact) {
  Deno.test(`redact: ${c.id}`, () => assertEq(redact(c.input, rules), c.output, "redaction"));
}

for (const c of golden.links) {
  Deno.test(`link: ${c.id}`, () => {
    const result = analyzeLink(c.input, rules, c.blocked ?? []);
    assertEq(result.verdict, c.verdict, "verdict");
    assertEq(result.findings.map((f) => f.id).sort(), [...c.findings].sort(), "findings");
  });
}

for (const c of golden.phones) {
  Deno.test(`phone: ${c.input}`, () => assertEq(normalizeE164(c.input), c.output, "e164"));
}
