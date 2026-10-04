import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation } from '../packages/contracts/src/observation.ts';
import { assess } from '../packages/detection/src/index.ts';
import { segment } from '../packages/detection/src/segment.ts';

type Span = Observation['spans'][number];
const span = (text: string, x: number, y: number, width: number, height = 20): Span => ({ text, rect: { x, y, width, height } });
const page = (spans: Span[]): Observation => ({ version: 1, sessionId: 'test', kind: 'observation', source: { processId: 1, windowHandle: '1', processStartedAt: 1 }, revision: 1, observedAt: 0, provenance: 'accessibility', coverage: 'complete', spans });
// One inbox row: sender, subject and snippet, date at the far right, as Gmail lays it out.
const row = (index: number, sender: string, subject: string, date = 'Oct 3') => {
  const y = 200 + index * 40;
  return [span(sender, 100, y, 180), span(subject, 300, y, 560), span(date, 900, y, 60)];
};

test('each inbox row is its own unit; paragraphs of one email stay together', () => {
  assert.deepEqual(segment([...row(0, 'a', 'b'), ...row(1, 'c', 'd')].map(s => s.rect)), [0, 0, 0, 1, 1, 1]);
  const body = [span('Dear taxpayer,', 400, 300, 120), span('This is the IRS. You owe back taxes.', 400, 336, 600, 40), span('Pay $500 today.', 400, 392, 140)];
  assert.deepEqual(segment(body.map(s => s.rect)), [0, 0, 0]);
});

test('words from neighbouring emails do not combine into a warning', async () => {
  const result = await assess(page([
    ...row(0, 'IRS Free File', 'Your tax return was accepted'),
    ...row(1, 'Acme Billing', 'Invoice 1042 - please pay $500 by Friday'),
    ...row(2, 'Garden Shop', 'Spring sale ends today'),
  ]));
  assert.notEqual(result.state, 'high_risk');
  assert.ok(!result.evidence.some(e => /IRS|today/.test(e.excerpt)), JSON.stringify(result.evidence));
});

test('a scam row in an inbox is flagged with evidence from that row only', async () => {
  const spans = [
    ...row(0, 'Mom', 'Dinner on Sunday?'),
    ...row(1, 'IRS Department', 'This is the IRS. Pay $500 in gift cards immediately or face arrest.'),
    ...row(2, 'Acme Billing', 'Invoice 1042 is ready, total $45.99 today'),
  ];
  const result = await assess(page(spans));
  assert.equal(result.state, 'high_risk');
  assert.ok(result.evidence.length > 0);
  assert.ok(result.evidence.every(e => e.spanIndex >= 3 && e.spanIndex <= 5), JSON.stringify(result.evidence));
});

test('a scam spread over paragraphs of one email is still high risk', async () => {
  const result = await assess(page([
    span('This is the IRS. You will face arrest today unless you pay immediately.', 400, 300, 600),
    span('Buy $500 in gift cards and send the codes to our agent.', 400, 336, 520),
  ]));
  assert.equal(result.state, 'high_risk');
});

test('stray matches are not shown as evidence when nothing is wrong', async () => {
  const result = await assess(page([span('IRS announces new filing dates for today', 0, 0, 400)]));
  assert.equal(result.state, 'no_detected_signal');
  assert.deepEqual(result.evidence, []);
});

test('a Gmail inbox like the one in the bug report raises nothing', async () => {
  const result = await assess(page([
    ...row(0, 'Vultr Support', 'Vultr.com - Password Recovery - Log In Vultr Customer'),
    ...row(1, 'Spotify', '845854 - Your Spotify login code'),
    ...row(2, 'SheerID Verification', 'Verify your student status for $100 in credits to use in Codex'),
    ...row(3, 'SheerID Verification', 'Your offer is here! Click the following link to finish'),
    ...row(4, 'Major League Hacking', 'Your MyMLH One-Time Login Code is 172927'),
    ...row(5, 'Jobright Job Alert', 'Software Engineer Intern 2027 (USA) role 31 minutes ago - $8250/mo'),
  ]));
  assert.equal(result.state, 'no_detected_signal');
  assert.deepEqual(result.evidence, []);
});

import { focusObservation } from '../packages/detection/src/focus.ts';
const inbox = () => page([
  span('Inbox', 120, 100, 60), span('9,198', 340, 100, 40),
  ...row(0, 'me', 'Final notice - This is the IRS. Buy $500 in gift cards and send the codes immediately.'),
  ...row(1, 'Vultr Support', 'Password Recovery - Log In Vultr Customer'),
  ...row(2, 'Spotify', '845854 - Your Spotify login code'),
  ...row(3, 'SheerID Verification', 'Verify your student status for $100 in credits'),
]);

test('in an inbox only the hovered row is judged', async () => {
  const onScam = focusObservation(inbox(), { x: 500, y: 210 });
  assert.equal((await assess(onScam.observation)).state, 'high_risk');
  const onOther = focusObservation(inbox(), { x: 500, y: 250 });
  assert.notEqual(onOther.key, onScam.key);
  const other = await assess(onOther.observation);
  assert.equal(other.state, 'no_detected_signal');
  assert.deepEqual(other.evidence, []);
  const away = focusObservation(inbox(), { x: 1500, y: 700 });
  assert.equal(away.key, 'none');
  assert.equal((await assess(away.observation)).state, 'no_detected_signal');
});

test('an opened email is judged whole wherever the cursor is', async () => {
  const email = page([
    span('Final notice', 400, 150, 200, 30),
    span('This is the IRS. You will face arrest today unless you act immediately.', 400, 300, 600),
    span('Buy $500 in gift cards and send the codes to our agent.', 400, 336, 520),
  ]);
  const focused = focusObservation(email, { x: 10, y: 10 });
  assert.equal(focused.key, 'page');
  assert.equal((await assess(focused.observation)).state, 'high_risk');
});

test('the hovered row is reported so Squeek can offer to open it', () => {
  const onRow = focusObservation(inbox(), { x: 500, y: 250 });
  assert.equal(onRow.row?.[0], 'Vultr Support');
  assert.equal(focusObservation(inbox(), { x: 1500, y: 700 }).row, undefined);
});
