import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../packages/detection/src/normalize.ts';
import { extractors } from '../packages/detection/src/signals/registry.ts';
import { observation } from './fixtures/observation.ts';

const run = (text: string) =>
  extractors.flatMap(e => e.extract(normalize(observation(text))));

test('each extractor emits at most one signal per span, with verbatim excerpts', () => {
  const text = 'IRS agent: pay immediately using gift cards';
  const signals = run(text);
  const categories = signals.map(s => s.category);
  assert.deepEqual([...new Set(categories)].length, categories.length);
  for (const signal of signals) assert.ok(text.includes(signal.excerpt), signal.excerpt);
  assert.ok(categories.includes('impersonation'));
  assert.ok(categories.includes('payment'));
});

test('registry order is stable and extractor-major', () => {
  assert.deepEqual(extractors.map(e => e.id), [
    'impersonation', 'payment', 'amount', 'destination',
    'credential', 'pressure', 'remote_access', 'romance', 'money',
  ]);
});
