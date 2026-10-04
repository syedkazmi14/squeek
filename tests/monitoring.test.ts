import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Monitoring } from '../apps/desktop/src/main/monitoring.ts';
import type { ObserverCommand, ObserverEvent, Observation } from '../packages/contracts/src/observation.ts';

const sessionId = '3134be1d-845b-4d4c-8725-827702573fd4';
const source = { processId: 1234, windowHandle: '5432', processStartedAt: 123456789 };
const region = { x: 0, y: 0, width: 640, height: 480 };
const foreground: ObserverEvent = { kind: 'foreground', version: 1, sessionId, source, region, processName: 'chrome' };
const observation: Observation = { kind: 'observation', version: 1, sessionId, source, revision: 1, observedAt: 123456789,
  provenance: 'accessibility', coverage: 'partial', spans: [{ text: 'Synthetic fixture', rect: region }] };
const health = (code: string, state: 'available' | 'unsupported' = 'available'): ObserverEvent => ({ kind: 'health', version: 1, sessionId, state, code });
function setup(replies: (ObserverEvent | Promise<ObserverEvent>)[]) {
  const commands: ObserverCommand[] = [];
  const observations: Observation[] = [];
  const statuses: { state: string; code: string }[] = [];
  let closed = 0;
  let created = 0;
  const monitor = new Monitoring({ createSession: () => { created++; return { sessionId, observer: {
    request: async command => { commands.push(command); const reply = replies.shift(); if (!reply) throw new Error('missing test reply'); return reply; },
    close: () => { closed++; },
  } }; }, onObservation: value => observations.push(value), onHealth: value => statuses.push(value) });
  return { monitor, commands, observations, statuses, closed: () => closed, created: () => created };
}

test('monitor is inert until opt-in and only reads the chosen supported foreground', async () => {
  const fixture = setup([foreground, health('watching'), observation, foreground]);
  assert.equal(fixture.created(), 0);
  try {
    await fixture.monitor.start('chrome');
    assert.deepEqual(fixture.commands.map(value => value.kind), ['foreground', 'watch', 'observe', 'foreground']);
    assert.deepEqual(fixture.observations, [observation]);
  } finally { fixture.monitor.stop(); }
  assert.equal(fixture.closed(), 1);
});

test('unsupported and unselected foreground never receive content requests', async () => {
  for (const reply of [health('unsupported_app', 'unsupported'), { ...foreground, processName: 'msedge' } as ObserverEvent,
    { ...foreground, processName: 'Squeek.Fixture' } as ObserverEvent]) {
    const fixture = setup([reply]);
    try { await fixture.monitor.start('chrome'); assert.deepEqual(fixture.commands.map(value => value.kind), ['foreground']);
      assert.equal(fixture.observations.length, 0); assert.equal(fixture.closed(), 1);
    } finally { fixture.monitor.stop(); }
  }
});

test('pause closes helper and ignores a late pending observation', async () => {
  let resolve!: (event: ObserverEvent) => void;
  const pending = new Promise<ObserverEvent>(done => { resolve = done; });
  const fixture = setup([foreground, health('watching'), pending]);
  const starting = fixture.monitor.start('chrome');
  while (!fixture.commands.some(command => command.kind === 'observe')) await Promise.resolve();
  fixture.monitor.stop(); resolve(observation); await starting;
  assert.equal(fixture.closed(), 1); assert.equal(fixture.observations.length, 0);
  assert.equal(fixture.statuses.at(-1)?.state, 'paused');
});

test('source loss after read discards spans and closes helper', async () => {
  const fixture = setup([foreground, health('watching'), observation, { ...foreground, source: { ...source, windowHandle: '999' } }]);
  try { await fixture.monitor.start('chrome'); assert.equal(fixture.observations.length, 0);
    assert.equal(fixture.closed(), 1); assert.equal(fixture.statuses.at(-1)?.code, 'foreground_changed');
  } finally { fixture.monitor.stop(); }
});

test('bounded metadata polling skips unchanged content and reads only dirty selected sources', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = setup([foreground, health('watching'), observation, foreground,
    foreground, health('unchanged'), foreground, health('changed'), { ...observation, revision: 2 }, foreground]);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  try {
    await fixture.monitor.start('chrome');
    t.mock.timers.tick(1999); await flush();
    assert.equal(fixture.commands.length, 4);
    t.mock.timers.tick(1); await flush();
    assert.deepEqual(fixture.commands.slice(4).map(value => value.kind), ['foreground', 'changes']);
    assert.equal(fixture.observations.length, 1);
    t.mock.timers.tick(2000); await flush();
    assert.deepEqual(fixture.commands.slice(6).map(value => value.kind), ['foreground', 'changes', 'observe', 'foreground']);
    assert.equal(fixture.observations.length, 2);
    fixture.monitor.stop(); t.mock.timers.tick(10000); await flush();
    assert.equal(fixture.commands.length, 10);
  } finally { fixture.monitor.stop(); }
});

test('failed watch and transport failure close the helper without exposing observations', async () => {
  for (const replies of [[foreground, health('subscription_failed', 'unsupported')], [foreground]]) {
    const fixture = setup(replies);
    try { await fixture.monitor.start('chrome'); assert.equal(fixture.observations.length, 0);
      assert.equal(fixture.closed(), 1); assert.ok(['unsupported', 'unavailable'].includes(fixture.statuses.at(-1)!.state));
    } finally { fixture.monitor.stop(); }
  }
});

test('region changes close the old session before a later bounded tick establishes a new scope', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const moved = { ...foreground, region: { ...region, x: 1 } } as ObserverEvent;
  const fixture = setup([foreground, health('watching'), observation, foreground, moved,
    moved, health('watching'), observation, moved]);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  try {
    await fixture.monitor.start('chrome');
    t.mock.timers.tick(2000); await flush();
    assert.equal(fixture.closed(), 1); assert.equal(fixture.commands.length, 5);
    assert.equal(fixture.statuses.at(-1)?.code, 'foreground_changed');
    t.mock.timers.tick(2000); await flush();
    assert.equal(fixture.created(), 2); assert.equal(fixture.observations.length, 2);
  } finally { fixture.monitor.stop(); }
});

test('restarting monitoring invalidates the earlier pending read', async () => {
  let resolve!: (event: ObserverEvent) => void;
  const pending = new Promise<ObserverEvent>(done => { resolve = done; });
  const edge = { ...foreground, processName: 'msedge' } as ObserverEvent;
  const fixture = setup([foreground, health('watching'), pending, edge, health('watching'), observation, edge]);
  const first = fixture.monitor.start('chrome');
  while (!fixture.commands.some(command => command.kind === 'observe')) await Promise.resolve();
  try {
    await fixture.monitor.start('msedge');
    resolve({ ...observation, revision: 99 }); await first;
    assert.deepEqual(fixture.observations, [observation]); assert.equal(fixture.closed(), 1);
  } finally { fixture.monitor.stop(); }
});
