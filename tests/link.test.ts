import test from "node:test";
import assert from "node:assert/strict";
import {
  assessLink,
  linkMessage,
  registrableDomain,
} from "../packages/detection/src/link.ts";

test("ordinary links carry no signal", () => {
  for (const url of [
    "https://www.paypal.com/signin",
    "https://accounts.google.com/ServiceLogin",
    "https://en.wikipedia.org/wiki/Phishing",
    "https://www.bbc.co.uk/news",
    "mailto:friend@example.com",
  ]) assert.equal(assessLink(url).state, "no_detected_signal", url);
});

test("a brand's name on someone else's site is high risk", () => {
  const result = assessLink("https://paypal-secure-login.com/verify");
  assert.equal(result.state, "high_risk");
  assert.equal(result.reasons[0]?.ruleId, "brand_impersonation");
  assert.equal(assessLink("https://apple.com.account-check.xyz/").state, "high_risk");
});

test("link text naming a different site than the real address is high risk", () => {
  const result = assessLink("https://evil.example.net/", "www.chase.com");
  assert.equal(result.state, "high_risk");
  assert.match(result.reasons[0]!.message, /says chase\.com but really goes to evil\.example\.net/);
  assert.equal(assessLink("https://www.chase.com/login", "chase.com").state, "no_detected_signal");
});

test("disguised addresses are high risk", () => {
  assert.equal(assessLink("https://www.google.com@phish.example/").state, "high_risk");
  assert.equal(assessLink("http://192.168.4.20/login").state, "high_risk");
  assert.equal(assessLink("https://xn--pypal-4ve.com/").state, "high_risk");
  assert.equal(assessLink("javascript:alert(1)").state, "high_risk");
});

test("weak signs alone are caution, together they are high risk", () => {
  assert.equal(assessLink("https://bit.ly/3abcd").state, "caution");
  assert.equal(assessLink("https://prize-winner.top/").state, "caution");
  assert.equal(
    assessLink("http://secure-login.account-update.click/").state,
    "high_risk",
  );
});

test("unparseable links are unknown", () => {
  assert.equal(assessLink("not a url").state, "unknown");
});

test("registrable domain handles shared country suffixes", () => {
  assert.equal(registrableDomain("login.paypal.co.uk"), "paypal.co.uk");
  assert.equal(registrableDomain("a.b.example.com"), "example.com");
});

test("messages lead with the strongest reason", () => {
  assert.match(
    linkMessage(assessLink("https://paypal-secure-login.com/")),
    /^Careful, this link looks like a scam\. It pretends to be PayPal/,
  );
  assert.equal(
    linkMessage(assessLink("https://www.wikipedia.org/")),
    "This link goes to wikipedia.org. It looks OK.",
  );
});
