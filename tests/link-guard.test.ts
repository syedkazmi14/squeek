import test from "node:test";
import assert from "node:assert/strict";
import { LinkGuard, type LinkView } from "../apps/desktop/src/main/link-guard.ts";

function setup() {
  const shown: (LinkView | undefined)[] = [];
  const said: string[] = [];
  const spoken: string[] = [];
  const opened: string[] = [];
  let cursor = { x: 15, y: 15 };
  let now = 0;
  const guard = new LinkGuard({
    toDip: (rect) => rect,
    cursor: () => cursor,
    show: (view) => shown.push(view),
    say: (text) => said.push(text),
    speak: (text) => spoken.push(text),
    open: (url) => opened.push(url),
    now: () => now,
  });
  return {
    guard, shown, said, spoken, opened,
    move: (x: number, y: number) => { cursor = { x, y }; },
    later: (ms: number) => { now += ms; },
  };
}
const rect = { x: 10, y: 10, width: 100, height: 20 };
const scam = { url: "https://paypal-secure-login.com/verify", text: "Log in to PayPal", rect };
const safe = { url: "https://en.wikipedia.org/wiki/Phishing", text: "Phishing", rect };

test("a safe link is spoken with a short bubble and no guard", () => {
  const f = setup();
  f.guard.hover(safe);
  assert.deepEqual(f.said, ["This link goes to en.wikipedia.org. It looks OK."]);
  assert.deepEqual(f.spoken, ["This link goes to en.wikipedia.org. It looks OK."]);
  assert.equal(f.shown.at(-1), undefined);
  assert.equal(f.guard.choose("ask"), false);
});

test("a risky link is spoken once, guarded, and opens only after confirming", () => {
  const f = setup();
  f.guard.hover(scam);
  assert.equal(f.spoken.length, 1);
  assert.equal(f.shown.at(-1)?.guarded, true);
  assert.equal(f.shown.at(-1)?.state, "high_risk");
  // Opening without the confirmation card first is refused.
  assert.equal(f.guard.choose("open"), false);
  assert.equal(f.guard.choose("ask"), true);
  // The overlay now holds the cursor, so the observer reports no link; the warning stays.
  f.move(500, 500);
  f.guard.hover(undefined);
  assert.equal(f.shown.at(-1)?.guarded, true);
  assert.equal(f.guard.choose("open"), true);
  assert.deepEqual(f.opened, [scam.url]);
  assert.equal(f.shown.at(-1), undefined);
  // Once allowed, hovering it again warns but no longer holds the click.
  f.guard.hover(scam);
  assert.equal(f.shown.at(-1)?.guarded, false);
});

test("going back keeps the guard while the cursor is still on the link", () => {
  const f = setup();
  f.guard.hover(scam);
  f.guard.choose("ask");
  assert.equal(f.guard.choose("back"), true);
  f.guard.hover(undefined);
  assert.equal(f.shown.at(-1)?.guarded, true);
  f.move(500, 500);
  f.guard.hover(undefined);
  assert.equal(f.shown.at(-1), undefined);
  assert.deepEqual(f.opened, []);
});

test("the voice does not repeat when hovering the same link again soon", () => {
  const f = setup();
  f.guard.hover(scam);
  f.move(500, 500);
  f.guard.hover(undefined);
  f.later(5000);
  f.guard.hover(scam);
  assert.equal(f.spoken.length, 1);
  f.move(500, 500);
  f.guard.hover(undefined);
  f.later(30000);
  f.guard.hover(scam);
  assert.equal(f.spoken.length, 2);
});

test("script links are never opened", () => {
  const f = setup();
  f.guard.hover({ url: "javascript:void(steal())", text: "Claim prize", rect });
  assert.equal(f.shown.at(-1)?.canOpen, false);
  f.guard.choose("ask");
  assert.equal(f.guard.choose("open"), false);
  assert.deepEqual(f.opened, []);
});

test("clicks are held only on a guarded link's ring or the open card", () => {
  const f = setup();
  f.guard.hover(safe);
  assert.equal(f.guard.holdsClick({ x: 15, y: 15 }), false);
  f.guard.hover(scam);
  assert.equal(f.guard.holdsClick({ x: 15, y: 15 }), true);
  assert.equal(f.guard.holdsClick({ x: 7, y: 7 }), true, "the ring's padding counts");
  assert.equal(f.guard.holdsClick({ x: 300, y: 300 }), false);
  const card = { x: 10, y: 50, width: 300, height: 150 };
  f.guard.setCard(card);
  assert.equal(f.guard.holdsClick({ x: 100, y: 100 }), false, "no card before the user asks");
  f.guard.choose("ask");
  f.guard.setCard(card);
  assert.equal(f.guard.holdsClick({ x: 100, y: 100 }), true);
  f.guard.choose("back");
  assert.equal(f.guard.holdsClick({ x: 100, y: 100 }), false);
});
