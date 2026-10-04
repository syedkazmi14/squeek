import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../packages/detection/src/normalize.ts';
import { qualify } from '../packages/detection/src/qualify.ts';
import { extractors } from '../packages/detection/src/signals/registry.ts';
import { observation } from './fixtures/observation.ts';

const run = (text: string) => {
  const input = normalize(observation(text));
  return qualify(extractors.flatMap(e => e.extract(input)), input);
};

test('negated requests are annotated, not removed', () => {
  const money = run('Never send money to strangers.').find(s => s.category === 'money');
  assert.ok(money, 'money signal should still be present');
  assert.deepEqual(money.qualifiers, ['negated']);
});

test('negated hesitation is not safety advice', () => {
  const money = run('Do not hesitate to send money now.').find(s => s.category === 'money');
  assert.ok(money);
  assert.deepEqual(money.qualifiers, []);
});
