import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  Tray,
  Menu,
  screen,
  nativeImage,
} from "electron";
import { randomUUID } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { createObserverClient } from "./observer-client.ts";
import { Monitoring } from "./monitoring.ts";
import { Companion } from "./companion.ts";
import { warning } from "../renderer/incident.ts";
import { allowedFrame, validateInput } from "./ipc-policy.ts";
import { ProviderGate } from "./provider-gate.ts";
import { createJevProvider } from "../../../../packages/providers/src/jev.ts";
import {
  assess,
  sourceId,
  type Assessment,
} from "../../../../packages/detection/src/index.ts";
import { AssessmentScheduler } from "../../../../packages/detection/src/scheduler.ts";
import {
  ActionReview,
  type ReviewedAction,
} from "../../../../packages/detection/src/action-review.ts";
import type { Observation } from "../../../../packages/contracts/src/observation.ts";
const root = dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "squeek",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let panel: BrowserWindow | undefined,
  demo: BrowserWindow | undefined,
  halo: BrowserWindow | undefined,
  tray: Tray | undefined;
if (!app.isPackaged && existsSync(join(root, "../../.env"))) {
  try {
    process.loadEnvFile(join(root, "../../.env"));
  } catch {}
}
const key = !app.isPackaged ? process.env.TYPESAFE_API_KEY : undefined;
const providerGate = new ProviderGate(key ? createJevProvider(key) : undefined);
let manualAbort: AbortController | undefined;
let quitting = false;
let companion: Companion | undefined;
let reviewExpiry: ReturnType<typeof setTimeout> | undefined;
let state: {
  providerConfigured: boolean;
  cloudEnabled: boolean;
  monitoring: boolean;
  health: string;
  revision: number;
  browser: "chrome" | "msedge";
  assessmentCurrent?: boolean;
  assessment?: Assessment;
} = {
  providerConfigured: providerGate.configured,
  cloudEnabled: false,
  monitoring: false,
  health: "paused",
  revision: 0,
  browser: "chrome",
};
let scheduler: AssessmentScheduler | undefined;
const publish = () => {
  if (panel && !panel.isDestroyed())
    panel.webContents.send("squeek:state", state);
  if (halo && !halo.isDestroyed())
    halo.webContents.send("squeek:state", {
      status:
        state.assessmentCurrent && state.assessment?.state === "high_risk"
          ? "risk"
          : !state.monitoring
            ? "paused"
            : state.health === "watching"
              ? "monitoring"
              : "unknown",
    });
  refreshTray();
};
const resource = app.isPackaged
  ? join(process.resourcesPath, "observer", "Squeek.Observer.exe")
  : join(root, "../../artifacts/observer/Squeek.Observer.exe");
