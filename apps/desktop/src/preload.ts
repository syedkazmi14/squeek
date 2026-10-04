import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("squeek", {
  onHidden: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("squeek:sidebar-hidden", listener);
    return () => ipcRenderer.removeListener("squeek:sidebar-hidden", listener);
  },
  invoke: (action: string, value?: unknown) =>
    ipcRenderer.invoke("squeek:request", action, value),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("squeek:state", listener);
    return () => ipcRenderer.removeListener("squeek:state", listener);
  },
  onSay: (callback: (message: unknown) => void) => {
    const listener = (_event: unknown, message: unknown) => callback(message);
    ipcRenderer.on("squeek:say", listener);
    return () => ipcRenderer.removeListener("squeek:say", listener);
  },
  onSpeak: (callback: (message: unknown) => void) => {
    const listener = (_event: unknown, message: unknown) => callback(message);
    ipcRenderer.on("squeek:speak", listener);
    return () => ipcRenderer.removeListener("squeek:speak", listener);
  },
  onLink: (callback: (link: unknown) => void) => {
    const listener = (_event: unknown, link: unknown) => callback(link);
    ipcRenderer.on("squeek:link", listener);
    return () => ipcRenderer.removeListener("squeek:link", listener);
  },
  /** Overlay only: where the link confirmation card is, or null once closed. */
  linkCard: (rect: unknown) => ipcRenderer.send("squeek:link-card", rect),
  /** Overlay only: the user's answer to a risky link. */
  linkChoice: (choice: string) => ipcRenderer.invoke("squeek:link-choice", choice),
  onPointer: (callback: (pointer: unknown) => void) => {
    const listener = (_event: unknown, pointer: unknown) => callback(pointer);
    ipcRenderer.on("squeek:pointer", listener);
    return () => ipcRenderer.removeListener("squeek:pointer", listener);
  },
});
