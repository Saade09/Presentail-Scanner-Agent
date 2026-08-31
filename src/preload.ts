import { contextBridge, ipcRenderer } from "electron";

/**
 * Expose a safe, typed API to the renderer process.
 * Only the explicitly listed channels are accessible.
 */
contextBridge.exposeInMainWorld("scanner", {
  /**
   * Submit pairing credentials.
   * Returns { success: true } or { success: false, error: string }.
   */
  pair: (payload: { serverUrl: string; pairingCode: string }) =>
    ipcRenderer.invoke("scanner:pair", payload),
});
