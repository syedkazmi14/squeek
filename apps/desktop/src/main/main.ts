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
  safeStorage,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { createObserverClient } from "./observer-client.ts";
import { Monitoring } from "./monitoring.ts";
import { Companion } from "./companion.ts";
import { warning } from "../renderer/incident.ts";
import { allowedFrame, validateInput } from "./ipc-policy.ts";
import { ProviderGate } from "./provider-gate.ts";
import { createTts } from "./tts.ts";
import { LinkGuard, type LinkChoice, type LinkView } from "./link-guard.ts";
import { createConversation } from "./conversation.ts";
import { PushToTalk, watchTalkKey } from "./push-to-talk.ts";
import { createSync, incidentFor } from "./sync.ts";
import { createJevProvider } from "../../../../packages/providers/src/jev.ts";
import {
  assess,
  sourceId,
  type Assessment,
} from "../../../../packages/detection/src/index.ts";
import { AssessmentScheduler } from "../../../../packages/detection/src/scheduler.ts";
import { focusObservation } from "../../../../packages/detection/src/focus.ts";
import {
  extractSender,
  looksLikePerson,
  rememberSender,
  senderChecks,
  type KnownSenders,
  type SenderCheck,
} from "../../../../packages/detection/src/sender.ts";
import {
  createEmailReview,
  type EmailReview,
  type SenderLookup,
} from "./email-review.ts";
import { createDomainFacts } from "./domain-facts.ts";
import {
  ActionReview,
  type ReviewedAction,
} from "../../../../packages/detection/src/action-review.ts";
import type { Observation } from "../../../../packages/contracts/src/observation.ts";
const root = dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "squeek",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // Lets <audio> play ElevenLabs speech while it is still downloading.
      stream: true,
    },
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
// Whatever text the panel asks to hear is sent to ElevenLabs to be spoken.
const tts = createTts(
  !app.isPackaged
    ? process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY
    : undefined,
  (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
);
// Voice conversation with the ghost. Speech and the reply context go to OpenAI.
const conversation = createConversation(
  !app.isPackaged
    ? process.env.OPENAI_API_KEY || process.env.OPEN_API
    : undefined,
  (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
);
// Reads an opened email for scams the local rules miss. The redacted email goes to OpenAI.
const emailReview = createEmailReview(
  !app.isPackaged
    ? process.env.OPENAI_API_KEY || process.env.OPEN_API
    : undefined,
  (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
);
const domainFacts = createDomainFacts((input, init) =>
  net.fetch(input instanceof URL ? input.href : input, init),
);
// Senders seen in opened emails, so a familiar name from a new address stands out. Local only.
const knownSendersFile = join(app.getPath("userData"), "known-senders.json");
let knownSenders: KnownSenders = {};
// What the user chose to tell Squeek about themselves, so a lookup can spot a real
// connection ("you both went to Lincoln High"). Local only; sent with a lookup.
const profileFile = join(app.getPath("userData"), "about-me.txt");
let profile = "";
void readFile(profileFile, "utf8")
  .then((text) => {
    profile = text.slice(0, 300);
    state.profile = profile;
    publish();
  })
  .catch(() => {});
void readFile(knownSendersFile, "utf8")
  .then((text) => {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      knownSenders = parsed as KnownSenders;
  })
  .catch(() => {});
// Links this PC to the iPhone's account: the same email on both is the same account, so a scam
// found on one shows up on the other. Development builds only until the packaged-cloud gate is lifted.
const syncFile = join(app.getPath("userData"), "iphone-link.bin");
const sync = createSync(
  !app.isPackaged &&
    process.env.SQUEEK_SUPABASE_URL &&
    process.env.SQUEEK_SUPABASE_ANON_KEY
    ? {
        url: process.env.SQUEEK_SUPABASE_URL,
        anonKey: process.env.SQUEEK_SUPABASE_ANON_KEY,
      }
    : undefined,
  (input, init) => net.fetch(input, init),
  {
    // The saved login is encrypted with Windows' own user-bound protection, or not saved at all.
    async load() {
      if (!safeStorage.isEncryptionAvailable()) return undefined;
      try {
        return safeStorage.decryptString(await readFile(syncFile));
      } catch {
        return undefined;
      }
    },
    async save(value) {
      if (safeStorage.isEncryptionAvailable())
        await writeFile(syncFile, safeStorage.encryptString(value));
    },
    async clear() {
      await rm(syncFile, { force: true });
    },
  },
  { deviceName: hostname(), appVersion: app.getVersion() },
);
let announcedPhoneWarning: string | undefined;
let talkKey: { stop: () => void } | undefined;
let talkAbort: AbortController | undefined;
let manualAbort: AbortController | undefined;
let quitting = false;
let companion: Companion | undefined;
let reviewExpiry: ReturnType<typeof setTimeout> | undefined;
let state: {
  providerConfigured: boolean;
  cloudEnabled: boolean;
  cloudVoice: boolean;
  voiceChat: boolean;
  monitoring: boolean;
  health: string;
  revision: number;
  browser: "chrome" | "msedge";
  assessmentCurrent?: boolean;
  assessment?: Assessment;
  sender?: SenderView;
  profile?: string;
} = {
  providerConfigured: providerGate.configured,
  cloudEnabled: false,
  cloudVoice: tts.configured,
  voiceChat: conversation.configured,
  monitoring: false,
  health: "paused",
  revision: 0,
  browser: "chrome",
};
interface SenderView {
  name: string;
  address: string;
  checks: SenderCheck[];
  review?:
    | { status: "checking" }
    | { status: "unavailable" }
    | ({ status: "done" } & EmailReview);
  lookup?:
    | { status: "checking" }
    | { status: "unavailable" }
    | ({ status: "done" } & SenderLookup);
}
let scheduler: AssessmentScheduler | undefined;
// Which opened email the sender card describes; async results for any other are dropped.
let senderTarget: string | undefined;
let senderAbort: AbortController | undefined;
let senderTimer: ReturnType<typeof setTimeout> | undefined;
// The last page read, kept so moving the cursor to another inbox row can be
// judged without waiting for the page to change.
let pageObservation: Observation | undefined;
let focusKey: string | undefined;
let focusTimer: ReturnType<typeof setInterval> | undefined;
/** What the panel sees: the app's state plus the link to the iPhone. */
// `available` is true in development builds, so the iPhone section is always shown there, with a hint
// when the backend settings are missing, instead of silently not being in the sidebar.
const snapshot = () => ({
  ...structuredClone(state),
  sync: { ...sync.view(), available: !app.isPackaged },
});
const publish = () => {
  if (panel && !panel.isDestroyed())
    panel.webContents.send("squeek:state", snapshot());
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
function haloReady(): BrowserWindow | undefined {
  return halo && !halo.isDestroyed() ? halo : undefined;
}
/** The overlay is click-through except over a link warning, where it holds the click. */
let capturing = false;
let captureTimer: ReturnType<typeof setInterval> | undefined;
function captureClicks(on: boolean) {
  if (on === capturing) return;
  capturing = on;
  haloReady()?.setIgnoreMouseEvents(!on, { forward: true });
}
/** While a link is guarded, follow the cursor and hold clicks only on the ring or card. */
function watchGuard(active: boolean) {
  if (active && !captureTimer)
    captureTimer = setInterval(
      () => captureClicks(linkGuard.holdsClick(screen.getCursorScreenPoint())),
      16,
    );
  else if (!active && captureTimer) {
    clearInterval(captureTimer);
    captureTimer = undefined;
    captureClicks(false);
  }
}
const linkGuard = new LinkGuard({
  toDip: (rect) => screen.screenToDipRect(null, rect),
  cursor: () => screen.getCursorScreenPoint(),
  show: (view?: LinkView) => {
    const overlay = haloReady();
    watchGuard(!!view?.guarded);
    if (!overlay) return;
    // The overlay spans one display's work area; draw relative to it.
    const origin = overlay.getBounds();
    overlay.webContents.send(
      "squeek:link",
      view && {
        ...view,
        rect: { ...view.rect, x: view.rect.x - origin.x, y: view.rect.y - origin.y },
      },
    );
  },
  say: (text, ms) => haloReady()?.webContents.send("squeek:say", { text, ms }),
  speak: (text) => {
    if (panel && !panel.isDestroyed()) panel.webContents.send("squeek:speak", { text });
  },
  open: (url) => void shell.openExternal(url).catch(() => {}),
  daysOld: (domain) => domainFacts.daysOld(domain),
});
const monitor = new Monitoring({
  createSession: () => createObserverClient(resource),
  onObservation: (observation) => {
    pageObservation = observation;
    assessFocused();
  },
  onLink: (link) => linkGuard.hover(link),
  onHealth: (health) => {
    // Opening Squeek's own panel takes the foreground from the browser. That is the
    // user reading the result, not leaving the page: keep it until they go elsewhere.
    if (health.state !== "available" && squeekInUse()) return;
    state.health = health.code;
    if (health.state !== "available") {
      pageObservation = undefined;
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
    // Hovering from row to row re-checks locally; the provider keeps its own budget.
    maxRequests: 5000,
  });
}
/** Judges the latest page, narrowed to the inbox row under the cursor if it is a list. */
function assessFocused() {
  if (!pageObservation) return;
  const cursor = screen.dipToScreenPoint(screen.getCursorScreenPoint());
  const focused = focusObservation(pageObservation, cursor);
  focusKey = focused.key;
  describeSender(focused.observation, focused.key === "page");
  scheduler?.observe(focused.observation);
}
function clearSender() {
  senderTarget = undefined;
  senderAbort?.abort();
  senderAbort = undefined;
  if (senderTimer) clearTimeout(senderTimer);
  senderTimer = undefined;
}
/**
 * Fills the sender card for an opened email (or a contact card): local checks
 * at once, then the domain's public record and, for an opened email, an AI read.
 */
function describeSender(observation: Observation, opened: boolean) {
  const sender = extractSender(observation);
  if (!sender) {
    if (state.sender) {
      clearSender();
      delete state.sender;
      state.revision++;
      publish();
    }
    return;
  }
  const text = observation.spans.map((span) => span.text).join("\n");
  const target = `${sender.address}\n${opened}\n${text}`;
  if (target === senderTarget) return;
  const sameSender =
    !!state.sender &&
    (state.sender.address === sender.address ||
      (!!sender.name && state.sender.name === sender.name));
  clearSender();
  senderTarget = target;
  const checks = senderChecks(sender, knownSenders);
  state.sender = {
    name: sender.name,
    address: sender.address,
    // Keep facts already found for this sender while the page settles.
    checks: sameSender ? mergeChecks(checks, state.sender!.checks) : checks,
    ...(sameSender && state.sender!.lookup ? { lookup: state.sender!.lookup } : {}),
    ...(sameSender && state.sender!.review
      ? { review: state.sender!.review }
      : opened && emailReview.configured
        ? { review: { status: "checking" as const } }
        : {}),
  };
  state.revision++;
  publish();
  void domainFacts.lookup(sender.domain).then((facts) => {
    if (senderTarget !== target || !state.sender) return;
    state.sender.checks = mergeChecks(state.sender.checks, facts);
    state.revision++;
    publish();
  });
  const remember = () => {
    knownSenders = rememberSender(knownSenders, sender);
    void writeFile(knownSendersFile, JSON.stringify(knownSenders)).catch(() => {});
  };
  if (!opened || !emailReview.configured) {
    if (!checks.some((c) => c.tone === "warn")) remember();
    return;
  }
  const abort = new AbortController();
  senderAbort = abort;
  // Answer at once, so they know Squeek is on it.
  if (!sameSender) acknowledge(sender.name || sender.address);
  // A person may be someone the reader knows: look them up alongside the read, not after it.
  const person = looksLikePerson(sender.name);
  // An email paints in pieces as it opens; read it once it has briefly settled.
  senderTimer = setTimeout(() => {
    senderTimer = undefined;
    if (person && state.sender?.lookup?.status !== "done")
      lookUp(target, sender, "", abort.signal);
    const review = emailReview.review(sender, state.sender?.checks ?? checks, text, abort.signal);
    void review
      .then((result) => {
        if (senderTarget !== target || !state.sender) return;
        state.sender.review = { status: "done", ...result };
        if (result.verdict === "safe" || result.verdict === "unsure") {
          if (!checks.some((c) => c.tone === "warn")) remember();
        }
        if (state.assessment && state.assessmentCurrent)
          acceptAssessment(state.assessment);
        else {
          state.revision++;
          publish();
        }
        talkAbout(sender.name || sender.address, result);
        if (!person && result.verdict !== "safe" && sender.name)
          lookUp(target, sender, result.reason, abort.signal);
      })
      .catch(() => {
        if (senderTarget !== target || !state.sender || abort.signal.aborted)
          return;
        state.sender.review = { status: "unavailable" };
        state.revision++;
        publish();
      });
  }, 250);
}
/** An instant word in the bubble when an email opens; the spoken read follows shortly. */
function acknowledge(who: string) {
  ghostSays(`Let me read this email from ${who} for you…`, 4000);
}
// Rows Squeek has already offered to read, so it says so once per email.
const offeredRows = new Map<string, number>();
let hoveredRow: { key: string; since: number; texts: string[] } | undefined;
/**
 * After the cursor rests on an inbox row, Squeek explains it can only see a
 * preview and offers to read the whole email once it's opened.
 */
function offerToRead(key: string, texts: string[] | undefined) {
  const now = Date.now();
  // On a link, the link check speaks instead.
  if (!texts || linkGuard.hovering) {
    hoveredRow = undefined;
    return;
  }
  if (hoveredRow?.key !== key) {
    hoveredRow = { key, since: now, texts };
    return;
  }
  if (now - hoveredRow.since < 1500) return;
  const id = texts.slice(0, 2).join("|");
  if (now - (offeredRows.get(id) ?? 0) < 10 * 60_000) return;
  // A row that already raised a warning has been spoken about.
  if (state.assessment && ["high_risk", "caution"].includes(state.assessment.state)) return;
  offeredRows.set(id, now);
  const who = texts[0]?.trim();
  const text = `${who ? `This one is from ${who}. ` : ""}I can only see a little of it from here. Click on it to open it, and I'll read the whole email and check who sent it.`;
  ghostSays(text);
  if (panel && !panel.isDestroyed()) panel.webContents.send("squeek:speak", { text });
}
// Who Squeek last talked about, so pointing at a name (which repaints the email) doesn't repeat it.
const spokenAbout = new Map<string, { verdict: string; at: number }>();
const verdictRank: Record<string, number> = { safe: 0, unsure: 1, suspicious: 2, scam: 3 };
/** Says the review out loud, warmly, and invites the user to talk it over. */
function talkAbout(who: string, review: EmailReview) {
  if (review.verdict === "safe") return;
  const key = who.toLowerCase();
  const before = spokenAbout.get(key);
  if (before && Date.now() - before.at < 10 * 60_000 && verdictRank[before.verdict]! >= verdictRank[review.verdict]!)
    return;
  spokenAbout.set(key, { verdict: review.verdict, at: Date.now() });
  const invite = conversation.configured
    ? " If you'd like to talk it over, hold down the Control key and speak to me. Let go when you're done."
    : "";
  const text = `${review.say}${invite}`;
  ghostSays(`${review.say}${invite ? " Hold Ctrl to talk to me." : ""}`);
  if (panel && !panel.isDestroyed()) panel.webContents.send("squeek:speak", { text });
}
/** A short public web search on the sender, shown on the card and known to the conversation. */
function lookUp(target: string, sender: { name: string; address: string; domain: string }, claim: string, signal: AbortSignal) {
  if (!state.sender) return;
  state.sender.lookup = { status: "checking" };
  state.revision++;
  publish();
  void emailReview
    .lookup(sender, claim, profile, signal)
    .then((found) => {
      if (senderTarget !== target || !state.sender) return;
      state.sender.lookup = { status: "done", ...found };
      state.revision++;
      publish();
    })
    .catch(() => {
      if (senderTarget !== target || !state.sender || signal.aborted) return;
      state.sender.lookup = { status: "unavailable" };
      state.revision++;
      publish();
    });
}
function mergeChecks(a: SenderCheck[], b: SenderCheck[]): SenderCheck[] {
  return [...a, ...b.filter((c) => !a.some((d) => d.id === c.id))];
}
/** A scam the AI read found raises the page's verdict; it never lowers one. */
function withReview(assessment: Assessment): Assessment {
  const review = state.sender?.review;
  if (review?.status !== "done") return assessment;
  const raised =
    review.verdict === "scam"
      ? "high_risk"
      : review.verdict === "suspicious"
        ? "caution"
        : undefined;
  if (!raised) return assessment;
  const rank = { unknown: 0, no_detected_signal: 0, caution: 1, high_risk: 2 };
  const evidence = assessment.evidence.some((e) => e.ruleId === "ai_review")
    ? assessment.evidence
    : [...assessment.evidence, { ruleId: "ai_review", spanIndex: -1, excerpt: review.reason }];
  return {
    ...assessment,
    state: rank[raised] > rank[assessment.state] ? raised : assessment.state,
    evidence,
  };
}
function watchFocus(on: boolean) {
  if (focusTimer) clearInterval(focusTimer);
  focusTimer = undefined;
  pageObservation = undefined;
  focusKey = undefined;
  clearSender();
  if (!on) return;
  focusTimer = setInterval(() => {
    // Moving to Squeek's panel to read the result must not change what it describes.
    if (!pageObservation || squeekInUse()) return;
    const cursor = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    const focused = focusObservation(pageObservation, cursor);
    if (focused.key !== focusKey) assessFocused();
    offerToRead(focused.key, focused.row);
  }, 250);
}
/** True while the user is in, or pointing at, one of Squeek's own windows. */
function squeekInUse(): boolean {
  if (BrowserWindow.getFocusedWindow()) return true;
  const cursor = screen.getCursorScreenPoint();
  return [panel, demo].some((window) => {
    if (!window || window.isDestroyed() || !window.isVisible()) return false;
    const b = window.getBounds();
    return cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
  });
}
function acceptAssessment(incoming: Assessment) {
  const assessment = withReview(incoming);
  if (reviewExpiry) clearTimeout(reviewExpiry);
  state.assessment = assessment;
  state.assessmentCurrent = true;
  state.revision++;
  publish();
  companion?.assessment(assessment);
  // Tell the iPhone too. Only a short redacted warning is sent, and a failure never affects the PC.
  const forPhone = incidentFor(
    assessment,
    state.health === "manual" ? "text" : "browser",
  );
  if (forPhone) void sync.reportIncident(forPhone);
  reviewExpiry = setTimeout(() => {
    // While the same page is still being watched, its result still stands.
    if (state.monitoring && state.health === "watching") return;
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
  tts.keepWarm(true);
  scheduler = makeScheduler();
  watchFocus(true);
  publish();
  await monitor.start(browser);
}
/** Shows a line in the ghost's speech bubble, long enough to read. */
// Paced for slower readers: the words type in at the voice's pace, then stay a while.
function ghostSays(text: string, ms = 7000 + (text.length / 14) * 1000) {
  const shown = text.length > 480 ? `${text.slice(0, 479)}…` : text;
  haloReady()?.webContents.send("squeek:say", {
    text: shown,
    ms: Math.min(45000, ms),
  });
}
/** What the ghost can see, for the conversation. Excerpts and verdicts only. */
function conversationContext(): string {
  const lines = [
    state.monitoring
      ? `Watching the user's ${state.browser === "msedge" ? "Edge" : "Chrome"} window.`
      : "Not watching any page right now (monitoring is paused).",
  ];
  const assessment = state.assessmentCurrent ? state.assessment : undefined;
  if (assessment?.state === "high_risk" || assessment?.state === "caution")
    lines.push(
      `The page shows scam warning signs (${assessment.state === "high_risk" ? "high risk" : "caution"}). Evidence: ${assessment.evidence
        .map((item) => `"${item.excerpt}"`)
        .join(", ")}.`,
    );
  else if (assessment)
    lines.push("Nothing suspicious detected on the current page.");
  const sender = state.sender;
  if (sender) {
    lines.push(
      `The user has an email open from ${sender.name || "someone"}${sender.address ? ` <${sender.address}>` : " (address hidden; pointing at the name shows it)"}.`,
    );
    for (const check of sender.checks) lines.push(`Sender check: ${check.text}`);
    if (sender.review?.status === "done")
      lines.push(
        `Your read of the email: ${sender.review.verdict} (${sender.review.kind.replace(/_/g, " ")}). ${sender.review.reason} Advice: ${sender.review.advice}`,
      );
    if (sender.lookup?.status === "done")
      lines.push(
        `A quick public web search on the sender found: ${sender.lookup.summary} (A real person existing does not prove they sent it.)`,
      );
    else if (sender.lookup?.status === "checking")
      lines.push("You are still looking the sender up online.");
  }
  if (profile) lines.push(`What the user has told you about themselves: ${profile}`);
  const link = linkGuard.recent();
  if (link)
    lines.push(
      `The user recently hovered a link to ${link.host || "an unknown place"}: ${
        link.state === "high_risk"
          ? "it looks like a scam"
          : link.state === "caution"
            ? "it needs caution"
            : link.state === "unknown"
              ? "you couldn't tell where it goes"
              : "it looked OK"
      }${link.reasons.length ? ` (${link.reasons.join("; ")})` : ""}.`,
    );
  return lines.join("\n");
}
/** Tells the panel to start, finish or cancel listening; no mode toggles it. */
function listen(mode?: "hold" | "finish" | "cancel") {
  if (!conversation.configured || !panel || panel.isDestroyed()) return;
  if (mode !== "finish" && mode !== "cancel") conversation.warm();
  panel.webContents.send("squeek:listen", mode);
}
const toggleTalk = () => listen();
// Hold Ctrl to talk to the ghost; letting go ends the user's turn.
const pushToTalk = new PushToTalk({
  start: () => listen("hold"),
  finish: () => listen("finish"),
  cancel: () => listen("cancel"),
});
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
      {
        label: "Talk to Squeek (or hold Ctrl)",
        enabled: conversation.configured,
        click: toggleTalk,
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
const monitoringStatus = () => (state.monitoring ? "monitoring" : "paused");
/** What the ghost says when the iPhone has just caught a scam, once per warning. */
function phoneWarningLine(surface: string): string {
  const what =
    surface === "call"
      ? "a scam call"
      : surface === "sms"
        ? "a scam text"
        : surface === "browser" || surface === "link"
          ? "a risky website"
          : "a likely scam";
  return `Your iPhone just caught ${what}. Please talk to someone you trust before you pay anyone.`;
}
async function pollPhone() {
  const warning = await sync.checkPhone();
  if (warning && warning.id !== announcedPhoneWarning) {
    announcedPhoneWarning = warning.id;
    ghostSays(phoneWarningLine(warning.surface), 12000);
  }
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
  tts.keepWarm(false);
  linkGuard.reset();
  watchFocus(false);
  monitor.stop();
  scheduler?.pause();
  scheduler = undefined;
  state = {
    providerConfigured: providerGate.configured,
    cloudEnabled: state.cloudEnabled,
    cloudVoice: tts.configured,
    voiceChat: conversation.configured,
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
  // The only permission granted anywhere: the panel's microphone, for talking to the ghost.
  const panelMicrophone = (
    webContents: Electron.WebContents | null,
    permission: string,
    origin: string,
    mediaTypes: readonly string[] = ["audio"],
  ) =>
    conversation.configured &&
    permission === "media" &&
    !!panel &&
    !panel.isDestroyed() &&
    webContents === panel.webContents &&
    origin.startsWith("squeek://app") &&
    mediaTypes.length > 0 &&
    mediaTypes.every((type) => type === "audio");
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) =>
      callback(
        panelMicrophone(
          webContents,
          permission,
          details.requestingUrl,
          "mediaTypes" in details ? (details.mediaTypes ?? []) : [],
        ),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, origin) =>
      panelMicrophone(webContents, permission, origin),
  );
  protocol.handle("squeek", (request) => {
    const url = new URL(request.url);
    if (url.hostname === "app" && url.pathname === "/tts")
      return tts.handle(request);
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
  tts.warm();
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
          if (action === "state") return snapshot();
          if (action === "listening") {
            if (input === "start") ghostSays("I'm listening…", 15000);
            else if (input === "hold")
              ghostSays("I'm listening… let go of Ctrl when you're done.", 15000);
            else if (input === "nothing")
              ghostSays("I didn't hear anything. Hold Ctrl while you talk, then let go.");
            else if (input === "cancel")
              haloReady()?.webContents.send("squeek:say", { clear: true });
            return undefined;
          }
          if (action === "talk") {
            talkAbort?.abort();
            const abort = (talkAbort = new AbortController());
            ghostSays("Let me think…", 15000);
            try {
              const turn = await conversation.respond(
                input as Uint8Array,
                conversationContext(),
                abort.signal,
              );
              const reply = turn.heard
                ? turn.reply || "Sorry, I don't have an answer for that."
                : "Sorry, I didn't catch that. Could you say it again?";
              ghostSays(reply);
              return { heard: turn.heard, reply };
            } catch {
              if (abort.signal.aborted) return { heard: "", reply: "" };
              const reply = "Sorry, I can't talk right now. Please try again in a moment.";
              ghostSays(reply);
              return { heard: "", reply };
            } finally {
              if (talkAbort === abort) talkAbort = undefined;
            }
          }
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
            return snapshot();
          }
          if (action === "cloud") {
            setCloudEnabled(input as boolean);
            return snapshot();
          }
          if (action === "sync-signin") {
            // A failure shows on the panel through the sync view; it is not thrown.
            await sync
              .signIn(input as string, monitoringStatus())
              .catch(() => {});
            void pollPhone();
            publish();
            return snapshot();
          }
          if (action === "profile") {
            profile = input as string;
            state.profile = profile;
            await writeFile(profileFile, profile).catch(() => {});
            publish();
            return snapshot();
          }
          if (action === "sync-signout") {
            await sync.signOut();
            announcedPhoneWarning = undefined;
            publish();
            return snapshot();
          }
          if (action === "check") {
            pause();
            tts.warm();
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
            return snapshot();
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
  // Forwarded mouse moves let the overlay notice the cursor reaching a link warning.
  halo.setIgnoreMouseEvents(true, { forward: true });
  const fromHalo = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !!halo &&
    !halo.isDestroyed() &&
    event.sender === halo.webContents &&
    event.senderFrame === halo.webContents.mainFrame &&
    event.senderFrame?.url === "squeek://app/halo.html";
  ipcMain.on("squeek:link-card", (event, rect: unknown) => {
    if (!fromHalo(event) || !halo) return;
    const r = rect as Record<string, unknown> | null;
    const valid =
      !!r &&
      ["x", "y", "width", "height"].every(
        (key) =>
          typeof r[key] === "number" &&
          Number.isFinite(r[key]) &&
          Math.abs(r[key]) < 100000,
      ) &&
      (r.width as number) > 0 &&
      (r.height as number) > 0 &&
      (r.width as number) <= 600 &&
      (r.height as number) <= 600;
    const origin = halo.getBounds();
    linkGuard.setCard(
      valid
        ? {
            x: origin.x + (r.x as number),
            y: origin.y + (r.y as number),
            width: r.width as number,
            height: r.height as number,
          }
        : undefined,
    );
  });
  ipcMain.handle("squeek:link-choice", (event, choice: unknown) => {
    if (!fromHalo(event) || !["ask", "back", "open"].includes(choice as string))
      return false;
    return linkGuard.choose(choice as LinkChoice);
  });
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
  void sync.restore(monitoringStatus()).then(() => pollPhone());
  setInterval(() => void sync.heartbeat(monitoringStatus()), 60_000).unref();
  setInterval(() => void pollPhone(), 20_000).unref();
  if (conversation.configured) {
    talkKey = watchTalkKey(resource, (event) => pushToTalk.key(event));
    conversation.warm();
  }
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
  void sync.heartbeat("offline");
  pause();
  talkAbort?.abort();
  talkKey?.stop();
  companion?.stop();
  reviews.invalidate();
  tray?.destroy();
});
app.on("window-all-closed", () => app.quit());
