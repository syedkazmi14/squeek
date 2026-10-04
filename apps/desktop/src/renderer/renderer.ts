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
interface SyncView {
  /** True in development builds, which always show the iPhone section. */
  available?: boolean;
  configured: boolean;
  connected: boolean;
  email?: string;
  error?: string;
  phoneWarning?: { surface: string; evidence: string | null; minutesAgo: number };
}
interface SenderView {
  name: string;
  address: string;
  checks: { id: string; tone: "ok" | "warn" | "info"; text: string }[];
  review?:
    | { status: "checking" }
    | { status: "unavailable" }
    | { status: "done"; verdict: string; kind: string; reason: string; advice: string; say: string };
  lookup?:
    | { status: "checking" }
    | { status: "unavailable" }
    | { status: "done"; summary: string; fits: string; question: string };
}
interface AppState {
  sync?: SyncView;
  sender?: SenderView;
  profile?: string;
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
      | "talk"
      | "sync-signin"
      | "sync-signout"
      | "profile",
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
  // Matches the slower cloud voice; many listeners are older adults.
  utterance.rate = 0.8;
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
  finding.hidden = !current.assessment || pendingChecks > 0;
  element("finding-action-label").textContent = suspicious()
    ? "See what I found"
    : "View details";
  finding.dataset.tone = suspicious() ? "warning" : "neutral";
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
  element("status-description").hidden = !description;
  element("status-card").dataset.idle = String(idle);
  element("status-heading").textContent = title;
  element("status-description").textContent = description;
  element("status-label").textContent = label;
  element("status-label").hidden = !label;
  element("status-card").dataset.tone =
    suspicious() && pendingChecks === 0 ? "warning" : "neutral";
  element("monitoring-state").textContent = monitoringText;
  element("monitoring-state").dataset.active = String(
    current.monitoring && current.health === "watching",
  );
}
const phoneKinds: Record<string, string> = {
  call: "a scam call",
  sms: "a scam text",
  browser: "a risky website",
  link: "a risky website",
};
/** The "Your iPhone" card: sign in with the phone's email, or see that it's linked. */
function renderPhone(view: SyncView | undefined): void {
  const details = element<HTMLDetailsElement>("phone-details");
  const card = element("phone-link");
  const show = !!(view?.configured || view?.available);
  details.hidden = !show;
  if (!show || !view) {
    details.open = false;
    return;
  }
  if (!view.configured) {
    // A development build without the backend settings: say what is missing rather than hiding the section.
    details.open = true;
    element<HTMLFormElement>("phone-form").hidden = true;
    element("phone-disconnect").hidden = true;
    element("phone-warning").hidden = true;
    element("phone-error").hidden = true;
    element("phone-link-copy").textContent =
      "This build isn't set up to link to your iPhone. Add SQUEEK_SUPABASE_URL and SQUEEK_SUPABASE_ANON_KEY to the .env file in the Squeek folder, then restart Squeek.";
    return;
  }
  if (view.phoneWarning) details.open = true;
  const form = element<HTMLFormElement>("phone-form");
  const connected = view.connected;
  form.hidden = connected;
  element("phone-disconnect").hidden = !connected;
  element("phone-link-copy").textContent = connected
    ? `Connected as ${view.email ?? "your account"}. When Squeek finds a likely scam here, your iPhone is told too, with private details removed.`
    : "Use the same email as on your iPhone. Warnings then show up on both. Nothing else leaves this PC.";
  const warning = element("phone-warning");
  warning.hidden = !view.phoneWarning;
  if (view.phoneWarning) {
    const { surface, minutesAgo } = view.phoneWarning;
    warning.textContent = `Your iPhone caught ${phoneKinds[surface] ?? "a likely scam"} ${minutesAgo} minute${minutesAgo === 1 ? "" : "s"} ago. Talk to someone you trust before you pay anyone.`;
  }
  const error = element("phone-error");
  error.hidden = !view.error;
  error.textContent = view.error ?? "";
}
const verdictLabels: Record<string, string> = {
  safe: "Looks OK",
  unsure: "Not sure",
  suspicious: "Be careful",
  scam: "This looks like a scam",
};
const kindLabels: Record<string, string> = {
  friend_or_family: "pretending to be a friend or family member",
  old_acquaintance_loan: "an old acquaintance suddenly asking for money",
  romance: "a romance scam",
  grandparent_emergency: "a family emergency scam",
  government: "pretending to be the government",
  medicare_or_social_security: "pretending to be Medicare or Social Security",
  bank_fraud_department: "pretending to be your bank's fraud team",
  safe_account_transfer: "asking you to move money to a 'safe' account",
  tech_support: "a fake tech support scam",
  callback_billing: "a fake bill that wants you to call them",
  subscription_renewal: "a fake subscription renewal",
  delivery_or_customs_fee: "a fake delivery or customs fee",
  toll_or_utility_bill: "a fake toll or utility bill",
  job_or_money_mule: "a fake job",
  overpayment_refund: "a fake overpayment or refund",
  prize_or_lottery: "a fake prize or lottery",
  inheritance_or_advance_fee: "a fake inheritance that needs a fee",
  investment_or_crypto: "an investment or crypto scam",
  crypto_recovery: "a fake offer to recover lost money",
  account_login: "trying to get your login",
  invoice_or_order: "a fake bill or order",
  extortion_or_sextortion: "a threat to scare you into paying",
  charity_or_disaster: "a fake charity",
  jury_duty_or_warrant: "a fake jury duty or warrant threat",
  rental_or_marketplace: "a rental or marketplace scam",
  fake_grant: "a fake government grant",
};
// Squeek's own words type in at about the pace of its voice; status lines appear at once.
const typing = new WeakMap<HTMLElement, number>();
const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
function typeInto(target: HTMLElement, text: string, animate: boolean): void {
  if (target.dataset.full === text) return;
  target.dataset.full = text;
  window.clearInterval(typing.get(target));
  if (!animate || !text || calm.matches) {
    target.textContent = text;
    target.removeAttribute("aria-busy");
    return;
  }
  // Screen readers hear the finished sentence, not every letter.
  target.setAttribute("aria-busy", "true");
  let shown = 0;
  target.textContent = "";
  const timer = window.setInterval(() => {
    shown += 2;
    target.textContent = text.slice(0, shown);
    if (shown >= text.length) {
      window.clearInterval(timer);
      target.removeAttribute("aria-busy");
    }
  }, 1000 / 7);
  typing.set(target, timer);
}
/** Who the opened email is from and what Squeek found out about them. */
function renderSender(sender: SenderView | undefined): void {
  for (const card of document.querySelectorAll<HTMLElement>("[data-sender]")) {
    card.hidden = !sender;
    if (!sender) continue;
    card.querySelector(".sender-from")!.textContent = sender.name
      ? `${sender.name} · ${sender.address}`
      : sender.address;
    const list = card.querySelector(".sender-checks")!;
    list.replaceChildren();
    for (const check of sender.checks) {
      const item = document.createElement("li");
      item.dataset.tone = check.tone;
      item.textContent = check.text;
      list.append(item);
    }
    const review = card.querySelector<HTMLElement>(".sender-review")!;
    const r = sender.review;
    delete review.dataset.tone;
    if (!r) typeInto(review, "", false);
    else if (r.status === "checking")
      typeInto(review, "Squeek is reading this email…", false);
    else if (r.status === "unavailable")
      typeInto(review, "Squeek couldn't read this email closely right now.", false);
    else {
      const kind = r.verdict === "scam" || r.verdict === "suspicious" ? kindLabels[r.kind] : undefined;
      typeInto(review, `${verdictLabels[r.verdict] ?? "Not sure"}${kind ? ` (${kind})` : ""}. ${r.reason} ${r.advice}`, true);
      if (r.verdict === "scam") review.dataset.tone = "warn";
      else if (r.verdict === "suspicious") review.dataset.tone = "caution";
    }
    const lookup = card.querySelector<HTMLElement>(".sender-lookup")!;
    const l = sender.lookup;
    if (!l) typeInto(lookup, "", false);
    else if (l.status === "checking") typeInto(lookup, "Looking them up online…", false);
    else if (l.status === "unavailable")
      typeInto(lookup, "Squeek couldn't look them up online right now.", false);
    else typeInto(lookup, `What I found online: ${l.summary} ${l.question}`, true);
  }
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
  renderPhone(next.sync);
  renderSender(next.sender);
  const about = element<HTMLTextAreaElement>("about-text");
  if (document.activeElement !== about) about.value = next.profile ?? "";
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
  element("next-step-card").dataset.tone = suspicious()
    ? "warning"
    : "neutral";
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
element("see-finding").addEventListener("click", () => setView("finding"));
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
const phoneEmail = element<HTMLInputElement>("phone-email");
const phoneConnect = element<HTMLButtonElement>("phone-connect");
phoneEmail.addEventListener("input", () => {
  phoneConnect.disabled = !phoneEmail.value.includes("@");
});
element<HTMLFormElement>("phone-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (phoneConnect.disabled) return;
  phoneConnect.disabled = true;
  phoneConnect.textContent = "Connecting…";
  void window.squeek
    .invoke("sync-signin", phoneEmail.value.trim())
    .then((state) => {
      render(state as AppState);
      phoneEmail.value = "";
    })
    .catch(() => {})
    .finally(() => {
      phoneConnect.textContent = "Connect";
      phoneConnect.disabled = !phoneEmail.value.includes("@");
    });
});
element("phone-disconnect").addEventListener("click", () => {
  void window.squeek
    .invoke("sync-signout")
    .then((state) => render(state as AppState))
    .catch(() => {});
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
  element("about-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = element<HTMLTextAreaElement>("about-text").value.trim().slice(0, 300);
    void window.squeek
      .invoke("profile", text)
      .then((value) => render(value as AppState))
      .catch(() => {});
    element("about-save").textContent = "Saved";
    setTimeout(() => (element("about-save").textContent = "Save"), 2000);
  });
  const stopSpeakListener = window.squeek.onSpeak((message) => {
    const text =
      message && typeof message === "object" && "text" in message
        ? message.text
        : undefined;
    if (typeof text !== "string" || !text.trim() || text.length > 600) return;
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
