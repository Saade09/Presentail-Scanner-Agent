import { contextBridge, ipcRenderer } from "electron";

/**
 * Expose a safe, typed API to the renderer process.
 * Only the explicitly listed channels are accessible.
 */
contextBridge.exposeInMainWorld("scanner", {
  getSettings: () => ipcRenderer.invoke("scanner:get-settings"),

  /**
   * Submit pairing credentials.
   * Returns a machine-readable category and a secret-safe correlation ID.
   */
  pair: (payload: { serverUrl: string; pairingCode: string; inboxDir: string }) =>
    ipcRenderer.invoke("scanner:pair", payload),
});
