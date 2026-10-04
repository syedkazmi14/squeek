import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Native Electron QA. Fixtures below are test-only; they never enter production activity.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.TYPESAFE_API_KEY;
const profile = await mkdtemp(join(tmpdir(), "squeek-usability-"));
const app = await electron.launch({
  args: [".", `--user-data-dir=${profile}`],
  env,
});
const luminance = (rgb) =>
  rgb
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) =>
            w.webContents.getURL() === "squeek://app/halo.html" &&
            w.isVisible(),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.squeek.invoke("show"));
  await mkdir("artifacts/qa", { recursive: true });
  const capture = async (name) => {
    // Allow the requested 150ms color transitions to settle before taking native screenshots.
    await page.waitForTimeout(180);
    await page.screenshot({ path: `artifacts/qa/redesign-${name}.png` });
  };
  const overviewFits = async () => {
    const bounds = await page.evaluate(() => {
      const content = document.querySelector(".panel-content");
      return {
        fits: content.scrollHeight <= content.clientHeight + 1,
        horizontal: content.scrollWidth <= content.clientWidth + 1,
      };
    });
    if (!bounds.fits) {
      console.log(
        await page.locator("#overview").evaluate((e) => ({
          height: e.getBoundingClientRect().height,
          children: [...e.children].map((c) => ({
            id: c.id || c.className,
            h: c.getBoundingClientRect().height,
          })),
          text: e.textContent,
        })),
      );
      await capture("overflow");
    }
    assert.ok(
      bounds.fits,
      "Overview should fit the 360 × 520 panel without scrolling",
    );
    assert.ok(bounds.horizontal, "Content must not overflow horizontally");
  };
  await expect(page.locator("#status-heading")).toHaveText(
    "Ready when you are.",
  );
  await expect(page.locator(".app-header img")).toHaveCount(0);
  await expect(page.locator(".status-mascot")).toBeVisible();
  await expect(page.locator("#see-finding")).toBeHidden();
  await page.locator("#browser").focus();
  await expect(page.locator("#browser")).toBeFocused();
  await page.locator("#browser").selectOption("msedge");
  await expect(page.locator("#browser")).toHaveValue("msedge");
  await page.locator("#browser").selectOption("chrome");
  await expect(
    page.locator("#voice-rate, #cloud, #health, #revision"),
  ).toHaveCount(0);
  await overviewFits();
  await capture("paused");
  const panelBounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === "squeek://app/index.html")
        .getBounds(),
    );
  const originalBounds = await panelBounds();
  const windowFlags = await app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === "squeek://app/index.html",
    );
    return {
      resizable: panel.isResizable(),
      movable: panel.isMovable(),
      opacity: panel.getOpacity(),
      minimumSize: panel.getMinimumSize(),
    };
  });
  assert.equal(windowFlags.resizable, false);
  assert.ok(windowFlags.movable);
  await expect(page.locator("#resize-handle")).toHaveCount(0);
  if (process.platform !== "linux") assert.equal(windowFlags.opacity, 1);
  assert.equal(
    await page
      .locator(".app-header")
      .evaluate((e) => getComputedStyle(e).webkitAppRegion),
    "drag",
  );
  assert.equal(
    await page
      .locator(".header-actions")
      .evaluate((e) => getComputedStyle(e).webkitAppRegion),
    "no-drag",
  );
  await expect(page.locator("#try-sample")).toHaveCount(0);
  await expect(page.locator("#see-finding")).toBeHidden();
  assert.equal(
    (await page.evaluate(() => window.squeek.invoke("state"))).cloudEnabled,
    false,
  );
  // Verify the actual existing tray Settings menu contains the relocated consent and demo actions.
  await app.evaluate(({ Menu }) => {
    const original = Menu.buildFromTemplate;
    Menu.buildFromTemplate = (template) => {
      if (template.some((item) => item.label === "Settings"))
        globalThis.__qaTray = template;
      return original.call(Menu, template);
    };
  });
  await page.evaluate(() =>
    window.squeek.invoke("monitor", { enabled: false, browser: "chrome" }),
  );
  const traySettings = await app.evaluate(() =>
    globalThis.__qaTray
      .find((item) => item.label === "Settings")
      .submenu.map(({ label, checked, enabled }) => ({
        label,
        checked,
        enabled,
      })),
  );
  assert.equal(traySettings[0].label, "Send redacted text to Jev");
  assert.equal(traySettings[0].checked, false);
  assert.equal(traySettings[1].label, "Open demo");
  const configured = (await page.evaluate(() => window.squeek.invoke("state")))
    .providerConfigured;
  assert.equal(traySettings[0].enabled, configured);
  const voiceChat = (await page.evaluate(() => window.squeek.invoke("state")))
    .voiceChat;
  assert.equal(
    await app.evaluate(() =>
      globalThis.__qaTray.find(
        (item) => item.label === "Talk to Squeek (or hold Ctrl)",
      ).enabled,
    ),
    voiceChat,
  );
  if (!configured)
    await assert.rejects(
      page.evaluate(() => window.squeek.invoke("cloud", true)),
    );
  // Keyboard navigation opens a focused view without submitting and retains drafts on Back.
  await page.locator("#mute").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#mute")).toHaveAccessibleName(
    "Unmute warning audio",
  );
  await capture("keyboard-focus");
  await page.keyboard.press("Enter");
  await page.locator("#open-manual").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#manual-heading")).toBeFocused();
  await expect(page.locator("#check")).toBeDisabled();
  await page
    .locator("#manual-text")
    .fill("Support agent: send your verification code.");
  await page.locator("#manual-view [data-back]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#open-manual")).toBeFocused();
  await page.locator("#open-manual").click();
  await expect(page.locator("#manual-text")).toHaveValue(
    "Support agent: send your verification code.",
  );
  await capture("manual");
  await page.locator("#check").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#assessment-heading")).toBeFocused();
  await expect(page.locator("#evidence li")).not.toHaveCount(0);
  await page.locator("#finding-view [data-back]").click();
  await expect(page.locator("#see-finding")).toBeVisible();
  await overviewFits();
  await capture("suspicious");
  await page.locator("#see-finding").click();
  await expect(page.locator("#replay")).toBeVisible();
  await expect(page.locator("#detail-manual")).toHaveClass(/text-button/);
  await page.locator("#mute").click();
  await expect(page.locator("#replay")).toBeHidden();
  await page.locator("#mute").click();
  await expect(page.locator("#replay")).toBeVisible();
  await page.locator("#replay").focus();
  await page.keyboard.press("Enter");
  await capture("finding");
  await page.locator("#clear-check").click();
  await expect(page.locator("#overview")).toBeVisible();
  await expect(page.locator("#open-manual")).toBeFocused();
  // Fixture dispatch uses the existing state event. No fake history/backend is added to the app.
  let revision = 100;
  const base = {
    monitoring: false,
    health: "paused",
    revision,
    browser: "chrome",
    cloudEnabled: false,
  };
  const fixture = async (extra) => {
    const state = { ...base, ...extra, revision: ++revision };
    await app.evaluate(
      ({ BrowserWindow }, state) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "squeek://app/index.html")
          .webContents.send("squeek:state", state),
      state,
    );
  };
  await fixture({
    sync: { configured: true, connected: true, email: "friend@example.com" },
  });
  await expect(page.locator("#phone-details")).toBeVisible();
  await expect(page.locator("#phone-details")).toHaveJSProperty("open", false);
  await expect(page.locator("#phone-link")).toBeHidden();
  await fixture({
    sync: {
      configured: true,
      connected: true,
      phoneWarning: { surface: "call", evidence: null, minutesAgo: 2 },
    },
  });
  await expect(page.locator("#phone-details")).toHaveJSProperty("open", true);
  await expect(page.locator("#phone-warning")).toBeVisible();
  await fixture({});
  // Merge regression: the redesigned panel keeps main's voice and link listeners.
  // Synthetic state, denied microphone and intercepted speech never call a provider.
  await page.evaluate(() => {
    window.__qaVoice = {
      speak: speechSynthesis.speak,
      getVoices: speechSynthesis.getVoices,
      microphone: Object.getOwnPropertyDescriptor(
        navigator.mediaDevices,
        "getUserMedia",
      ),
      spoken: [],
      microphoneStarts: 0,
    };
    speechSynthesis.speak = (utterance) =>
      window.__qaVoice.spoken.push({ text: utterance.text, rate: utterance.rate });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        window.__qaVoice.microphoneStarts++;
        throw Error("Synthetic microphone refusal");
      },
    });
  });
  await fixture({ voiceChat: true });
  await expect(page.locator("#talk")).toBeVisible();
  await page.locator("#talk").click();
  await expect(page.locator("#talk-heard")).toHaveText(
    "Squeek couldn't use the microphone.",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === "squeek://app/index.html")
      .webContents.send("squeek:listen", "hold"),
  );
  await expect
    .poll(() => page.evaluate(() => window.__qaVoice.microphoneStarts))
    .toBe(2);
  await fixture({ voiceChat: false });
  await expect(page.locator("#talk-section")).toBeHidden();
  await page.evaluate(() => window.squeek.invoke("hide"));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === "squeek://app/index.html")
      .webContents.send("squeek:speak", { text: "Synthetic link warning." }),
  );
  await expect
    .poll(() => page.evaluate(() => window.__qaVoice.spoken[0]?.text))
    .toBe("Synthetic link warning.");
  const localWarningRate = await page.evaluate(
    () => window.__qaVoice.spoken[0]?.rate,
  );
  assert.ok(Math.abs(localWarningRate - 0.8) < 0.001);
  await page.evaluate(() => window.squeek.invoke("show"));
  await fixture({
    assessmentCurrent: false,
    assessment: {
      state: "high_risk",
      coverage: "partial",
      evidence: [{ excerpt: "Synthetic previous request." }],
      assessedAt: Date.now(),
    },
  });
  await expect(page.locator("#status-heading")).toHaveText(
    "This looks suspicious.",
  );
  assert.equal(await page.evaluate(() => window.__qaVoice.spoken.length), 1);
  await page.evaluate(() => {
    const original = window.__qaVoice;
    speechSynthesis.speak = original.speak;
    speechSynthesis.getVoices = original.getVoices;
    if (original.microphone)
      Object.defineProperty(
        navigator.mediaDevices,
        "getUserMedia",
        original.microphone,
      );
    else delete navigator.mediaDevices.getUserMedia;
    delete window.__qaVoice;
  });
  await fixture({});
  await fixture({ monitoring: true, health: "watching" });
  await expect(page.locator("#monitoring-state")).toHaveText(
    "Watching · foreground Chrome only",
  );
  await expect(page.locator("#status-label")).toBeVisible();
  await expect(page.locator("#status-description")).toBeVisible();
  await expect(page.locator("#status-description")).toContainText(
    "Checking readable text in the active Chrome window.",
  );
  await expect(page.locator("#monitor")).toHaveText("Pause");
  await overviewFits();
  await expect(page.locator("#status-card")).toHaveAttribute(
    "data-mascot-status",
    "watching",
  );
  await capture("monitoring-fixture");
  await fixture({ monitoring: true, health: "watching", browser: "msedge" });
  await expect(page.locator("#monitoring-state")).toHaveText(
    "Watching · foreground Microsoft Edge only",
  );
  await overviewFits();
  await capture("monitoring-edge-fixture");
  await fixture({ monitoring: true, health: "watching" });
  // Close and mute do not send Pause; fixture protection remains active after reopen.
  await page.locator("#mute").click();
  await expect(page.locator("#monitoring-state")).toHaveText(
    "Watching · foreground Chrome only",
  );
  await page.locator("#close").click();
  await page.evaluate(() => window.squeek.invoke("show"));
  await expect(page.locator("#monitoring-state")).toHaveText(
    "Watching · foreground Chrome only",
  );
  await page.locator("#mute").click();
  await fixture({ monitoring: true, health: "unsupported_app" });
  await expect(page.locator("#status-description")).toContainText(
    "Bring Chrome to the front",
  );
  await capture("browser-recovery-fixture");
  await overviewFits();
  await fixture({ monitoring: true, health: "observer_failed" });
  await expect(page.locator("#status-description")).toContainText(
    "Pause and restart browser protection",
  );
  await overviewFits();
  await capture("unavailable-fixture");
  const assessment = {
    state: "unknown",
    coverage: "partial",
    evidence: [],
    assessedAt: Date.now(),
    source: { processId: 1, windowHandle: "fixture", processStartedAt: 1 },
  };
  await fixture({ assessment, assessmentCurrent: true });
  await expect(page.locator("#status-heading")).toHaveText(
    "I need a little more context.",
  );
  await expect(page.locator("#status-card")).toHaveAttribute(
    "data-mascot-status",
    "unknown",
  );
  await capture("unknown-fixture");
  await overviewFits();
  await expect(page.locator("#see-finding")).toHaveText("View details →");
  await page.locator("#see-finding").click();
  await expect(page.locator("#evidence-section")).toBeHidden();
  await expect(page.locator("#replay")).toBeHidden();
  await page.locator("#finding-view [data-back]").click();
  await fixture({
    assessment: {
      ...assessment,
      state: "no_detected_signal",
      coverage: "complete",
    },
  });
  await expect(page.locator("#status-description")).toBeVisible();
  await expect(page.locator("#status-description")).toContainText(
    "I didn’t spot clear scam signs",
  );
  await capture("no-warning-fixture");
  await overviewFits();
  await fixture({
    assessment: {
      ...assessment,
      state: "high_risk",
      evidence: [
        { excerpt: "Test evidence: " + "verify-before-sharing/".repeat(90) },
      ],
    },
    assessmentCurrent: false,
  });
  await page.locator("#see-finding").click();
  await expect(page.locator("#last-review")).toBeVisible();
  await expect(page.locator("#replay")).toBeHidden();
  await expect(page.locator("#evidence li")).toHaveText(
    "Test evidence: " + "verify-before-sharing/".repeat(90),
  );
  await capture("long-evidence-fixture");
  const metrics = [];
  for (const [width, height, zoom] of [
    [320, 480, 1],
    [360, 480, 1],
    [360, 520, 1],
    [360, 560, 1],
    [400, 520, 1],
    [640, 720, 2],
    [720, 1040, 2],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height, zoom }) => {
        const panel = BrowserWindow.getAllWindows().find(
          (w) => w.webContents.getURL() === "squeek://app/index.html",
        );
        panel.setContentSize(width, height);
        panel.webContents.setZoomFactor(zoom);
      },
      { width, height, zoom },
    );
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const row = await page.evaluate(() => {
      const content = document.querySelector(".panel-content");
      const header = document
        .querySelector(".app-header")
        .getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        contentHorizontal: content.scrollWidth <= content.clientWidth + 1,
        controls: [...document.querySelectorAll("button, select, textarea")]
          .filter((e) => e.getClientRects().length && !e.disabled)
          .map((e) => ({
            id: e.id || e.textContent.trim(),
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
          })),
        headerVisible: header.y >= 0 && header.bottom <= innerHeight,
        bodyColor: getComputedStyle(document.body).color,
        secondaryColor: getComputedStyle(document.querySelector("#last-review"))
          .color,
        backgroundColor: getComputedStyle(document.documentElement)
          .backgroundColor,
      };
    });
    assert.ok(
      row.controls.every(
        (control) => control.height >= 44 && control.width >= 44,
      ),
    );
    assert.ok(row.headerVisible && row.contentHorizontal);
    await page.evaluate(() => {
      document.querySelector(".panel-content").scrollTop = 100000;
    });
    await expect(page.locator("#mute")).toBeVisible();
    metrics.push({
      requestedWidth: width,
      requestedHeight: height,
      zoom,
      ...row,
    });
  }
  await app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === "squeek://app/index.html",
    );
    panel.webContents.setZoomFactor(1);
    panel.setContentSize(360, 520);
  });
  await page.locator("#finding-view [data-back]").click();
  await fixture({});
  // Hold one request in the main process to inspect real renderer pending/cancel behavior.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get("squeek:request");
    ipcMain.removeHandler("squeek:request");
    ipcMain.handle("squeek:request", async (event, action, value) => {
      if (action !== "check") return original(event, action, value);
      await original(event, "monitor", { enabled: false, browser: "chrome" });
      await new Promise((resolve) => {
        globalThis.__qaFinishCheck = resolve;
      });
      return original(event, "state");
    });
  });
  await page.locator("#open-manual").click();
  await page.locator("#check").click();
  await expect(page.locator("#check")).toHaveText("Checking…");
  await expect(page.locator("#check")).toBeDisabled();
  await capture("checking-fixture");
  await page.locator("#manual-view [data-back]").click();
  await expect(page.locator("#status-heading")).toHaveText(
    "I’m checking this…",
  );
  await capture("checking-overview-fixture");
  await overviewFits();
  await expect(page.locator("#monitor")).toHaveText("Cancel check");
  await page.locator("#open-manual").click();
  await page.locator("#cancel").click();
  await app.evaluate(() => globalThis.__qaFinishCheck());
  await expect(page.locator("#check")).toHaveText("Check message");
  await expect(page.locator("#manual-view")).toBeVisible();
  await page.locator("#manual-view [data-back]").click();
  await expect(page.locator("#status-heading")).toHaveText(
    "Ready when you are.",
  );
  const rgb = (text) => text.match(/\d+/g).slice(0, 3).map(Number);
  const colors = metrics[0];
  const ratios = {
    body: contrast(rgb(colors.bodyColor), rgb(colors.backgroundColor)),
    secondary: contrast(
      rgb(colors.secondaryColor),
      rgb(colors.backgroundColor),
    ),
  };
  assert.ok(ratios.body >= 4.5 && ratios.secondary >= 4.5);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator("#mute")
      .evaluate((e) => getComputedStyle(e).transitionDuration),
    "0s",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/qa/usability.json",
    JSON.stringify(
      {
        platform: process.platform,
        scope:
          "Native development Electron; real local manual checks plus labeled state/deferred IPC fixtures",
        dimensions: metrics,
        contrast: ratios,
        traySettings,
        issues: [],
        pending: [
          "Windows observer integration and multiple monitors",
          "Screen reader and physical speech output",
          "Packaged Windows testing",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Electron usability passed: compact states, focused views, draft retention, consent/tray menu, audio visibility, cancellation, keyboard, reduced motion, contrast, seven size/text-scale combinations.",
  );
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
