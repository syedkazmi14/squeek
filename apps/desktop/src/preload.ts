import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("squeek", {
  invoke: (action: string, value?: unknown) =>
    ipcRenderer.invoke("squeek:request", action, value),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("squeek:state", listener);
    return () => ipcRenderer.removeListener("squeek:state", listener);
  },
});
