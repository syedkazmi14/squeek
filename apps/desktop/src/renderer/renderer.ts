import { animateMascot } from "./mascot.ts";
import { incidentKey, warning } from "./incident.ts";
import { record, type Recording } from "./listen.ts";
interface Assessment {
  source?: {
    processId: number;
    windowHandle: string;
    processStartedAt: number;
  };
  state: string;
  coverage: string;
  evidence: { excerpt: string }[];
  assessedAt?: number;
  providerHealth?: string;
}
interface AppState {
  monitoring: boolean;
  health: string;
  assessment?: Assessment;
  revision: number;
  providerConfigured?: boolean;
  cloudEnabled?: boolean;
  cloudVoice?: boolean;
  voiceChat?: boolean;
  browser?: "chrome" | "msedge";
  assessmentCurrent?: boolean;
}
interface SqueekApi {
  invoke(
    action:
      | "state"
      | "monitor"
      | "check"
      | "demo"
      | "cloud"
      | "hide"
      | "show"
      | "listening"
      | "talk",
    value?: unknown,
  ): Promise<unknown>;
  onListen(callback: (mode: unknown) => void): () => void;
  onState(callback: (state: AppState) => void): () => void;
  onHidden(callback: () => void): () => void;
  onSpeak(callback: (message: unknown) => void): () => void;
}
declare global {
  interface Window {
    squeek: SqueekApi;
  }
}
function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error("Missing interface control");
  return found as T;
}
animateMascot(document.querySelector<HTMLCanvasElement>(".status-mascot")!);
const monitor = element<HTMLButtonElement>("monitor");
const browser = element<HTMLSelectElement>("browser");
const manualText = element<HTMLTextAreaElement>("manual-text");
const check = element<HTMLButtonElement>("check");
const mute = element<HTMLButtonElement>("mute");
const replay = element<HTMLButtonElement>("replay");
const talk = element<HTMLButtonElement>("talk");
const talkHeard = element<HTMLParagraphElement>("talk-heard");
const cancel = element<HTMLButtonElement>("cancel");
const finding = element<HTMLButtonElement>("see-finding");
let current: AppState = { monitoring: false, health: "paused", revision: 0 };
let muted = false;
let pendingActions = 0;
let pendingChecks = 0;
let checkGeneration = 0;
let assessmentKey = "";
// Text waiting for Windows to load its voices.
let pendingSpeech: string | undefined;
// ElevenLabs speech streamed by the main process; plays while it downloads.
const player = new Audio();
// What the player is saying, so a failed stream can be retried locally.
let playing: string | undefined;
// Bluetooth and HDMI outputs power down when idle and drop the first second or
// two of the next sound while they wake, which cut the start off the warning.
// While Squeek is watching, talking with the user, or speaking, it plays an
// inaudible hiss (about -80 dB) so the output stays awake. Pure silence would not
// work: Chromium closes the device, and many outputs sleep through digital silence.
let keepAwake: AudioContext | undefined;
// A conversation keeps the output awake a while after each reply, for follow-ups.
const AWAKE_AFTER_SPEECH_MS = 20000;
let spokeAt = -Infinity;
let awakeTimer: ReturnType<typeof setTimeout> | undefined;
function setOutputAwake(awake: boolean): void {
  if (awake && !keepAwake) {
    keepAwake = new AudioContext({ latencyHint: "playback" });
    const rate = keepAwake.sampleRate;
    const hiss = keepAwake.createBuffer(1, rate, rate);
    const samples = hiss.getChannelData(0);
    for (let i = 0; i < samples.length; i++)
      samples[i] = (Math.random() * 2 - 1) * 1e-4;
    const source = keepAwake.createBufferSource();
    source.buffer = hiss;
    source.loop = true;
    source.connect(keepAwake.destination);
    source.start();
  } else if (!awake && keepAwake) {
    void keepAwake.close().catch(() => {});
    keepAwake = undefined;
  }
}

let view: "overview" | "manual" | "finding" = "overview";
let returnFocus: HTMLElement | undefined;
const resultCopy: Record<
  string,
  { title: string; description: string; next: string }
