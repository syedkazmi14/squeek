import { createObserverClient } from '../apps/desktop/src/main/observer-client.ts';
import type { ObserverCommand, ObserverEvent } from '../packages/contracts/src/observation.ts';
import { parseCommand } from '../packages/contracts/src/protocol.ts';

// Default is a health check. Content extraction requires an explicit exact source and region.
const args = process.argv.slice(2);
if (args.length !== 0 && !(args.length === 3 && args[0] === '--observe')) {
  console.error('Usage: npm.cmd run observer:probe [-- --observe <source-json> <region-json>]');
  process.exitCode = 1;
} else {
  const { observer, sessionId } = createObserverClient();
  try {
    let command: ObserverCommand = { kind: 'hello', version: 1, sessionId };
    if (args[0] === '--observe') {
      command = parseCommand(JSON.stringify({ kind: 'observe', version: 1, sessionId,
        source: JSON.parse(args[1]!), region: JSON.parse(args[2]!) }), sessionId);
    }
    const result: ObserverEvent = await observer.request(command);
    if (result.kind === 'observation') {
      console.log(JSON.stringify({ kind: result.kind, coverage: result.coverage, revision: result.revision,
        spanCount: result.spans.length, characterCount: result.spans.reduce((count, span) => count + span.text.length, 0) }));
    } else console.log(JSON.stringify(result));
    await observer.request({ kind: 'shutdown', version: 1, sessionId });
  } catch {
    console.error('Observer probe unavailable. Check the build and supplied scope.');
    process.exitCode = 1;
  } finally { observer.close(); }
}
