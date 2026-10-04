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
let state: {
  providerConfigured: boolean;
  cloudEnabled: boolean;
  monitoring: boolean;
  health: string;
  revision: number;
  assessment?: Assessment;
} = {
  providerConfigured: providerGate.configured,
  cloudEnabled: false,
  monitoring: false,
  health: "paused",
  revision: 0,
};
let scheduler: AssessmentScheduler | undefined;
const publish = () => {
  if (panel && !panel.isDestroyed())
    panel.webContents.send("squeek:state", state);
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
    onResult: (assessment) => {
      state.assessment = assessment;
      state.revision++;
      publish();
      if (assessment.state === "high_risk") panel?.showInactive();
    },
  });
}
function pause() {
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
  };
  if (halo && !halo.isDestroyed()) halo.hide();
  publish();
}
function secureWindow(options: { width: number; height: number }) {
  const window = new BrowserWindow({
    ...options,
    minWidth: 480,
    minHeight: 600,
    show: false,
    backgroundColor: "#f5f1e8",
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
  window.once("ready-to-show", () => window.show());
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
app.whenReady().then(async () => {
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
      ].includes(name)
    )
      return new Response("", { status: 404 });
    return net.fetch(pathToFileURL(join(root, name)).href);
  });
  panel = secureWindow({ width: 560, height: 820 });
  panel.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      panel?.hide();
    }
    pause();
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
          if (action === "monitor") {
            pause();
            const settings = input as {
              enabled: boolean;
              browser: "chrome" | "msedge";
            };
            if (settings.enabled) {
              state.monitoring = true;
              state.health = "starting";
              scheduler = makeScheduler();
              publish();
              await monitor.start(settings.browser);
            }
            return structuredClone(state);
          }
          if (action === "cloud") {
            pause();
            providerGate.setEnabled(input as boolean);
            state.cloudEnabled = input as boolean;
            publish();
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
              state.assessment = assessment;
              state.revision++;
              publish();
            }
            return structuredClone(state);
          }
          if (action === "demo") {
            if (!demo || demo.isDestroyed()) {
              demo = secureWindow({ width: 680, height: 800 });
              await demo.loadURL("squeek://app/demo.html");
              demo.on("closed", () => {
                reviews.invalidate();
                demoAction = undefined;
                demoAssessment = undefined;
              });
            } else demo.show();
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
    width: 48,
    height: 48,
    frame: false,
    transparent: true,
    show: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  halo.setIgnoreMouseEvents(true);
  halo.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  halo.webContents.on("will-navigate", (event) => event.preventDefault());
  await halo.loadURL("squeek://app/halo.html");
  const follow = setInterval(() => {
    if (!halo || halo.isDestroyed()) return;
    if (
      !state.monitoring ||
      !["watching", "changed", "unchanged"].includes(state.health)
    ) {
      halo.hide();
      return;
    }
    const point = screen.getCursorScreenPoint(),
      area = screen.getDisplayNearestPoint(point).workArea;
    halo.setPosition(
      Math.round(
        Math.max(area.x, Math.min(point.x + 16, area.x + area.width - 48)),
      ),
      Math.round(
        Math.max(area.y, Math.min(point.y + 16, area.y + area.height - 48)),
      ),
    );
    halo.showInactive();
  }, 60);
  app.once("before-quit", () => clearInterval(follow));
  const icon = nativeImage
    .createFromPath(join(root, "icon.png"))
    .resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip("Squeek");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Squeek", click: () => panel?.show() },
      { label: "Pause", click: pause },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
});
app.on("before-quit", () => {
  quitting = true;
  pause();
  reviews.invalidate();
  tray?.destroy();
});
app.on("window-all-closed", () => app.quit());
