import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize, sliceOriginal } from '../packages/detection/src/normalize.ts';
import { observation } from './fixtures/observation.ts';

test('normalize preserves text and maps offsets back to the original', () => {
  const result = normalize(observation('Please send $5,000 today'));
  const span = result.spans[0]!;
  assert.equal(span.normalized, span.original);
  assert.equal(span.map.length, span.normalized.length);
  assert.equal(sliceOriginal(span, 7, 11), 'send');
  assert.equal(result.coverage, 'complete');
});

test('normalize keeps empty spans addressable', () => {
  const result = normalize({ ...observation('x'), spans: [] });
  assert.deepEqual(result.spans, []);
});

// Boundary case tests for sliceOriginal
test('sliceOriginal handles empty slice (start === end)', () => {
  const result = normalize(observation('hello'));
  const span = result.spans[0]!;
  assert.equal(sliceOriginal(span, 2, 2), '');
  assert.equal(sliceOriginal(span, 0, 0), '');
  assert.equal(sliceOriginal(span, 5, 5), '');
});

test('sliceOriginal handles single-character slice', () => {
  const result = normalize(observation('hello'));
  const span = result.spans[0]!;
  assert.equal(sliceOriginal(span, 0, 1), 'h');
  assert.equal(sliceOriginal(span, 2, 3), 'l');
  assert.equal(sliceOriginal(span, 4, 5), 'o');
});

test('sliceOriginal handles start at position 0', () => {
  const result = normalize(observation('hello'));
  const span = result.spans[0]!;
  assert.equal(sliceOriginal(span, 0, 3), 'hel');
  assert.equal(sliceOriginal(span, 0, 5), 'hello');
});

test('sliceOriginal handles end at full text length', () => {
  const result = normalize(observation('hello'));
  const span = result.spans[0]!;
  assert.equal(sliceOriginal(span, 0, 5), 'hello');
  assert.equal(sliceOriginal(span, 3, 5), 'lo');
});

test('sliceOriginal clamps end beyond text length', () => {
  const result = normalize(observation('hello'));
  const span = result.spans[0]!;
  assert.equal(sliceOriginal(span, 0, 10), 'hello');
  assert.equal(sliceOriginal(span, 2, 100), 'llo');
});
