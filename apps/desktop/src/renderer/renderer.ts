import { incidentKey, warning } from "./incident.ts";
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
  browser?: "chrome" | "msedge";
  assessmentCurrent?: boolean;
}
interface SqueekApi {
  invoke(
    action: "state" | "monitor" | "check" | "demo" | "cloud" | "hide" | "show",
    value?: unknown,
  ): Promise<unknown>;
  onState(callback: (state: AppState) => void): () => void;
  onHidden(callback: () => void): () => void;
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
const monitor = element<HTMLButtonElement>("monitor");
const browser = element<HTMLSelectElement>("browser");
const manualText = element<HTMLTextAreaElement>("manual-text");
const check = element<HTMLButtonElement>("check");
const mute = element<HTMLButtonElement>("mute");
const replay = element<HTMLButtonElement>("replay");
const cancel = element<HTMLButtonElement>("cancel");
const finding = element<HTMLButtonElement>("see-finding");
let current: AppState = { monitoring: false, health: "paused", revision: 0 };
let muted = false;
let pendingActions = 0;
let pendingChecks = 0;
let checkGeneration = 0;
let assessmentKey = "";
let pendingSpeechKey: string | undefined;
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
  pendingSpeechKey = undefined;
  window.speechSynthesis?.cancel();
}
function speak(): void {
  cancelSpeech();
  if (
    muted ||
    current.assessment?.state !== "high_risk" ||
    current.assessmentCurrent === false ||
    !window.speechSynthesis
  )
    return;
  const voice = localVoice();
  if (!voice) {
    pendingSpeechKey = assessmentKey;
    return;
  }
  const utterance = new SpeechSynthesisUtterance(warning);
  utterance.lang = "en-US";
  utterance.rate = 1;
  utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
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
    !localVoice();
  finding.hidden = !suspicious() || pendingChecks > 0;
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
element("close").addEventListener("click", () => {
  cancelSpeech();
  void window.squeek.invoke("hide").catch(() => {});
});
window.speechSynthesis?.addEventListener("voiceschanged", () => {
  refreshControls();
  if (pendingSpeechKey === assessmentKey && localVoice()) speak();
});
render(current);
if (window.squeek) {
  const unsubscribe = window.squeek.onState(render);
  const stopHiddenListener = window.squeek.onHidden(() => {
    checkGeneration++;
    cancelSpeech();
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
      cancelSpeech();
    },
    { once: true },
  );
} else {
  render({ monitoring: false, health: "unavailable", revision: 0 });
  monitor.disabled = check.disabled = cancel.disabled = true;
}
export {};
