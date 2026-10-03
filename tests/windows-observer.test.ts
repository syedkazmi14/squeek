import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const executable = fileURLToPath(new URL('../artifacts/observer/Squeek.Observer.exe', import.meta.url));
async function run(commands: (id: string) => unknown[]) {
  const id = randomUUID();
  const child = spawn(executable, ['--session', id], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const output: Record<string, unknown>[] = [];
  const lines = createInterface({ input: child.stdout });
  const timer = setTimeout(() => child.kill(), 4000);
  try {
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    lines.on('line', line => output.push(JSON.parse(line)));
    for (const command of commands(id)) child.stdin.write(JSON.stringify(command) + '\n');
    child.stdin.end();
    assert.equal(await exited, 0);
    return { id, output };
  } finally { clearTimeout(timer); lines.close(); child.kill(); }
}
const command = (id: string, kind: string) => ({ version: 1, sessionId: id, kind });

test('native helper starts paused and exposes only a session-bound read-only protocol', { skip: process.platform !== 'win32' }, async () => {
  const { id, output } = await run(id => [command(id, 'hello'), command(id, 'pause'), command(id, 'shutdown')]);
  assert.deepEqual(output, [command(id, 'ready'), { ...command(id, 'health'), state: 'paused', code: 'not_monitoring' },
    { ...command(id, 'health'), state: 'paused', code: 'paused' }, command(id, 'stopped')]);
});

test('native helper rejects forged or unknown commands without reading content', { skip: process.platform !== 'win32' }, async () => {
  const { output } = await run(id => [command(randomUUID(), 'hello'), { ...command(id, 'hello'), path: 'cmd.exe' },
    command(id, 'execute'), command(id, 'shutdown')]);
  assert.deepEqual(output.slice(1, 4).map(frame => frame.code), ['invalid_command', 'invalid_command', 'invalid_command']);
  assert.ok(output.every(frame => frame.kind !== 'observation'));
});

test('native helper refuses a mismatched foreground source', { skip: process.platform !== 'win32' }, async () => {
  const { output } = await run(id => [{ ...command(id, 'observe'),
    source: { processId: 1, windowHandle: '1', processStartedAt: 1 },
    region: { x: 0, y: 0, width: 100, height: 100 } }, command(id, 'shutdown')]);
  assert.equal(output[1]?.kind, 'health');
  assert.equal(output[1]?.state, 'unsupported');
  assert.equal(output[1]?.code, 'foreground_mismatch');
});

test('native helper bounds command size and exits on truncated oversized input', { skip: process.platform !== 'win32' }, async () => {
  const { output } = await run(id => [{ ...command(id, 'hello'), data: 'x'.repeat(65536) }]);
  assert.equal(output[1]?.code, 'invalid_command');
  assert.ok(output.every(frame => frame.kind !== 'observation'));
});
