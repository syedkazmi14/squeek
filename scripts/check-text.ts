// Developer probe: assess text from the command line or stdin using the local
// rules only, with no provider, observer, or Electron involvement.
import { assess } from "../packages/detection/src/index.ts";
import type { Observation } from "../packages/contracts/src/observation.ts";

async function read(): Promise<string> {
  const args = process.argv.slice(2);
  if (args.length) return args.join(" ");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
const text = (await read()).trim();
if (!text) {
  console.error('Usage: node scripts/check-text.ts "text"  |  ... | node scripts/check-text.ts');
  process.exit(2);
}
const observation: Observation = {
  version: 1, kind: "observation", sessionId: "check-text",
  source: { processId: 1, windowHandle: "1", processStartedAt: 1 },
  revision: 1, observedAt: 0, provenance: "accessibility", coverage: "complete",
  spans: text.split(/\n+/).filter(line => line.trim()).map((line, index) => ({
    text: line, rect: { x: 0, y: index * 20, width: 300, height: 20 },
  })),
};
const result = await assess(observation);
console.log(`state     ${result.state}`);
console.log(`coverage  ${result.coverage}`);
for (const item of result.evidence)
  console.log(`evidence  ${item.ruleId.padEnd(14)} span ${item.spanIndex}  "${item.excerpt}"`);
if (!result.evidence.length) console.log("evidence  (none)");
