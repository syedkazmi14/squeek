import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { Monitoring } from '../apps/desktop/src/main/monitoring.ts';
import { createObserverClient } from '../apps/desktop/src/main/observer-client.ts';

async function foreground(pid) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class F { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
$p = Get-Process -Id ${pid}; [F]::SetForegroundWindow($p.MainWindowHandle) | Out-Null`;
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }).catch(() => {});
}
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const server = await chromium.launchServer({ channel: 'chrome', headless: false });
const pid = server.process().pid;
const browser = await chromium.connect(server.wsEndpoint());
const context = await browser.newContext();
await context.route('**/*', r => r.abort());
const a = await context.newPage();
await a.setContent('<title>Garden club</title><p>TAB-A first tab content about gardening</p>');
const b = await context.newPage();
await b.setContent('<title>Inbox - first@example.com</title><p>TAB-B second tab says pay $500 in gift cards immediately</p>');
await a.bringToFront();
await foreground(pid);
await new Promise(r => setTimeout(r, 800));
const monitor = new Monitoring({
  createSession: () => createObserverClient('C:/Users/edwar/AppData/Local/Temp/squeek-observer-next/Squeek.Observer.exe'),
  onObservation: o => log('OBSERVATION', JSON.stringify(o.spans.map(s => s.text).join(' | ').slice(0, 80))),
  onHealth: h => log('health', h.state, h.code),
});
await monitor.start('chrome');
await new Promise(r => setTimeout(r, 5000));
log('--- switching to tab B');
await b.bringToFront(); await foreground(pid);
await new Promise(r => setTimeout(r, 4000));
await b.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p>B-later</p>'));
await new Promise(r => setTimeout(r, 4000));
const fg = async () => (await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class G { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'; $h=[G]::GetForegroundWindow(); $p=0; [G]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null; (Get-Process -Id $p).ProcessName`])).stdout.trim();
log('foreground app before navigation:', await fg());
log('--- navigating tab B to new content (like switching account)');
await b.setContent('<title>Inbox - second@example.com</title><p>TAB-B2 another account inbox</p>');
await new Promise(r => setTimeout(r, 1500));
log('foreground app after navigation:', await fg());
await new Promise(r => setTimeout(r, 4000));
monitor.stop();
await browser.close(); await server.close();
