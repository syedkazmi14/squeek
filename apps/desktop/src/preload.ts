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
  onPointer: (callback: (pointer: unknown) => void) => {
    const listener = (_event: unknown, pointer: unknown) => callback(pointer);
    ipcRenderer.on("squeek:pointer", listener);
    return () => ipcRenderer.removeListener("squeek:pointer", listener);
  },
});
