import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess } from '../packages/detection/src/index.ts';
import { observation } from '../scripts/evaluation/corpus.ts';
import { development } from '../scripts/evaluation/development.ts';
import { heldOut } from '../scripts/evaluation/held-out.ts';

// Phase 0 must not change any observable output. This snapshot is the gate.
test('assess output is unchanged across both corpora', async () => {
  const actual: string[] = [];
  for (const item of [...development, ...heldOut]) {
    const result = await assess(observation(item));
    const evidence = result.evidence.map(e => `${e.ruleId}@${e.spanIndex}:${e.excerpt}`).join('|');
    actual.push(`${item.id} ${result.state} ${result.coverage} ${result.providerHealth} ${JSON.stringify(result.source)} ${result.revision} ${evidence}`);
  }
  const snapshot = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('./fixtures/characterization.json', import.meta.url), 'utf8'));
  assert.deepEqual(actual, snapshot);
});
