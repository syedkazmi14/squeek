import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Observation } from '../packages/contracts/src/observation.ts';
import { extractSender, senderChecks, rememberSender } from '../packages/detection/src/sender.ts';

const span = (text: string, x: number, y: number, width = 200, height = 20) => ({ text, rect: { x, y, width, height } });
const page = (spans: Observation['spans']): Observation => ({ version: 1, sessionId: 'test', kind: 'observation', source: { processId: 1, windowHandle: '1', processStartedAt: 1 }, revision: 1, observedAt: 0, provenance: 'accessibility', coverage: 'complete', spans });
const ids = (checks: { id: string }[]) => checks.map(c => c.id);

test('reads the sender from an opened Gmail email, not from addresses in the body', () => {
  const sender = extractSender(page([
    span('Final notice', 400, 150),
    span('IRS Department', 400, 200, 140), span('<irs.refunds@gmail.com>', 550, 200, 200), span('3:17 AM', 1600, 200, 60),
    span('Write to support@example.com with questions.', 400, 300, 600),
  ]));
  assert.deepEqual(sender, { name: 'IRS Department', address: 'irs.refunds@gmail.com', domain: 'gmail.com' });
  assert.equal(extractSender(page([span('Contact us at help@example.com today', 0, 0)])), undefined);
  assert.equal(extractSender(page([span('SheerID Verification <Verify@sheerid.com>', 0, 0)]))?.address, 'verify@sheerid.com');
});

test('flags a brand or authority name sent from the wrong address', () => {
  assert.deepEqual(ids(senderChecks({ name: 'IRS Department', address: 'irs.refunds@gmail.com', domain: 'gmail.com' })), ['brand_mismatch', 'org_on_free_mail']);
  assert.ok(ids(senderChecks({ name: 'PayPal Service', address: 'alert@paypal-secure-help.com', domain: 'paypal-secure-help.com' })).includes('brand_mismatch'));
  assert.ok(ids(senderChecks({ name: 'Billing Team', address: 'x@account-alerts.xyz', domain: 'account-alerts.xyz' })).includes('risky_ending'));
  assert.deepEqual(ids(senderChecks({ name: 'PayPal', address: 'service@mail.paypal.com', domain: 'paypal.com' })), ['brand_match']);
});

test('a familiar name writing from a new address is the friend-scam warning', () => {
  let known = rememberSender({}, { name: 'Ryan Smith', address: 'ryan.smith@gmail.com', domain: 'gmail.com' });
  const scam = senderChecks({ name: 'Ryan Smith', address: 'ryansmith.help88@outlook.com', domain: 'outlook.com' }, known);
  assert.ok(ids(scam).includes('new_address_for_name'));
  assert.ok(scam.find(c => c.id === 'new_address_for_name')!.text.includes('ryan.smith@gmail.com'));
  assert.ok(ids(senderChecks({ name: 'Ryan Smith', address: 'ryan.smith@gmail.com', domain: 'gmail.com' }, known)).includes('known_sender'));
  known = rememberSender(known, { name: 'Ryan Smith', address: 'ryan.smith@gmail.com', domain: 'gmail.com' });
  assert.deepEqual(known['ryan smith'], ['ryan.smith@gmail.com']);
});

test('ordinary senders get no warnings', () => {
  for (const sender of [
    { name: 'Vultr Support', address: 'support@vultr.com', domain: 'vultr.com' },
    { name: 'SheerID Verification', address: 'verify@sheerid.com', domain: 'sheerid.com' },
    { name: 'Mom', address: 'mary.jones@gmail.com', domain: 'gmail.com' },
  ]) assert.ok(!senderChecks(sender).some(c => c.tone === 'warn'), sender.name);
});

import { createDomainFacts } from '../apps/desktop/src/main/domain-facts.ts';
test('a domain registered days ago is flagged; personal mail services are not looked up', async () => {
  const now = Date.parse('2026-10-04T00:00:00Z');
  const requests: string[] = [];
  const fakeFetch = (async (url: string) => {
    requests.push(url);
    if (url.includes('iana.org')) return Response.json({ services: [[['com'], ['https://rdap.example/']]] });
    return Response.json({ events: [{ eventAction: 'registration', eventDate: '2026-09-30T00:00:00Z' }] });
  }) as typeof fetch;
  const facts = await createDomainFacts(fakeFetch, () => now).lookup('paypal-refunds-desk.com');
  const age = facts.find(f => f.id === 'new_domain');
  assert.ok(age && age.tone === 'warn' && age.text.includes('4 days'), JSON.stringify(facts));
  requests.length = 0;
  assert.deepEqual(await createDomainFacts(fakeFetch, () => now).lookup('gmail.com'), []);
  assert.deepEqual(requests, []);
});

test('Gmail shows only the name above "to me"; the address is read from the hover card when shown', () => {
  const header = [span('old friend from middle school', 97, 90, 360, 30), span('Rishi Golla', 97, 150, 90), span('to me', 97, 178, 50), span('Dear Ryan,', 97, 212, 80)];
  assert.deepEqual(extractSender(page(header)), { name: 'Rishi Golla', address: '', domain: '' });
  assert.deepEqual(ids(senderChecks({ name: 'Rishi Golla', address: '', domain: '' })), ['address_hidden']);
  const card = [span('Rishi Golla', 727, 634, 200, 30), span('rishi.golla@gmail.com', 727, 666, 200)];
  assert.equal(extractSender(page([...header, ...card]))?.address, 'rishi.golla@gmail.com');
});

import { looksLikePerson } from '../packages/detection/src/sender.ts';
test('people are told apart from companies for the sender lookup', () => {
  for (const name of ['Rishi Golla', 'Mary Ann Jones', "Seán O'Brien"]) assert.ok(looksLikePerson(name), name);
  for (const name of ['Vultr Support', 'PayPal Service', 'Spotify', 'SheerID Verification', 'Google 2', 'IRS Department']) assert.ok(!looksLikePerson(name), name);
});
