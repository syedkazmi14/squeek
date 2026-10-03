import { createInterface } from 'node:readline';
const [mode, sessionId] = process.argv.slice(2);
const write = value => process.stdout.write(JSON.stringify({ version: 1, sessionId, ...value }) + '\n');
if (mode !== 'startup_timeout') write({ kind: 'ready' });
createInterface({ input: process.stdin }).on('line', line => {
  const command = JSON.parse(line);
  if (mode === 'timeout') return;
  if (mode === 'crash') return process.exit(1);
  if (mode === 'malformed') return process.stdout.write('private invalid content\n');
  if (mode === 'oversized') return process.stdout.write('x'.repeat(65537));
  if (command.kind === 'shutdown') { write({ kind: 'stopped' }); return process.exit(0); }
  if (command.kind === 'observe') {
    const observation = { kind: 'observation', source: command.source, revision: 1, observedAt: 123456789,
      provenance: 'accessibility', coverage: 'partial', spans: [] };
    if (mode === 'wrong_source') observation.source.processStartedAt++;
    write(observation);
  } else write({ kind: 'health', state: 'paused', code: 'paused' });
});
