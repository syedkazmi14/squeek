// The call gate's decision. Run: deno test --allow-read supabase/tests/safeword_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { safeWordHash } from "../functions/_shared/calls.ts";
import { decideGate, MAX_WRONG_PER_HOUR } from "../functions/_shared/safeword.ts";

const HOUSEHOLD = "11111111-1111-1111-1111-111111111111";
const words = async () => [{ householdId: HOUSEHOLD, hash: await safeWordHash(HOUSEHOLD, "Blue Moon") }];

Deno.test("the right word opens the gate, however it is said", async () => {
  for (const said of ["blue moon", "Blue  Moon!", "  BLUE MOON "]) {
    const d = await decideGate(said, await words(), 0);
    assertEquals(d.match, true, said);
    assertEquals(d.countAsWrong, false);
  }
});

Deno.test("a wrong word stays shut and counts against the line", async () => {
  const d = await decideGate("pizza", await words(), 0);
  assertEquals({ match: d.match, locked: d.locked, wrong: d.countAsWrong }, { match: false, locked: false, wrong: true });
});

Deno.test("saying nothing, or having no word set, never opens the gate", async () => {
  assertEquals((await decideGate(null, await words(), 0)).match, false);
  assertEquals((await decideGate("", await words(), 0)).match, false);
  assertEquals((await decideGate("blue moon", [], 0)).match, false);
});

Deno.test("too many wrong tries lock the line, even for the right word", async () => {
  const d = await decideGate("blue moon", await words(), MAX_WRONG_PER_HOUR);
  assertEquals({ match: d.match, locked: d.locked, wrong: d.countAsWrong }, { match: false, locked: true, wrong: false });
  assertEquals((await decideGate("blue moon", await words(), MAX_WRONG_PER_HOUR - 1)).match, true);
});
