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

const stateLabels: Record<string, string> = {
  high_risk: warning,
  caution: "Caution",
  no_detected_signal: "No detected signal",
  unknown: "Unknown",
};
function element<T extends HTMLElement>(id: string): T {
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
const voiceRate = element<HTMLSelectElement>("voice-rate");
const demo = element<HTMLButtonElement>("demo");
const cloud = element<HTMLInputElement>("cloud");
const heading = element<HTMLHeadingElement>("assessment-heading");
const evidence = element<HTMLUListElement>("evidence");
let current: AppState = { monitoring: false, health: "paused", revision: 0 };
let muted = false;
let pendingActions = 0;
let pendingChecks = 0;
let assessmentKey = "";
let pendingSpeechKey: string | undefined;

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
    !window.speechSynthesis
  )
    return;
  const utterance = new SpeechSynthesisUtterance(warning);
  utterance.lang = "en-US";
  utterance.rate = Number(voiceRate.value);
  const voice = localVoice();
  // Do not send warning audio to a remote speech service.
  if (!voice) {
    pendingSpeechKey = assessmentKey;
    return;
  }
  utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}
function refreshControls(): void {
  const busy = pendingActions > 0;
  monitor.disabled = busy && !current.monitoring && pendingChecks === 0;
  monitor.textContent =
    current.monitoring || pendingChecks > 0 ? "Pause" : "Start monitoring";
  browser.disabled = busy || current.monitoring;
  check.disabled = busy || !manualText.value.trim();
  demo.disabled = busy;
  cloud.disabled = busy || current.providerConfigured !== true;
  cloud.checked = current.cloudEnabled === true;
  replay.disabled =
    muted || current.assessment?.state !== "high_risk" || !localVoice();
  cancel.hidden =
    !current.monitoring &&
    pendingActions === 0 &&
    current.assessment?.state !== "high_risk";
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
  element("last-review").hidden =
    !current.assessment || current.assessmentCurrent !== false;
  element("monitoring-state").textContent = current.monitoring
    ? "Monitoring"
    : "Paused";
  heading.textContent =
    stateLabels[current.assessment?.state ?? "unknown"] ?? "Unknown";
  element("warning-mark").hidden = current.assessment?.state !== "high_risk";
  evidence.replaceChildren();
  for (const item of current.assessment?.evidence ?? []) {
    const quote = document.createElement("li");
    quote.textContent = item.excerpt;
    evidence.append(quote);
  }
  element("health").textContent = current.health.replaceAll("_", " ");
  element("coverage").textContent = current.assessment?.coverage ?? "Unknown";
  element("revision").textContent = String(current.revision);
  refreshControls();
  if (changed && current.assessment?.state === "high_risk") {
    element("manual-check").removeAttribute("open");
    element("result").scrollIntoView({ behavior: "instant", block: "start" });
  }
  if (changed && !paused) speak();
}
async function invoke(
  action: "monitor" | "check" | "demo" | "cloud",
  value?: unknown,
): Promise<void> {
  const stopping =
    action === "monitor" &&
    typeof value === "object" &&
    value !== null &&
    "enabled" in value &&
    value.enabled === false;
  if (pendingActions > 0 && !stopping) return;
  cancelSpeech();
  pendingActions++;
  if (action === "check") pendingChecks++;
  refreshControls();
  try {
    const response = await window.squeek.invoke(action, value);
    if (response && typeof response === "object" && "monitoring" in response)
      render(response as AppState);
  } catch {
    const { assessment: _assessment, ...latest } = current;
    render({ ...latest, health: "unavailable" });
  } finally {
    pendingActions--;
    if (action === "check") pendingChecks--;
    refreshControls();
  }
}
monitor.addEventListener("click", () => {
  void invoke("monitor", {
    enabled: !(current.monitoring || pendingChecks > 0),
    browser: browser.value,
  });
});
manualText.addEventListener("input", refreshControls);
element<HTMLFormElement>("manual-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (manualText.value.trim()) void invoke("check", manualText.value);
});
demo.addEventListener("click", () => {
  void invoke("demo");
});
cloud.addEventListener("change", () => {
  void invoke("cloud", cloud.checked);
});
cancel.addEventListener("click", () => {
  void invoke("monitor", { enabled: false, browser: browser.value });
});
mute.addEventListener("click", () => {
  muted = !muted;
  mute.textContent = muted ? "Unmute" : "Mute";
  mute.setAttribute("aria-pressed", String(muted));
  cancelSpeech();
  refreshControls();
});
replay.addEventListener("click", speak);
voiceRate.addEventListener("change", cancelSpeech);
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
  const stopHiddenListener = window.squeek.onHidden(cancelSpeech);
  void window.squeek
    .invoke("state")
    .then((value) => render(value as AppState))
    .catch(() => {
      render({ monitoring: false, health: "unavailable", revision: 0 });
    });
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
  monitor.disabled = check.disabled = demo.disabled = cancel.disabled = true;
}

export {};
