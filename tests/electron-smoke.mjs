import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import electronExecutable from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.TYPESAFE_API_KEY;
const executablePath = process.env.SQUEEK_TEST_EXECUTABLE;
if (executablePath) env.TYPESAFE_API_KEY = "synthetic-packaged-key";
const profile = await mkdtemp(join(tmpdir(), "squeek-ui-"));
await mkdir("artifacts/qa", { recursive: true });
const application = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: executablePath
    ? [`--user-data-dir=${profile}`]
    : [".", `--user-data-dir=${profile}`],
  env,
  timeout: 30000,
});
const errors = [];
try {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator("#health")).toHaveText("paused");
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "squeek://app/index.html")
          ?.isVisible(),
      ),
    )
    .toBe(false);
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "squeek://app/halo.html")
          ?.isVisible(),
      ),
    )
    .toBe(true);
  const haloFlags = await application.evaluate(({ BrowserWindow }) => {
    const halo = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === "squeek://app/halo.html",
    );
    return { focusable: halo.isFocusable(), onTop: halo.isAlwaysOnTop() };
  });
  assert.deepEqual(haloFlags, { focusable: false, onTop: true });
  await application.evaluate(({ screen }) => {
    screen.__originalCursor = screen.getCursorScreenPoint;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    let tick = 0;
    screen.getCursorScreenPoint = () => ({ x: area.x + 80 + (tick++ % 20), y: area.y + 80 });
  });
  let overlay;
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    overlay = await application.evaluate(({ BrowserWindow, screen }) => ({
      bounds: BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === "squeek://app/halo.html")
        .getBounds(),
      area: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
    }));
  } finally {
    await application.evaluate(({ screen }) => {
      screen.getCursorScreenPoint = screen.__originalCursor;
      delete screen.__originalCursor;
    });
  }
  assert.deepEqual(
    overlay.bounds,
    overlay.area,
    "the ghost overlay spans the cursor display and stays put while the cursor moves",
  );
  const duplicate = spawn(
    executablePath ?? electronExecutable,
    executablePath ? [`--user-data-dir=${profile}`] : [".", `--user-data-dir=${profile}`],
    { env, stdio: "ignore", windowsHide: true },
  );
  const duplicateExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      duplicate.kill();
      reject(Error("Duplicate companion did not exit"));
    }, 5000);
    duplicate.once("error", (error) => { clearTimeout(timer); reject(error); });
    duplicate.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(duplicateExit, 0, "second launch must use the existing tray instance");
  const haloPage = application
    .windows()
    .find((window) => window.url() === "squeek://app/halo.html");
  const ghostPixels = await haloPage.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { painted, total: data.length / 4 };
  });
  assert.ok(ghostPixels.painted > 200, "the ghost is drawn on the overlay");
  assert.ok(
    ghostPixels.painted < ghostPixels.total * 0.01,
    "the overlay stays transparent apart from the ghost",
  );
  await haloPage.screenshot({
    path: "artifacts/qa/companion.png",
    omitBackground: true,
  });
  await page.evaluate(() => window.squeek.invoke("show"));
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "squeek://app/index.html")
          ?.isVisible(),
      ),
    )
    .toBe(true);
  await page.locator("#close").click();
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "squeek://app/index.html")
          ?.isVisible(),
      ),
    )
    .toBe(false);
  await page.evaluate(() =>
    window.squeek.invoke(
      "check",
      "IRS: send money using gift cards immediately.",
    ),
  );
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL() === "squeek://app/index.html")
          ?.isVisible(),
      ),
    )
    .toBe(true);
  const dock = await application.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === "squeek://app/index.html")
      .getBounds();
    return {
      bounds,
      area: screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        .workArea,
    };
  });
  assert.ok(dock.bounds.x + dock.bounds.width <= dock.area.x + dock.area.width);
  assert.ok(
    dock.bounds.y + dock.bounds.height <= dock.area.y + dock.area.height,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  if (executablePath)
    assert.equal(
      await page.evaluate(
        async () => (await window.squeek.invoke("state")).providerConfigured,
      ),
      false,
      "packaged app must ignore developer credential",
    );
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof process), "undefined");
  await page.screenshot({ path: "artifacts/qa/initial.png" });
  const voices = await page.evaluate(
    () => speechSynthesis.getVoices().filter((v) => v.localService).length,
  );
  assert.ok(
    voices > 0,
    "Windows local voices must be available for this machine validation",
  );
  await page.locator("#manual-check summary").click();
  await page
    .locator("#manual-text")
    .fill("IRS: send money using gift cards immediately.");
  await page.locator("#check").click();
  await expect(page.locator("#assessment-heading")).toHaveText(
    "Hey, this is a scam, don't click on it",
  );
  await expect(page.locator("#evidence li")).toHaveCount(4);
  const box = await page.locator("#assessment-heading").boundingBox();
  assert.ok(
    box &&
      box.y >= 0 &&
      box.y + box.height < (await page.evaluate(() => innerHeight)),
  );
  await expect(page.locator("#replay")).toBeEnabled();
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#replay")).toBeDisabled();
  await page.screenshot({ path: "artifacts/qa/warning.png" });
  await page.locator("#cancel").click();
  await expect(page.locator("#assessment-heading")).toHaveText("Unknown");
  const demoPromise = application.waitForEvent("window", (page) =>
    page.url().includes("demo.html"),
  );
  await page.locator("#demo").click();
  const demo = await demoPromise;
  await demo.waitForLoadState("domcontentloaded");
  await demo
    .locator("#message")
    .fill("Please send money using gift cards today.");
  await demo.locator("#recipient").fill("Test recipient");
  await demo.locator("#amount").fill("1");
  await demo.locator("#destination").fill("Test destination");
  await demo.locator("button[type=submit]").click();
  await expect(demo.locator("#review")).toBeVisible();
  await demo.locator("#amount").fill("2");
  await expect(demo.locator("#review")).toBeHidden();
  await expect(demo.locator("#result")).toHaveText("Review required");
  await demo.locator("button[type=submit]").click();
  await expect(demo.locator("#review")).toBeVisible();
  const reviewId = await demo.evaluate(() =>
    window.squeek.invoke(
      "demo-review",
      Object.fromEntries(
        ["message", "recipient", "amount", "destination"].map((k) => [
          k,
          document.getElementById(k).value,
        ]),
      ),
    ),
  );
  await page.evaluate(() =>
    window.squeek.invoke("monitor", { enabled: false, browser: "chrome" }),
  );
  await assert.rejects(
    demo.evaluate(
      (id) =>
        window.squeek.invoke("demo-approve", {
          id,
          fields: Object.fromEntries(
            ["message", "recipient", "amount", "destination"].map((k) => [
              k,
              document.getElementById(k).value,
            ]),
          ),
        }),
      reviewId,
    ),
  );
  await demo.locator("button[type=submit]").click();
  await expect(demo.locator("#review")).toBeVisible();
  await demo.locator("#continue").click();
  await expect(demo.locator("#result")).toHaveText("Simulation complete");
  await assert.rejects(
    page.evaluate(() => window.squeek.invoke("execute", "anything")),
  );
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === "squeek://app/index.html",
    );
    window.close();
  });
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) =>
          w.webContents.getURL() === "squeek://app/index.html" &&
          !w.isDestroyed(),
      ),
    ),
    true,
    "panel close must preserve tray reopen",
  );
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL() === "squeek://app/index.html")
      .show(),
  );
  await expect(page.locator("#monitoring-state")).toHaveText("Paused");
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL() === "squeek://app/halo.html")
        .isVisible(),
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Electron flows passed: tray-only startup, visible nonfocusable companion, close-to-hide, warning-triggered docked sidebar, isolated renderer, local voices, mute/cancel, action review, invalid IPC.",
  );
} finally {
  await application.close();
}
