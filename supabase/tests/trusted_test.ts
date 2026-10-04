// Run: deno test --allow-read supabase/tests/trusted_test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { checkInText, escalationText } from "../functions/_shared/trusted.ts";

Deno.test("escalation names the person and says to call now", () => {
  const text = escalationText("Syed", "call");
  assertEquals(text, "Squeek here. Syed is about to pay someone after a call that looked like a scam. You might want to call them now.");
});

Deno.test("escalation does not claim a call for other warnings", () => {
  assertStringIncludes(escalationText("Syed", "sms"), "after something that looked like a scam");
});

Deno.test("escalation copes with no name", () => {
  assertStringIncludes(escalationText(null, "call"), "Someone you look out for is about to pay");
});

Deno.test("check-in names the helper", () => {
  const text = checkInText("Aisha");
  assertStringIncludes(text, "Aisha is checking in on you");
  assertStringIncludes(text, "call Aisha");
});

Deno.test("check-in copes with no name", () => {
  assertStringIncludes(checkInText(null), "Someone who looks out for you is checking in");
});
