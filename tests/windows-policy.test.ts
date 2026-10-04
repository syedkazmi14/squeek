import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('native policy excludes editable/protected ancestors and invalid regions', { skip: process.platform !== 'win32' }, () => {
  const local = fileURLToPath(new URL('../.tools/dotnet/dotnet.exe', import.meta.url));
  const dll = fileURLToPath(new URL('../artifacts/observer-policy-tests/Observer.Policy.Tests.dll', import.meta.url));
  const result = spawnSync(existsSync(local) ? local : 'dotnet', [dll], { windowsHide: true, timeout: 4000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS 15 native policy assertions/);
});
