import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { parseCommand, parseEvent, sameSource } from '../packages/contracts/src/protocol.ts';

// Playwright owns a fresh browser process/profile; no existing browser is attached.
// Native text requests are permitted only after its foreground PID is confirmed.
function nativeSession() {
  const sessionId = randomUUID();
  const child = spawn(fileURLToPath(new URL('../artifacts/observer/Squeek.Observer.exe', import.meta.url)),
    ['--session', sessionId], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  const diagnosticLines = createInterface({ input: child.stderr });
  const diagnostics = [];
  diagnosticLines.on('line', value => { if (/^[A-Za-z]{1,80}$/.test(value)) diagnostics.push(value); });
  const context = { sessionId, lastRevision: 0 };
  const queue = [];
  let pending;
  let failed;
  function fail(error) { failed = error; pending?.reject(error); pending = undefined; }
  child.on('error', () => fail(new Error('Owned helper launch failed')));
  child.on('exit', () => fail(new Error('Owned helper exited')));
  lines.on('line', line => {
    try {
      const event = parseEvent(line, context);
      if (event.kind === 'observation') context.lastRevision = event.revision;
      if (pending) { const waiter = pending; pending = undefined; waiter.resolve(event); } else queue.push(event);
    } catch { fail(new Error('Owned helper protocol failed')); }
  });
  function next() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (failed) return Promise.reject(failed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = undefined; reject(new Error('Owned helper timed out')); }, 4000);
      pending = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    });
  }
  return {
    ready: next,
    diagnostics,
    request: async (kind, extra = {}) => {
      const command = { kind, version: 1, sessionId, ...extra };
      parseCommand(JSON.stringify(command), sessionId);
      if (kind === 'observe') context.source = { ...command.source }; else delete context.source;
      child.stdin.write(JSON.stringify(command) + '\n');
      return next();
    },
    close: () => { lines.close(); diagnosticLines.close(); child.kill(); },
  };
}
async function foregroundOwnedProcess(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SqueekOwnedFocus { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid); }'
$ownedProcess = Get-Process -Id ${pid} -ErrorAction Stop
$ownedHandle = $ownedProcess.MainWindowHandle
[uint32]$ownedWindowPid = 0
if ($ownedHandle -ne [IntPtr]::Zero) {
  [SqueekOwnedFocus]::GetWindowThreadProcessId($ownedHandle, [ref]$ownedWindowPid) | Out-Null
  if ($ownedWindowPid -eq ${pid}) { if ([SqueekOwnedFocus]::SetForegroundWindow($ownedHandle)) { Write-Output 'requested' } else { Write-Output 'refused' } } else { Write-Output 'owner_mismatch' }
} else { Write-Output 'no_owned_window' }`;
  try { const activation = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 5000, maxBuffer: 4096 }); return /^[a-z_]+\s*$/.test(activation.stdout) ? activation.stdout.trim() : 'invalid_activation_result'; } catch { /* A refused activation is handled by foreground metadata. */ }
}
const initialText = 'Squeek synthetic native static text';
const changedText = 'Squeek synthetic native changed text';
const backgroundMarker = 'SQUEEK_BACKGROUND_TAB_EXCLUDED_8492';
const editableMarker = 'SQUEEK_EDITABLE_EXCLUDED_2861';
const passwordMarker = 'SQUEEK_PASSWORD_EXCLUDED_3074';
const content = `<html><head><title>Squeek synthetic native fixture</title></head><body>
<p id="static">${initialText}</p>
<input aria-label="${editableMarker}" value="${editableMarker}">
<input type="password" aria-label="${passwordMarker}" value="${passwordMarker}">
</body></html>`;

test('owned Chrome native extraction without accessibility flags', { skip: process.platform !== 'win32', timeout: 35000 }, async t => {
  let server, browser, native;
  try {
    server = await chromium.launchServer({ channel: 'chrome', headless: false });
    const ownedPid = server.process()?.pid;
    assert.ok(ownedPid, 'Fresh Chrome browser PID must be known');
    browser = await chromium.connect(server.wsEndpoint());
    t.diagnostic('Controlled browser version: ' + browser.version() + '; headed, no force-accessibility flags');
    const context = await browser.newContext();
    // Prevent accidental external navigation; these pages contain only synthetic local content.
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(content);
    const background = await context.newPage();
    await background.setContent(`<html><head><title>Squeek synthetic background</title></head><body><p>${backgroundMarker}</p></body></html>`);
    await page.bringToFront();
    t.diagnostic('Owned activation: ' + await foregroundOwnedProcess(ownedPid));
    native = nativeSession();
    assert.equal((await native.ready()).kind, 'ready');
    let foreground;
    const metadataCodes = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const metadata = await native.request('foreground');
      metadataCodes.push(metadata.kind === 'health' ? metadata.code : (metadata.source.processId === ownedPid ? 'owned' : 'other_process'));
      if (metadata.kind === 'foreground' && metadata.processName === 'chrome' && metadata.source.processId === ownedPid) {
        foreground = metadata; break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!foreground) { t.diagnostic('Metadata outcomes: ' + metadataCodes.join(',') + '; native types: ' + native.diagnostics.join(',')); t.skip('Windows did not foreground the owned Chrome process; no content was read'); return; }
    const scope = { source: foreground.source, region: foreground.region };
    // Give the newly foregrounded synthetic document time to initialize its provider.
    await new Promise(resolve => setTimeout(resolve, 500));
    async function assertOwnedForeground() {
      const metadata = await native.request('foreground');
      metadataCodes.push(metadata.kind === 'health' ? metadata.code : (metadata.source.processId === ownedPid ? 'owned' : 'other_process'));
      assert.ok(metadata.kind === 'foreground' && metadata.processName === 'chrome' && metadata.source.processId === ownedPid &&
        sameSource(metadata.source, scope.source), 'Owned Chrome must remain the exact foreground source before reading');
    }
    await assertOwnedForeground();
    const first = await native.request('observe', scope);
    if (first.kind === 'health') t.diagnostic('Native diagnostic types: ' + native.diagnostics.join(','));
    assert.equal(first.kind, 'observation', `Owned synthetic Chrome extraction returned ${first.kind === 'health' ? first.code : first.kind}`);
    const text = first.spans.map(span => span.text).join('\n');
    assert.ok(text.includes(initialText), 'Static owned page text must be extracted');
    assert.ok(!text.includes(editableMarker), 'Editable text must remain excluded');
    assert.ok(!text.includes(passwordMarker), 'Password text must remain excluded');
    assert.ok(!text.includes(backgroundMarker), 'Background tab text must remain excluded');
    await assertOwnedForeground();
    assert.equal((await native.request('watch', scope)).code, 'watching');
    await page.locator('#static').evaluate((element, value) => { element.textContent = value; }, changedText);
    let dirty = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const changes = await native.request('changes');
      if (changes.code === 'changed') { dirty = true; break; }
      assert.equal(changes.code, 'unchanged', 'Owned Chrome change watch must retain foreground scope');
    }
    assert.equal(dirty, true, 'Native Chrome text/property/structure events must mark synthetic changes');
    await assertOwnedForeground();
    const changed = await native.request('observe', scope);
    assert.equal(changed.kind, 'observation');
    const updated = changed.spans.map(span => span.text).join('\n');
    assert.ok(updated.includes(changedText));
    assert.ok(!updated.includes(initialText));
    assert.ok(!updated.includes(backgroundMarker));
    assert.ok(!updated.includes(editableMarker));
    assert.ok(!updated.includes(passwordMarker));
    assert.equal((await native.request('pause')).code, 'paused');
    assert.equal((await native.request('changes')).code, 'foreground_changed');
    assert.equal((await native.request('shutdown')).kind, 'stopped');
    t.diagnostic('Controlled Chrome page extraction, filtering, dirtiness, and background-tab exclusion passed; Gmail and other real app flows remain unverified');
  } finally { native?.close(); await browser?.close(); await server?.close(); }
});
