import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess } from '../packages/detection/src/index.ts';
import { observation } from './fixtures/observation.ts';

const flagged = ['caution', 'high_risk'];
test('local rules catch scam types beyond the obvious ones', async () => {
  for (const [text, expected] of [
    ['I have recently fallen on hard times and find myself in dire need of financial assistance. If you can help me out with a loan of $5900 I would be grateful. It is urgent.', 'high_risk'],
    ['This is the fraud department. Your account is compromised; move your money to a safe account today.', 'high_risk'],
    ['Your Norton subscription has been charged $399.99. To cancel, call our support team at 1-888-555-0199.', 'high_risk'],
    ['Congratulations, you have won $1,500,000 in the sweepstakes. Pay the small fee to release your prize.', 'high_risk'],
    ['I recorded you through your webcam. Pay $1200 in bitcoin or I send the video to all your contacts.', 'high_risk'],
    ['My love, I found an investment opportunity with guaranteed returns on this trading platform. Just buy crypto.', 'high_risk'],
    ['Grandma, I lost my phone and I am in trouble. Please buy gift cards and send me the codes.', 'high_risk'],
    ['You have an unpaid toll balance of $6.99. Pay today to avoid penalties.', 'caution'],
    ['Hi, could you lend me some money? I am in a bit of trouble.', 'caution'],
  ] as const) {
    const state = (await assess(observation(text))).state;
    assert.ok(expected === 'high_risk' ? state === 'high_risk' : flagged.includes(state), `${text} -> ${state}`);
  }
});

test('ordinary messages with the same words stay quiet', async () => {
  for (const text of [
    'Your subscription renewal is on May 3. Manage it in your account settings.',
    'Thanks for the loan of your ladder last weekend!',
    'Our office is closed today. In an emergency, call 911.',
    'The winner of the bake-off gets a ribbon.',
    'Your order confirmation: 2 items, total $45.99. Questions? Visit our help center.',
  ]) assert.equal((await assess(observation(text))).state, 'no_detected_signal', text);
});
