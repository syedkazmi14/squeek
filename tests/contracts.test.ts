import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand, parseEvent, MAX_FRAME_BYTES } from '../packages/contracts/src/protocol.ts';

const sessionId = '3134be1d-845b-4d4c-8725-827702573fd4';
const source = { processId: 1234, windowHandle: '5432', processStartedAt: 123456789 };
const rect = { x: 0, y: 0, width: 640, height: 480 };
const observation = {
  kind: 'observation', version: 1, sessionId, source, revision: 1,
  observedAt: 123456789, provenance: 'accessibility', coverage: 'partial',
  spans: [{ text: 'Visible text', rect }],
};
const context = { sessionId, source, lastRevision: 0 };
const event = (value: unknown) => JSON.stringify(value);

test('accepts a bounded observation with provenance and source identity', () => {
  assert.deepEqual(parseEvent(event(observation), context), observation);
});

test('accepts only the narrow read-only command set', () => {
  assert.deepEqual(parseCommand(event({ kind: 'observe', version: 1, sessionId, source, region: rect }), sessionId),
    { kind: 'observe', version: 1, sessionId, source, region: rect });
  for (const kind of ['hello', 'pause', 'shutdown']) {
    assert.equal(parseCommand(event({ kind, version: 1, sessionId }), sessionId).kind, kind);
  }
  assert.throws(() => parseCommand(event({ kind: 'execute', version: 1, sessionId, path: 'cmd.exe' }), sessionId));
});

test('rejects malformed, mismatched, or extensible frames', () => {
  for (const value of [null, [], { ...observation, version: 2 }, { ...observation, sessionId: 'wrong' },
    { ...observation, source: { ...source, processId: 9999 } }, { ...observation, extra: true },
    { ...observation, source: { ...source, processStartedAt: source.processStartedAt + 1 } },
    { ...observation, revision: 0 }, { ...observation, revision: 1.5 },
    { ...observation, spans: [{ text: 'x', rect, extra: true }] }]) {
    assert.throws(() => parseEvent(event(value), context));
  }
  assert.throws(() => parseEvent('{', context));
  assert.throws(() => parseEvent(event(observation), { ...context, lastRevision: 1 }));
});

test('bounds UTF-8 input, text totals, span counts, and geometry', () => {
  assert.throws(() => parseEvent('界'.repeat(Math.ceil(MAX_FRAME_BYTES / 3)), context));
  assert.throws(() => parseEvent(event({ ...observation, spans: Array.from({ length: 201 }, () => ({ text: 'x', rect })) }), context));
  assert.throws(() => parseEvent(event({ ...observation, spans: [{ text: 'x'.repeat(8001), rect }] }), context));
  for (const width of [-1, 0, 100001, NaN, Infinity]) {
    assert.throws(() => parseEvent(event({ ...observation, spans: [{ text: 'x', rect: { ...rect, width } }] }), context));
  }
  assert.throws(() => parseCommand(event({ kind: 'observe', version: 1, sessionId, source, region: { ...rect, x: Infinity } }), sessionId));
});

test('keeps unsupported and unavailable separate from scan results', () => {
  for (const state of ['unsupported', 'paused', 'unavailable', 'available']) {
    const health = { kind: 'health', version: 1, sessionId, state, code: 'foreground_changed' };
    assert.deepEqual(parseEvent(event(health), context), health);
  }
  assert.throws(() => parseEvent(event({ ...observation, coverage: 'safe' }), context));
  assert.throws(() => parseEvent(event(observation), { sessionId, lastRevision: 0 }));
});

test('validates metadata-only foreground and change subscription commands', () => {
  for (const kind of ['foreground', 'changes']) assert.equal(parseCommand(event({ kind, version: 1, sessionId }), sessionId).kind, kind);
  assert.equal(parseCommand(event({ kind: 'watch', version: 1, sessionId, source, region: rect }), sessionId).kind, 'watch');
  const foreground = { kind: 'foreground', version: 1, sessionId, source, region: rect, processName: 'Squeek.Fixture' };
  assert.deepEqual(parseEvent(event(foreground), { sessionId, lastRevision: 0 }), foreground);
  assert.throws(() => parseEvent(event({ ...foreground, title: 'private' }), context));
  assert.throws(() => parseEvent(event({ ...foreground, processName: 'other' }), context));
  assert.throws(() => parseEvent(event({ ...foreground, source: { ...source, processId: 2_147_483_648 } }), context));
  assert.throws(() => parseEvent(event({ ...foreground, region: { ...rect, width: 0 } }), context));
  assert.throws(() => parseCommand(event({ kind: 'watch', version: 1, sessionId, source, region: rect, extra: true }), sessionId));
});

test('a link event must come from the requested source and stay bounded', () => {
  const link = { kind: 'link', version: 1, sessionId, source, url: 'https://example.com/', text: 'Example', rect };
  assert.deepEqual(parseEvent(event(link), context), link);
  assert.deepEqual(parseCommand(event({ kind: 'link', version: 1, sessionId, source, region: rect }), sessionId).kind, 'link');
  assert.throws(() => parseEvent(event(link), { sessionId, lastRevision: 0 }));
  assert.throws(() => parseEvent(event({ ...link, source: { ...source, windowHandle: '999' } }), context));
  assert.throws(() => parseEvent(event({ ...link, url: '' }), context));
  assert.throws(() => parseEvent(event({ ...link, url: 'x'.repeat(2049) }), context));
  assert.throws(() => parseEvent(event({ ...link, text: 'x'.repeat(301) }), context));
  assert.throws(() => parseEvent(event({ ...link, extra: true }), context));
});
