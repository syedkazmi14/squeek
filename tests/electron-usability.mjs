import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Native Electron QA, separate from browser extraction and Windows installed-app gates.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.TYPESAFE_API_KEY;
const profile = await mkdtemp(join(tmpdir(), "squeek-usability-"));
const app = await electron.launch({ args: [".", `--user-data-dir=${profile}`], env });
const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
try {
  const page = await app.firstWindow();
  await page.evaluate(() => window.squeek.invoke("show"));
  await expect(page.locator("#mute")).toBeVisible();
  // Verify keyboard activation of mute and disclosure/select controls without reading external apps.
  await page.locator("#mute").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".voice-controls summary").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#voice-rate")).toBeVisible();
  await page.locator("#voice-rate").focus(); await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.locator("#manual-check summary").focus(); await page.keyboard.press("Enter");
  await page.locator("#manual-text").fill("Support agent: send your verification code.");
  await page.locator("#check").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#evidence li")).not.toHaveCount(0);
  const metrics = [];
  for (const [width, height, zoom] of [[320, 640, 1], [400, 720, 1], [520, 820, 1], [760, 800, 1], [1200, 900, 1], [640, 720, 2], [1040, 900, 2]]) {
    await app.evaluate(({ BrowserWindow }, { width, height, zoom }) => {
      const panel = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === "squeek://app/index.html");
      panel.setContentSize(width, height); panel.webContents.setZoomFactor(zoom);
    }, { width, height, zoom });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const row = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll("button, select, textarea, summary")].filter(e => e.getClientRects().length && !e.disabled).map(e => ({ id: e.id || e.textContent.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })),
      bodyFontPx: parseFloat(getComputedStyle(document.body).fontSize),
      lastReviewFontPx: parseFloat(getComputedStyle(document.querySelector("#last-review")).fontSize),
      lastReviewColor: getComputedStyle(document.querySelector("#last-review")).color,
      bodyColor: getComputedStyle(document.body).color,
      backgroundColor: getComputedStyle(document.documentElement).backgroundColor,
    }));
    assert.ok(row.controls.every(control => control.height >= 44 && control.width >= 44), "Active controls need readable target dimensions");
    metrics.push({ requestedWidth: width, requestedHeight: height, zoom, ...row });
  }
  const colors = metrics[0];
  const rgb = text => text.match(/\d+/g).slice(0, 3).map(Number);
  const lastReviewRatio = contrast(rgb(colors.lastReviewColor), rgb(colors.backgroundColor));
  await mkdir("artifacts/qa", { recursive: true });
  const report = { platform: process.platform, architecture: process.arch, scope: "Development Electron with synthetic manual input; not packaged Windows or participant testing",
    keyboard: ["Mute toggled with Enter", "Voice disclosure opened with Enter", "Voice rate select operated with keys", "Manual check submitted with Enter"],
    dimensions: metrics, contrast: { body: contrast(rgb(colors.bodyColor), rgb(colors.backgroundColor)), lastReview: lastReviewRatio },
    issues: lastReviewRatio < 4.5 ? ["18px normal Last review text has contrast below 4.5:1; shared renderer fix needs coordination"] : [],
    pending: ["Actual Windows display scaling/multiple monitors", "Narrator screen reader", "Physical speech output", "Packaged accessibility", "Intended-user feedback"] };
  await writeFile("artifacts/qa/usability.json", JSON.stringify(report, null, 2) + "\n");
  await page.screenshot({ path: "artifacts/qa/usability.png" });
  console.log(`Electron usability checks passed for seven size/zoom combinations and keyboard controls; ${report.issues.length} contrast issue(s) remain recorded.`);
} finally { await app.close(); await rm(profile, { recursive: true, force: true }); }
