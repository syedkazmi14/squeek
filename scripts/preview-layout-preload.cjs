const { contextBridge, ipcRenderer } = require("electron");

// This standalone preview uses mock state and never loads the production main process.
const sample = () => ({
  state: "high_risk",
  coverage: "partial",
  evidence: [
    { excerpt: "Claiming to be the IRS" },
    { excerpt: "Pay $500 in gift cards" },
    { excerpt: "Send the gift card codes" },
    { excerpt: "Threatening arrest if you don’t pay today" },
  ],
  assessedAt: Date.now(),
});
let state = {
  monitoring: false,
  health: "paused",
  revision: 1,
  browser: "chrome",
  assessmentCurrent: false,
  assessment: sample(),
  cloudEnabled: false,
  cloudVoice: false,
  voiceChat: false,
};
const listeners = new Set();
const publish = () => {
  for (const listener of listeners) listener(structuredClone(state));
};
contextBridge.exposeInMainWorld("squeek", {
  async invoke(action, value) {
    if (action === "hide") ipcRenderer.send("squeek-preview:close");
    if (action === "monitor") {
      state = {
        ...state,
        revision: state.revision + 1,
        monitoring: value.enabled,
        health: value.enabled ? "watching" : "paused",
        browser: value.browser,
        assessment: undefined,
      };
      publish();
    }
    if (action === "check") {
      state = {
        ...state,
        revision: state.revision + 1,
        monitoring: false,
        health: "paused",
        assessmentCurrent: false,
        assessment: sample(),
      };
      publish();
    }
    return structuredClone(state);
  },
  onState(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onListen() { return () => {}; },
  onHidden() { return () => {}; },
  onSpeak() { return () => {}; },
});
