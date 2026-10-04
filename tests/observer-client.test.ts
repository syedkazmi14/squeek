import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ObserverClient } from '../apps/desktop/src/main/observer-client.ts';

const fixture = fileURLToPath(new URL('./fixtures/fake-observer.mjs', import.meta.url));
const source = { processId: 1234, windowHandle: '5432', processStartedAt: 123456789 };
function client(mode = 'normal') {
  const sessionId = randomUUID();
  const child = spawn(process.execPath, [fixture, mode, sessionId], { stdio: 'pipe', windowsHide: true });
  return { sessionId, child, observer: new ObserverClient(child, sessionId, 500) };
}

test('bridge waits for startup and validates matching observations', async () => {
  const { observer, sessionId } = client();
  try {
    const value = await observer.request({ kind: 'observe', version: 1, sessionId, source, region: { x: 0, y: 0, width: 100, height: 100 } });
    assert.equal(value.kind, 'observation');
    if (value.kind === 'observation') assert.deepEqual(value.source, source);
    const stopped = await observer.request({ kind: 'shutdown', version: 1, sessionId });
    assert.equal(stopped.kind, 'stopped');
  } finally { observer.close(); }
});

test('bridge bounds pending requests and can cancel without retaining content', async () => {
  const { observer, sessionId } = client('timeout');
  const pending = observer.request({ kind: 'hello', version: 1, sessionId });
  await assert.rejects(observer.request({ kind: 'pause', version: 1, sessionId }), /busy/i);
  observer.close();
  await assert.rejects(pending, /closed/i);
});

test('bridge snapshots the approved source before awaiting helper startup', async () => {
  const { observer, sessionId } = client();
  const command = { kind: 'observe' as const, version: 1 as const, sessionId,
    source: { ...source }, region: { x: 0, y: 0, width: 100, height: 100 } };
  try {
    const pending = observer.request(command);
    command.source.processId = 9876;
    command.region.width = 500;
    const result = await pending;
    assert.equal(result.kind, 'observation');
    if (result.kind === 'observation') assert.deepEqual(result.source, source);
  } finally { observer.close(); }
});

for (const mode of ['malformed', 'oversized', 'wrong_source', 'timeout', 'crash', 'startup_timeout']) {
  test(`bridge fails closed on ${mode} with a sanitized error`, async () => {
    const { observer, sessionId, child } = client(mode);
    try {
      await assert.rejects(observer.request({ kind: 'observe', version: 1, sessionId, source,
        region: { x: 0, y: 0, width: 100, height: 100 } }), error => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /private invalid content/);
        return true;
      });
      // stdout can end before Node receives the process exit notification.
      if (child.exitCode === null && !child.killed) await once(child, 'close');
      assert.ok(child.killed || child.exitCode !== null);
    } finally { observer.close(); }
  });
}

test('bridge rejects stale revisions and forged commands', async () => {
  const { observer, sessionId } = client();
  try {
    await assert.rejects(observer.request({ kind: 'hello', version: 1, sessionId: randomUUID() }));
    const command = { kind: 'observe' as const, version: 1 as const, sessionId, source, region: { x: 0, y: 0, width: 100, height: 100 } };
    await observer.request(command);
    await assert.rejects(observer.request(command), /protocol/i);
  } finally { observer.close(); }
});

test('bridge accepts foreground metadata and watch/change replies', async () => {
 const {observer,sessionId}=client();
 try {
  const foreground=await observer.request({version:1,sessionId,kind:'foreground'});
  assert.equal(foreground.kind,'foreground');
  const watched=await observer.request({version:1,sessionId,kind:'watch',source,region:{x:0,y:0,width:100,height:100}});
  assert.equal(watched.kind,'health');
  const changed=await observer.request({version:1,sessionId,kind:'changes'});
  assert.equal(changed.kind,'health');
 } finally {observer.close();}
});

test('helper environment excludes provider credentials',async()=>{
 const {observerEnvironment}=await import('../apps/desktop/src/main/observer-client.ts');
 const env=observerEnvironment({SystemRoot:'C:/Windows',Path:'test-path',TEMP:'test-temp',TYPESAFE_API_KEY:'synthetic-secret',OTHER_TOKEN:'synthetic-secret'});
 assert.deepEqual(env,{SystemRoot:'C:/Windows',Path:'test-path',TEMP:'test-temp'});
});