> = {
  high_risk: {
    title: "This looks suspicious.",
    description: "I spotted strong scam signs in the available text.",
    next: "Avoid sending money or sharing codes. Verify the request through a contact you already trust.",
  },
  caution: {
    title: "Let’s take a closer look.",
    description: "Some details deserve a second look before you act.",
    next: "Pause before responding. Confirm the request using an official contact you find independently.",
  },
  no_detected_signal: {
    title: "No clear scam signs.",
    description:
      "I didn’t spot clear scam signs. This isn’t a guarantee of safety.",
    next: "Stay cautious with requests for money, passwords, or verification codes.",
  },
  unknown: {
    title: "I need a little more context.",
    description:
      "This check couldn’t reach a conclusion from the available text.",
    next: "Try checking the full message, including what the sender is asking you to do.",
  },
};
function result() {
  return (
    resultCopy[current.assessment?.state ?? "unknown"] ?? resultCopy.unknown!
  );
}
function suspicious() {
  return ["high_risk", "caution"].includes(current.assessment?.state ?? "");
}
function availableMonitoring() {
  return (
    current.monitoring && ["watching", "starting"].includes(current.health)
  );
}
function localVoice(): SpeechSynthesisVoice | undefined {
  return window.speechSynthesis
    ?.getVoices()
    .find((voice) => voice.localService && voice.lang.startsWith("en"));
}
function cancelSpeech(): void {
  pendingSpeech = undefined;
  window.speechSynthesis?.cancel();
  playing = undefined;
  if (player.getAttribute("src")) {
    // Dropping the source cancels the stream, which stops the upstream request.
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
}
function speak(): void {
  cancelSpeech();
  if (
    muted ||
    current.assessment?.state !== "high_risk" ||
    current.assessmentCurrent === false
  )
    return;
  say(warning);
}
function say(text: string): void {
  if (current.cloudVoice) {
    playing = text;
    player.src = `squeek://app/tts?${new URLSearchParams({ text })}`;
    // Loading resets playbackRate to the default, so set both.
    player.defaultPlaybackRate = player.playbackRate = 1;
    player.play().catch(() => {});
    return;
  }
  speakLocally(text);
}
player.addEventListener("ended", () => {
  playing = undefined;
  spokeAt = performance.now();
  if (awakeTimer) clearTimeout(awakeTimer);
  awakeTimer = setTimeout(refreshControls, AWAKE_AFTER_SPEECH_MS + 50);
  refreshControls();
});
player.addEventListener("error", () => {
  // ElevenLabs unavailable: say the same words with the local voice instead.
  const failed = playing;
  if (failed === undefined) return;
  cancelSpeech();
  if (!muted) speakLocally(failed);
});
function speakLocally(text: string): void {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  const voice = localVoice();
  // The fallback stays on-device; Chromium's network voices are skipped.
  if (!voice) {
    pendingSpeech = text;
    return;
  }
  utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}
// Talking to the ghost. The button listens until a pause; holding Ctrl listens until
// it is let go. The reply is spoken.
let recording: Recording | undefined;
// How the current question ended. Opening the microphone takes a moment, so a
// release or shortcut can arrive before `recording` exists; it is kept here.
let session: { end?: "stop" | "cancel" } | undefined;
let thinking = false;
async function startTalk(auto: boolean): Promise<void> {
  if (session || !current.voiceChat || thinking) return;
  // Never listen to Squeek's own voice.
  cancelSpeech();
  const start: { end?: "stop" | "cancel" } = (session = {});
  // Wake the output now, while the user speaks, so the reply's first words play.
  refreshControls();
  try {
    recording = await record(auto);
  } catch {
    session = undefined;
    refreshControls();
    talkHeard.textContent = "Squeek couldn't use the microphone.";
    talkHeard.hidden = false;
    return;
  }
  const active = recording;
  if (start.end === "cancel") active.cancel();
  else if (start.end === "stop") active.stop();
  refreshControls();
  if (start.end !== "cancel")
    void window.squeek.invoke("listening", auto ? "start" : "hold");
  const audio = await active.done;
  recording = undefined;
  session = undefined;
  if (!audio) {
    refreshControls();
    void window.squeek.invoke("listening", start.end === "cancel" ? "cancel" : "nothing");
    return;
  }
  thinking = true;
  refreshControls();
  try {
    const turn = (await window.squeek.invoke("talk", audio)) as {
      heard?: unknown;
      reply?: unknown;
    };
    if (typeof turn?.heard === "string" && turn.heard) {
      talkHeard.textContent = `You said: "${turn.heard}"`;
      talkHeard.hidden = false;
    }
    if (typeof turn?.reply === "string" && turn.reply && !muted) say(turn.reply);
  } catch {
    // Main already showed what went wrong in the ghost's bubble.
  } finally {
    thinking = false;
    refreshControls();
  }
}
function endTalk(end: "stop" | "cancel"): void {
  if (!session || session.end) return;
  session.end = end;
  if (end === "cancel") recording?.cancel();
  else recording?.stop();
}
function onListen(mode: unknown): void {
  if (mode === "hold") void startTalk(false);
  else if (mode === "finish") endTalk("stop");
  else if (mode === "cancel") endTalk("cancel");
  else if (session) endTalk("stop");
  else void startTalk(true);
}
function setView(next: typeof view, focus = true): void {
  if (
    view === "overview" &&
    next !== "overview" &&
    document.activeElement instanceof HTMLElement
  )
    returnFocus = document.activeElement;
  view = next;
  element("overview").hidden = view !== "overview";
  element("manual-view").hidden = view !== "manual";
  element("finding-view").hidden = view !== "finding";
  element("panel-content").scrollTop = 0;
  if (focus) {
    if (view === "overview" && returnFocus?.getClientRects().length)
      returnFocus.focus();
    else
      element(
        view === "overview"
          ? "open-manual"
          : view === "manual"
            ? "manual-heading"
            : "assessment-heading",
      ).focus();
  }
}
function refreshControls(): void {
  element("talk-section").hidden = current.voiceChat !== true;
  talk.disabled = thinking;
  talk.textContent = recording
    ? "Stop listening"
    : thinking
      ? "Thinking…"
      : "Talk to Squeek";
  const busy = pendingActions > 0;
  monitor.disabled = busy && !current.monitoring && pendingChecks === 0;
  monitor.textContent =
    pendingChecks > 0
      ? "Cancel check"
      : current.monitoring
        ? "Pause"
        : "Start protection";
  monitor.classList.toggle(
    "quiet-protection",
    current.monitoring || suspicious() || pendingChecks > 0,
  );
  browser.disabled = busy || current.monitoring;
  check.disabled = busy || !manualText.value.trim();
  manualText.disabled = pendingChecks > 0;
  check.textContent = pendingChecks > 0 ? "Checking…" : "Check message";
  cancel.hidden = pendingChecks === 0;
  element("clear-check").textContent = current.monitoring
    ? "Pause and clear check"
    : "Clear this check";
  replay.hidden =
    muted ||
    current.assessment?.state !== "high_risk" ||
    current.assessmentCurrent === false ||
    !(current.cloudVoice || localVoice());
  finding.hidden = !suspicious() || pendingChecks > 0;
  setOutputAwake(
    current.cloudVoice === true &&
      !muted &&
      (current.monitoring ||
        pendingActions > 0 ||
        current.assessment?.state === "high_risk" ||
        // Talking with the ghost: from the moment the user starts until the reply
        // has finished, the reply arrives after seconds of silence otherwise.
        session !== undefined ||
        thinking ||
        playing !== undefined ||
        performance.now() - spokeAt < AWAKE_AFTER_SPEECH_MS),
  );
  refreshStatus();
}
function refreshStatus(): void {
  const name = browser.value === "msedge" ? "Microsoft Edge" : "Chrome";
  let title = "Ready when you are.";
  let description = "";
  let label = "";
  let monitoringText = "Protection paused";
  if (current.monitoring) {
    monitoringText = availableMonitoring()
      ? `${current.health === "starting" ? "Starting" : "Watching"} · foreground ${name} only`
      : `Protection interrupted · ${name}`;
    title = "I’m keeping an eye out.";
    description = `Checking readable text in the active ${name} window.`;
    label = "BROWSER PROTECTION";
    if (current.health === "starting") {
      title = "Getting ready…";
      description = `Starting checks for the active ${name} window.`;
    } else if (!availableMonitoring()) {
      title = "Browser check is unavailable.";
      description =
        current.health === "unsupported_app" ||
        current.health === "foreground_changed" ||
        current.health === "no_foreground"
          ? `Bring ${name} to the front to resume browser checks.`
          : "Pause and restart browser protection, or check a pasted message.";
    }
  }
  if (current.health === "unavailable") {
    title = "I couldn’t finish that check.";
    description = "Try again, or paste the message into a manual check.";
    label = "CHECK UNAVAILABLE";
  }
  if (current.assessment) {
    title = result().title;
    description = result().description;
    label =
      current.assessmentCurrent === false ? "PREVIOUS CHECK" : "LATEST CHECK";
  }
  if (pendingChecks > 0) {
    title = "I’m checking this…";
    description = "Looking for scam signs in your pasted message.";
    label = "CHECK IN PROGRESS";
    monitoringText = "Protection paused during this check";
  }
  const idle =
    !current.monitoring &&
    !current.assessment &&
    current.health === "paused" &&
    pendingChecks === 0;
  element("status-copy").hidden = false;
  const mascotStatus =
    pendingChecks > 0
      ? "checking"
      : current.assessmentCurrent === false && current.assessment
        ? "unknown"
        : current.assessment
          ? ((
              {
                high_risk: "risk",
                caution: "caution",
                no_detected_signal: "neutral",
                unknown: "unknown",
              } as Record<string, string>
            )[current.assessment.state] ?? "unknown")
          : current.health === "unavailable" ||
              (current.monitoring && !availableMonitoring())
            ? "unavailable"
            : current.monitoring
              ? current.health === "starting"
                ? "checking"
                : "watching"
              : "neutral";
  element("status-card").dataset.mascotStatus = mascotStatus;
  element("status-heading").title = description;
  element("status-description").hidden = true;
  element("status-card").dataset.idle = String(idle);
  element("status-heading").textContent = title;
  element("status-description").textContent = description;
  element("status-label").textContent = label;
  element("status-label").hidden = true;
  element("status-card").dataset.tone =
    suspicious() && pendingChecks === 0 ? "warning" : "neutral";
  element("monitoring-state").textContent = monitoringText;
  element("monitoring-state").dataset.active = String(
    current.monitoring && current.health === "watching",
  );
}
function render(next: AppState): void {
  if (
    !next ||
    typeof next.monitoring !== "boolean" ||
    typeof next.health !== "string" ||
    !Number.isSafeInteger(next.revision)
  )
    return;
  const nextKey = incidentKey(next.assessment);
  const changed = assessmentKey !== nextKey;
  const paused = current.monitoring && !next.monitoring;
  const sourceLost =
    current.assessmentCurrent !== false && next.assessmentCurrent === false;
  if (changed || paused || sourceLost) cancelSpeech();
  current = next;
  assessmentKey = nextKey;
  if (current.browser) browser.value = current.browser;
  element("assessment-heading").textContent = result().title;
  element("finding-description").textContent =
    result().description +
    (current.assessment?.coverage === "partial"
      ? " Only the available text was checked."
      : "") +
    (current.assessment?.providerHealth === "unavailable"
      ? " AI review was unavailable; this uses local checks."
      : "");
  element("next-step").textContent = result().next;
  element("finding-summary").dataset.tone = suspicious()
    ? "warning"
    : "neutral";
  element("finding-label").textContent = suspicious()
    ? "LOOK BEFORE YOU ACT"
    : "CHECK RESULT";
  element("last-review").hidden =
    !current.assessment || current.assessmentCurrent !== false;
  const evidence = element("evidence");
  evidence.replaceChildren();
  for (const item of current.assessment?.evidence ?? []) {
    const quote = document.createElement("li");
    quote.textContent = item.excerpt;
    evidence.append(quote);
  }
  element("evidence-section").hidden = !evidence.childElementCount;
  // The backend exposes one transient assessment, not a persisted activity feed.
  element("empty-activity").hidden = !!current.assessment;
  element("latest-check").hidden = !current.assessment;
  element("activity-heading").textContent =
    current.assessmentCurrent === false && current.assessment
      ? "Previous check"
      : "Latest check";
  element("activity-title").textContent =
    (
      {
        high_risk: "Scam signs found",
        caution: "Needs a closer look",
        no_detected_signal: "No clear warning",
        unknown: "More context needed",
      } as Record<string, string>
    )[current.assessment?.state ?? "unknown"] ?? "View check";
  element("activity-icon").textContent = suspicious() ? "!" : "·";
  element("latest-check").dataset.tone = suspicious() ? "warning" : "neutral";
  const timestamp = current.assessment?.assessedAt;
  element("activity-time").textContent =
    timestamp && Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : "View details";
  refreshControls();
  if (view === "finding" && !current.assessment)
    setView(
      "overview",
      element("finding-view").contains(document.activeElement),
    );
  if (changed && !paused) speak();
}
async function invoke(
  action: "monitor" | "check",
  value?: unknown,
): Promise<void> {
  const stopping =
    action === "monitor" &&
    typeof value === "object" &&
    value !== null &&
    "enabled" in value &&
    value.enabled === false;
  if (pendingActions > 0 && !stopping) return;
  if (stopping) checkGeneration++;
  const generation = checkGeneration;
  cancelSpeech();
  pendingActions++;
  if (action === "check") {
    pendingChecks++;
    element("check-feedback").textContent = "I’m checking this…";
  }
  refreshControls();
  try {
    const response = await window.squeek.invoke(action, value);
    if (generation !== checkGeneration) return;
    if (response && typeof response === "object" && "monitoring" in response)
      render(response as AppState);
    if (action === "check" && current.assessment) setView("finding");
  } catch {
    if (generation !== checkGeneration) return;
    element("check-feedback").textContent =
      "I couldn’t finish this check. Please try again.";
    const { assessment: _assessment, ...latest } = current;
    render({ ...latest, health: "unavailable" });
  } finally {
    pendingActions--;
    if (action === "check") {
      pendingChecks--;
      if (element("check-feedback").textContent === "I’m checking this…")
        element("check-feedback").textContent = "";
    }
    refreshControls();
  }
}
monitor.addEventListener("click", () => {
  void invoke("monitor", {
    enabled: !(current.monitoring || pendingChecks > 0),
    browser: browser.value,
  });
});
browser.addEventListener("change", refreshControls);
manualText.addEventListener("input", () => {
  element("check-feedback").textContent = "";
  refreshControls();
});
element<HTMLFormElement>("manual-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (manualText.value.trim()) void invoke("check", manualText.value);
});
for (const id of ["open-manual", "detail-manual"])
  element(id).addEventListener("click", () => setView("manual"));
