import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { assess } from '../packages/detection/src/index.ts';
import { observation } from './fixtures/observation.ts';

const root = new URL('../packages/detection/src/', import.meta.url);

// URL objects are passed straight through to readFile rather than converted
// via path.join(dir.pathname, ...): on Windows, URL#pathname keeps the
// leading slash before the drive letter (e.g. "/C:/Users/..."), and joining
// that with path.join produces a corrupted, doubled-drive path.
async function files(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...await files(new URL(entry.name + '/', dir)));
    else if (entry.name.endsWith('.ts')) out.push(new URL(entry.name, dir));
  }
  return out;
}

test('detection imports nothing beyond contracts and node:crypto', async () => {
  const allowed = /^(?:\.{1,2}\/|node:crypto$)/;
  for (const file of await files(root)) {
    const source = (await readFile(file, 'utf8')).replace(/import\s+type[\s\S]*?from\s+["'][^"']+["'];?/g, '');
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      assert.ok(allowed.test(specifier), `${file} imports ${specifier}`);
      if (specifier.startsWith('.'))
        assert.ok(!/providers|desktop|windows-observer/.test(specifier),
          `${file} reaches outside detection: ${specifier}`);
    }
  }
});

test('pathological input cannot stall assessment', async () => {
  const hostile = 'send ' + 'a '.repeat(3000) + 'money';
  const start = performance.now();
  await assess(observation(hostile));
  assert.ok(performance.now() - start < 250, 'assessment exceeded 250ms');
});