const monitor = new Monitoring({
  createSession: () => createObserverClient(resource),
  onObservation: (observation) => scheduler?.observe(observation),
  onHealth: (health) => {
    state.health = health.code;
    if (health.state !== "available") {
      scheduler?.pause();
      scheduler = undefined;
      state.assessmentCurrent = false;
      if (
        !state.assessment ||
        !["high_risk", "caution"].includes(state.assessment.state)
      )
        delete state.assessment;
      state.revision++;
    } else if (state.monitoring && !scheduler) scheduler = makeScheduler();
    publish();
  },
});
function makeScheduler() {
  return new AssessmentScheduler({
    assess: (observation, signal) =>
      assess(observation, {
        signal,
        ...(providerGate.provider()
          ? { provider: providerGate.provider()! }
          : {}),
      }),
    onResult: acceptAssessment,
  });
}
function acceptAssessment(assessment: Assessment) {
  if (reviewExpiry) clearTimeout(reviewExpiry);
  state.assessment = assessment;
  state.assessmentCurrent = true;
  state.revision++;
  publish();
  companion?.assessment(assessment);
  reviewExpiry = setTimeout(() => {
    delete state.assessment;
    state.assessmentCurrent = false;
    state.revision++;
    publish();
  }, 60000);
}
async function startMonitoring(browser: "chrome" | "msedge") {
  pause();
  state.browser = browser;
  state.monitoring = true;
  state.health = "starting";
  scheduler = makeScheduler();
  publish();
  await monitor.start(browser);
}
function hideSidebar() {
  manualAbort?.abort();
  manualAbort = undefined;
  companion?.hideSidebar();
  if (panel && !panel.isDestroyed())
    panel.webContents.send("squeek:sidebar-hidden");
}
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Squeek", click: () => companion?.showSidebar(true) },
      {
        label: "Settings",
        submenu: [
          {
            label: "Send redacted text to Jev",
            type: "checkbox",
            enabled: providerGate.configured,
            checked: state.cloudEnabled,
            click: (item) => setCloudEnabled(item.checked),
          },
          {
            label: "Open demo",
            click: () => {
              void openDemo();
            },
          },
        ],
      },
      { type: "separator" },
      {
        label: "Start monitoring Chrome",
        enabled: !state.monitoring || state.browser !== "chrome",
        click: () => {
          void startMonitoring("chrome");
        },
      },
      {
        label: "Start monitoring Edge",
        enabled: !state.monitoring || state.browser !== "msedge",
        click: () => {
          void startMonitoring("msedge");
        },
      },
      { label: "Pause monitoring", enabled: state.monitoring, click: pause },
      {
        label: "Show companion",
        type: "checkbox",
        checked: companion?.isVisible ?? true,
        click: (item) => {
          companion?.setVisible(item.checked);
          refreshTray();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}
function setCloudEnabled(enabled: boolean) {
  pause();
  providerGate.setEnabled(enabled);
  state.cloudEnabled = enabled;
  publish();
}
async function openDemo() {
  if (!demo || demo.isDestroyed()) {
    demo = secureWindow({ width: 680, height: 800 });
    await demo.loadURL("squeek://app/demo.html");
    demo.on("closed", () => {
      reviews.invalidate();
      demoAction = undefined;
      demoAssessment = undefined;
    });
  } else demo.show();
}
function pause() {
  if (reviewExpiry) clearTimeout(reviewExpiry);
  reviewExpiry = undefined;
  companion?.resetAlert();
  reviews.invalidate();
  demoAction = undefined;
  demoAssessment = undefined;
  if (demo && !demo.isDestroyed())
    demo.webContents.send("squeek:state", {
      monitoring: false,
      health: "paused",
      revision: state.revision + 1,
    });
  manualAbort?.abort();
  manualAbort = undefined;
  monitor.stop();
  scheduler?.pause();
  scheduler = undefined;
  state = {
    providerConfigured: providerGate.configured,
    cloudEnabled: state.cloudEnabled,
    monitoring: false,
    health: "paused",
    revision: state.revision + 1,
    browser: state.browser,
  };
  publish();
}
function secureWindow(options: {
  width: number;
  height: number;
  sidebar?: boolean;
}) {
  const { sidebar = false, ...dimensions } = options;
  const window = new BrowserWindow({
    ...dimensions,
    minWidth: sidebar ? 1 : 480,
    minHeight: sidebar ? 1 : 600,
    frame: !sidebar,
    skipTaskbar: sidebar,
    alwaysOnTop: sidebar,
    resizable: !sidebar,
    show: false,
    backgroundColor: "#f7f4ec",
    title: "Squeek",
    webPreferences: {
      preload: join(root, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("squeek://app/")) event.preventDefault();
  });
  if (!sidebar) window.once("ready-to-show", () => window.show());
  return window;
}
function observation(text: string, revision: number): Observation {
  return {
    version: 1,
    sessionId: manualSession,
    kind: "observation",
    source: manualSource,
    revision,
    observedAt: Date.now(),
    provenance: "accessibility",
    coverage: "complete",
    spans: [{ text, rect: { x: 0, y: 0, width: 1, height: 1 } }],
  };
}
const manualSession = randomUUID(),
  manualSource = {
    processId: process.pid,
    windowHandle: "1",
    processStartedAt: Date.now(),
  };
let manualRevision = 0;
const reviews = new ActionReview();
let demoAction: ReviewedAction | undefined,
  demoAssessment: Assessment | undefined;
function parseDemo(value: unknown): {
  message: string;
  recipient: string;
  amount: string;
  destination: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Error("Invalid request");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 4 ||
    !["message", "recipient", "amount", "destination"].every(
      (key) =>
        typeof v[key] === "string" &&
        (v[key] as string).length <= (key === "message" ? 8000 : 200),
    )
  )
    throw Error("Invalid request");
  return v as {
    message: string;
    recipient: string;
    amount: string;
    destination: string;
  };
}
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle("squeek", (request) => {
    const url = new URL(request.url);
    const name = basename(url.pathname);
    if (
      url.hostname !== "app" ||
      url.pathname !== `/${name}` ||
      ![
        "index.html",
        "renderer.js",
        "styles.css",
        "demo.html",
        "demo.js",
        "halo.html",
        "halo.css",
        "halo.js",
        "mark.png",
        "Nunito-Regular.ttf",
        "Nunito-Bold.ttf",
        "Nunito-ExtraBold.ttf",
        "Nunito-Black.ttf",
      ].includes(name)
    )
      return new Response("", { status: 404 });
    return net.fetch(pathToFileURL(join(root, name)).href);
  });
  panel = secureWindow({ width: 360, height: 520, sidebar: true });
  panel.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      hideSidebar();
    }
  });
  ipcMain.handle(
    "squeek:request",
    async (event, action: unknown, value: unknown) => {
      const url = event.senderFrame?.url;
      const mainFrame = event.senderFrame === event.sender.mainFrame;
      try {
        if (
          panel &&
          event.sender === panel.webContents &&
          allowedFrame(url ?? "", mainFrame)
        ) {
          const input = validateInput(action, value);
          if (action === "state") return structuredClone(state);
          if (action === "show") {
            companion?.showSidebar(true);
            return undefined;
          }
          if (action === "hide") {
            hideSidebar();
            return undefined;
          }
          if (action === "monitor") {
            const settings = input as {
              enabled: boolean;
              browser: "chrome" | "msedge";
            };
            if (settings.enabled) {
              await startMonitoring(settings.browser);
            } else pause();
            return structuredClone(state);
          }
          if (action === "cloud") {
            setCloudEnabled(input as boolean);
            return structuredClone(state);
          }
          if (action === "check") {
            pause();
            state.health = "manual";
            const generation = state.revision;
            manualAbort = new AbortController();
            const assessment = await assess(
              observation(input as string, ++manualRevision),
              {
                signal: manualAbort.signal,
                ...(providerGate.provider()
                  ? { provider: providerGate.provider()! }
                  : {}),
              },
            );
            if (generation === state.revision) {
              acceptAssessment(assessment);
            }
            return structuredClone(state);
          }
          if (action === "demo") {
            await openDemo();
            return undefined;
          }
        }
        if (
          demo &&
          event.sender === demo.webContents &&
          url === "squeek://app/demo.html" &&
          mainFrame
        ) {
          if (action === "demo-check") {
            reviews.invalidate();
            const fields = parseDemo(value);
            const rev = ++manualRevision;
            const result = await assess(observation(fields.message, rev));
            if (rev !== manualRevision) throw Error("Stale request");
            demoAssessment = result;
            demoAction = {
              ...fields,
              sourceId: sourceId(result.source),
              revision: rev,
            };
            return result;
          }
          if (action === "demo-review") {
            const fields = parseDemo(value);
            if (
              !demoAssessment ||
              !demoAction ||
              !Object.entries(fields).every(
                ([key, val]) =>
                  demoAction?.[key as keyof ReviewedAction] === val,
              )
            )
              throw Error("Review required");
            return reviews.request(demoAction, demoAssessment, Date.now());
          }
          if (action === "demo-approve") {
            if (typeof value !== "object" || !value)
              throw Error("Invalid request");
            const v = value as { id: unknown; fields: unknown };
            const fields = parseDemo(v.fields);
            if (
              typeof v.id !== "string" ||
              !demoAction ||
              !Object.entries(fields).every(
                ([key, val]) =>
                  demoAction?.[key as keyof ReviewedAction] === val,
              )
            )
              throw Error("Review required");
            return (
              reviews.approve(v.id, demoAction, Date.now()) &&
              reviews.consume(demoAction, Date.now())
            );
          }
          if (action === "demo-invalidate") {
            reviews.invalidate();
            demoAction = undefined;
            demoAssessment = undefined;
            return undefined;
          }
        }
      } catch {
        throw Error("Request unavailable");
      }
      throw Error("Request unavailable");
    },
  );
  await panel.loadURL("squeek://app/index.html");
  halo = new BrowserWindow({
    ...screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
    frame: false,
    transparent: true,
    show: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(root, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The ghost animates continuously while the overlay sits behind other work.
      backgroundThrottling: false,
    },
  });
  halo.setIgnoreMouseEvents(true);
  halo.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  halo.webContents.on("will-navigate", (event) => event.preventDefault());
  await halo.loadURL("squeek://app/halo.html");
  companion = new Companion({
    panel,
    halo,
    cursor: () => screen.getCursorScreenPoint(),
    workArea: (point) => screen.getDisplayNearestPoint(point).workArea,
    pointer: (value) => {
      if (halo && !halo.isDestroyed())
        halo.webContents.send("squeek:pointer", value);
    },
    alert: (alertState) => {
      if (alertState === "high_risk" && halo && !halo.isDestroyed())
        halo.webContents.send("squeek:say", { text: warning });
    },
  });
  companion.start();
  const icon = nativeImage
    .createFromPath(join(root, "tray-icon.png"))
    .resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("Squeek");
  tray.on("click", () => tray?.popUpContextMenu());
  tray.on("double-click", () => companion?.showSidebar(true));
  publish();
});
app.on("before-quit", () => {
  quitting = true;
  pause();
  companion?.stop();
  reviews.invalidate();
  tray?.destroy();
});
app.on("window-all-closed", () => app.quit());