for (const id of ["see-finding", "latest-check"])
  element(id).addEventListener("click", () => setView("finding"));
for (const back of document.querySelectorAll<HTMLButtonElement>("[data-back]"))
  back.addEventListener("click", () => setView("overview"));
element("cancel").addEventListener("click", () => {
  void invoke("monitor", { enabled: false, browser: browser.value });
});
element("clear-check").addEventListener("click", () => {
  void invoke("monitor", { enabled: false, browser: browser.value });
});
mute.addEventListener("click", () => {
  muted = !muted;
  const label = muted ? "Unmute warning audio" : "Mute warning audio";
  mute.setAttribute("aria-label", label);
  mute.title = label;
  mute.setAttribute("aria-pressed", String(muted));
  cancelSpeech();
  refreshControls();
});
replay.addEventListener("click", () => speak());
talk.addEventListener("click", () => onListen(undefined));
element("close").addEventListener("click", () => {
  cancelSpeech();
  void window.squeek.invoke("hide").catch(() => {});
});
window.speechSynthesis?.addEventListener("voiceschanged", () => {
  refreshControls();
  if (pendingSpeech !== undefined && localVoice()) speakLocally(pendingSpeech);
});
render(current);
if (window.squeek) {
  const unsubscribe = window.squeek.onState(render);
  const stopHiddenListener = window.squeek.onHidden(() => {
    checkGeneration++;
    cancelSpeech();
  });
  const stopListenListener = window.squeek.onListen(onListen);
  // Link warnings from the hover check, spoken even while the panel is hidden.
  const stopSpeakListener = window.squeek.onSpeak((message) => {
    const text =
      message && typeof message === "object" && "text" in message
        ? message.text
        : undefined;
    if (typeof text !== "string" || !text.trim() || text.length > 300) return;
    cancelSpeech();
    if (!muted) say(text);
  });
  void window.squeek
    .invoke("state")
    .then((value) => render(value as AppState))
    .catch(() =>
      render({ monitoring: false, health: "unavailable", revision: 0 }),
    );
  window.addEventListener(
    "beforeunload",
    () => {
      unsubscribe();
      stopHiddenListener();
      stopSpeakListener();
      stopListenListener();
      recording?.stop();
      cancelSpeech();
      setOutputAwake(false);
    },
    { once: true },
  );
} else {
  render({ monitoring: false, health: "unavailable", revision: 0 });
  monitor.disabled = check.disabled = cancel.disabled = true;
}
export {};
