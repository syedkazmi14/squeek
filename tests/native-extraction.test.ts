import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// This test owns its entire synthetic surface and never asks for another window's content.
function endpoint(relative: string, args: string[] = []) {
  const child = spawn(fileURLToPath(new URL(relative, import.meta.url)), args,
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const queue: unknown[] = [];
  let pending: ((value: any) => void) | undefined;
  let failure: ((error: Error) => void) | undefined;
  child.on('error', error => failure?.(error));
  lines.on('line', line => { const value = JSON.parse(line); if (pending) { const done = pending; pending = undefined; done(value); } else queue.push(value); });
  const next = () => queue.length ? Promise.resolve(queue.shift() as any) : new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { pending = undefined; failure = undefined; reject(new Error('Synthetic endpoint timed out')); }, 10000);
    pending = value => { clearTimeout(timer); failure = undefined; resolve(value); };
    failure = error => { clearTimeout(timer); pending = undefined; reject(error); };
  });
  return { child, next, close: () => { lines.close(); child.kill(); } };
}

test('native extraction filters controlled WPF content and obeys physical region and identity', { skip: process.platform !== 'win32' }, async t => {
  const fixture = endpoint('../artifacts/windows-fixture/Squeek.Fixture.exe');
  const id = randomUUID();
  const observer = endpoint('../artifacts/observer/Squeek.Observer.exe', ['--session', id]);
  const send = async (kind: string, extra = {}) => {
    observer.child.stdin.write(JSON.stringify({ kind, version: 1, sessionId: id, ...extra }) + '\n');
    return observer.next();
  };
  try {
    const owned = await fixture.next();
    await observer.next();
    if (!owned.foreground) { t.skip('Windows refused foreground activation of the owned WPF fixture'); return; }
    const scope = { source: owned.source, region: owned.region };
    const result = await send('observe', scope);
    assert.equal(result.kind, 'observation');
    assert.deepEqual(result.spans.map((span: any) => span.text).sort(), ['Synthetic outside region text', 'Synthetic visible fixture text']);
    const narrow = await send('observe', { source: owned.source, region: owned.narrow });
    assert.deepEqual(narrow.spans.map((span: any) => span.text), ['Synthetic visible fixture text']);
    const stale = await send('observe', { ...scope, source: { ...owned.source, processStartedAt: owned.source.processStartedAt + 1 } });
    assert.equal(stale.code, 'foreground_mismatch');
    const outside = await send('observe', { ...scope, region: { ...owned.region, width: owned.region.width + 1 } });
    assert.equal(outside.code, 'region_outside_window');
    const metadata = await send('foreground');
    assert.equal(metadata.kind, 'foreground');
    assert.equal(metadata.processName, 'Squeek.Fixture');
    assert.deepEqual(metadata.source, owned.source);
    assert.deepEqual(Object.keys(metadata).sort(), ['kind', 'processName', 'region', 'sessionId', 'source', 'version']);
    assert.equal((await send('watch', scope)).code, 'watching');
    assert.equal((await send('changes')).code, 'unchanged');
    fixture.child.stdin.write('change\n');
    let changed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if ((await send('changes')).code === 'changed') { changed = true; break; }
    }
    assert.equal(changed, true, 'UIA property/text changes must mark the scoped watch dirty');
    assert.equal((await send('pause')).code, 'paused');
    assert.equal((await send('changes')).code, 'foreground_changed');
    assert.equal((await send('watch', scope)).code, 'watching');
    const exited = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned fixture shutdown timed out')), 10000);
      fixture.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    fixture.child.stdin.write('close\n');
    await exited;
    assert.equal((await send('changes')).code, 'foreground_changed');
    assert.equal((await send('shutdown')).kind, 'stopped');
  } finally { if (fixture.child.exitCode === null) fixture.child.stdin.write('close\n'); fixture.close(); observer.close(); }
});
