import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../packages/detection/src/policy.ts';
import type { Signal } from '../packages/detection/src/types.ts';

const signal = (category: string, qualifiers: Signal['qualifiers'] = []): Signal =>
  ({ category, spanIndex: 0, excerpt: 'x', weight: 'strong', qualifiers });

test('credential requests are suspicious and name their combination', () => {
  const result = decide([signal('credential')], 'complete');
  assert.equal(result.state, 'suspicious');
  assert.equal(result.rationale.combination, 'credential-request');
});

test('a negated credential request does not escalate', () => {
  assert.equal(decide([signal('credential', ['negated'])], 'complete').state, 'no_supported_signal');
});

test('partial coverage is never reported as no supported signal', () => {
  assert.equal(decide([], 'partial').state, 'unknown_incomplete');
  assert.equal(decide([], 'complete').state, 'no_supported_signal');
});

test('an amount plus a directed request needs corroboration to be suspicious', () => {
  assert.equal(decide([signal('amount'), signal('money')], 'complete').state, 'caution');
  assert.equal(decide([signal('amount'), signal('money'), signal('pressure')], 'complete').state, 'suspicious');
});
