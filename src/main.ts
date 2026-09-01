import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  session,
} from "electron";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

import { logger } from "./lib/logger.js";
import { loadCredential, saveCredential, clearCredential } from "./lib/credential.js";
import { closeQueue } from "./lib/queue.js";
import { startWatcher, stopWatcher } from "./lib/watcher.js";
import { startRetryScheduler, stopRetryScheduler } from "./lib/retryScheduler.js";
import { startHeartbeat, stopHeartbeat } from "./lib/heartbeat.js";
import { createTray, updateTrayState, destroyTray } from "./lib/tray.js";
import { enableAutoStart } from "./lib/autostart.js";
import { ensureScannerDirs } from "./lib/fileOps.js";
import type { TrayState } from "./lib/retryScheduler.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const AGENT_VERSION = app.getVersion();
const SCANNER_ROOT = "C:\\PresentailScanner";
const PACKAGED_RUNTIME_CHECK = process.argv.includes("--verify-packaged-runtime");
const FIRST_RUN_SMOKE_TEST = process.argv.includes("--smoke-test-first-run");
const LOCAL_APP_DATA =
  process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
const STARTUP_LOG_DIR = path.join(
  LOCAL_APP_DATA,
  "PresentailScannerAgent",
  "logs",
);
const STARTUP_LOG_PATH = path.join(STARTUP_LOG_DIR, "startup.log");
const FIRST_RUN_SMOKE_PATH = path.join(
  LOCAL_APP_DATA,
  "PresentailScannerAgent",
  "first-run-smoke.json",
);

function startupLog(phase: string, details: Record<string, unknown> = {}): void {
  try {
    fs.mkdirSync(STARTUP_LOG_DIR, { recursive: true });
    fs.appendFileSync(
      STARTUP_LOG_PATH,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        version: AGENT_VERSION,
        executablePath: process.execPath,
        appDataPath: LOCAL_APP_DATA,
        phase,
        ...details,
      })}\n`,
      "utf8",
    );
  } catch {
    // Startup logging must never prevent the agent from launching.
  }
}

// Electron requires this before the app reaches the ready state. Calling it
// from the ready handler throws before the first-run window or tray is created.
app.disableHardwareAcceleration();
startupLog("application-start");

/**
 * Auto-update feed URL.
 * Override via UPDATE_FEED_URL environment variable, e.g. for internal CI hosting.
 * Defaults to the public GitHub Releases download URL.
 */
const UPDATE_FEED_URL =
  process.env.UPDATE_FEED_URL ??
  "https://github.com/Saade09/Presentail-Scanner-Agent/releases/download/scanner-agent-current";

/** How often to poll for updates (4 hours in ms). */
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ── Single-instance lock ──────────────────────────────────────────────────────

const gotLock = PACKAGED_RUNTIME_CHECK || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── State ─────────────────────────────────────────────────────────────────────

interface AgentState {
  serverUrl: string;
  token: string;
  stationName: string;
  entityName: string;
  isCredentialRevoked: boolean;
}

let agentState: AgentState | null = null;
let setupWindow: BrowserWindow | null = null;
let setupRendererLoaded = false;
let trayInitialized = false;

function writeFirstRunSmokeResult(): void {
  if (!FIRST_RUN_SMOKE_TEST || !setupRendererLoaded || !trayInitialized) return;
  try {
    fs.mkdirSync(path.dirname(FIRST_RUN_SMOKE_PATH), { recursive: true });
    fs.writeFileSync(
      FIRST_RUN_SMOKE_PATH,
      JSON.stringify({
        pid: process.pid,
        setupWindowCreated: Boolean(setupWindow && !setupWindow.isDestroyed()),
        setupWindowVisible: Boolean(setupWindow?.isVisible()),
        rendererLoaded: setupRendererLoaded,
        trayInitialized,
        credentialExists: Boolean(agentState?.token),
      }),
      "utf8",
    );
    startupLog("first-run-smoke-ready");
  } catch (err) {
    startupLog("first-run-smoke-write-failed", { error: String(err) });
  }
}

// ── Pairing window ────────────────────────────────────────────────────────────

function openSetupWindow(): void {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 480,
    height: 540,
    resizable: false,
    title: "Presentail Scanner Agent — Setup",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  startupLog("pairing-window-created", { visible: setupWindow.isVisible() });

  const setupPath = path.join(app.getAppPath(), "renderer", "setup", "index.html");
  logger.info("Setup window: loading renderer", { setupPath });
  void setupWindow.loadFile(setupPath)
    .then(() => {
      setupRendererLoaded = true;
      logger.info("Setup window: renderer loaded");
      startupLog("renderer-load-success");
      writeFirstRunSmokeResult();
    })
    .catch((err) => {
      logger.error("Setup window: renderer failed to load", {
        setupPath,
        error: String(err),
      });
      startupLog("renderer-load-failure", { error: String(err) });
    });

  setupWindow.on("closed", () => {
    setupWindow = null;
  });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle(
  "scanner:pair",
  async (
    _event,
    payload: { serverUrl: string; pairingCode: string }
  ) => {
    const { serverUrl, pairingCode } = payload;
    logger.info("IPC: pairing initiated", { serverUrl });

    try {
      const axios = (await import("axios")).default;
      const response = await axios.post(
        `${serverUrl.replace(/\/$/, "")}/api/scanner/pair`,
        {
          code: pairingCode.trim().toUpperCase(),
          device_info: {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            agent_version: AGENT_VERSION,
          },
        },
        { timeout: 15_000, validateStatus: () => true }
      );

      if (response.status !== 200) {
        const message =
          (response.data as Record<string, unknown>)?.error as string | undefined;
        return {
          success: false,
          error: message ?? `Server returned ${response.status}`,
        };
      }

      const data = response.data as {
        token: string;
        station: {
          id: number;
          name: string;
          default_entity_id: number;
          default_entity_name: string;
          location: string | null;
        };
      };

      const saved = await saveCredential(data.token);
      if (!saved) {
        return {
          success: false,
          error: "Could not save credential to Windows Credential Manager.",
        };
      }

      // Persist server URL alongside token (store as separate keytar account)
      const keytarModule = await import("keytar");
      await keytarModule.setPassword(
        "PresentailScannerAgent",
        "server-url",
        serverUrl
      );
      await keytarModule.setPassword(
        "PresentailScannerAgent",
        "station-name",
        data.station.name
      );
      await keytarModule.setPassword(
        "PresentailScannerAgent",
        "entity-name",
        data.station.default_entity_name
      );

      logger.info("IPC: pairing successful", { stationId: data.station.id });

      await enableAutoStart();

      // Start agent with the new credential
      agentState = {
        serverUrl,
        token: data.token,
        stationName: data.station.name,
        entityName: data.station.default_entity_name,
        isCredentialRevoked: false,
      };

      startAgentServices(agentState);
      setupWindow?.close();

      return { success: true };
    } catch (err) {
      logger.error("IPC: pairing error", { error: String(err) });
      return { success: false, error: String(err) };
    }
  }
);

// ── Agent services ────────────────────────────────────────────────────────────

function onStateChange(state: TrayState): void {
  updateTrayState(state);
}

function onCredentialRevoked(): void {
  if (agentState) agentState.isCredentialRevoked = true;
  stopWatcher();
  stopRetryScheduler();
  stopHeartbeat();
  updateTrayState("error");
  logger.error("Credential revoked — agent paused; user must re-pair");
}

function startAgentServices(state: AgentState): void {
  const { inbox, uploaded, failed } = ensureScannerDirs(SCANNER_ROOT);

  createTray({
    stationName: state.stationName,
    entityName: state.entityName,
    onRePair: handleRePair,
    onOpenSetup: openSetupWindow,
    onQuit: () => app.quit(),
  });
  trayInitialized = true;
  startupLog("tray-initialized", { state: "paired" });
  writeFirstRunSmokeResult();

  startRetryScheduler({
    serverUrl: state.serverUrl,
    token: state.token,
    agentVersion: AGENT_VERSION,
    uploadedDir: uploaded,
    failedDir: failed,
    onStateChange,
    onCredentialRevoked,
  });

  startHeartbeat({
    serverUrl: state.serverUrl,
    token: state.token,
    agentVersion: AGENT_VERSION,
    onStateChange,
    onCredentialRevoked,
  });

  startWatcher({ inboxDir: inbox });
  startupLog("watcher-initialized", { inbox });

  updateTrayState("connected");
  logger.info("Agent services started", { stationName: state.stationName });
}

function handleRePair(): void {
  logger.info("Re-pair requested");

  // Stop all services
  stopWatcher();
  stopRetryScheduler();
  stopHeartbeat();

  // Clear stored credential
  clearCredential().catch(() => undefined);

  agentState = null;

  openSetupWindow();
}

// ── Auto-update ───────────────────────────────────────────────────────────────

/**
 * Sets up electron-updater to check for new releases periodically.
 *
 * Only active when running as a packaged app (app.isPackaged).
 * In development, update checks are skipped to avoid spurious errors.
 *
 * Feed URL defaults to the GitHub Releases download path; override via
 * UPDATE_FEED_URL environment variable for internal hosting.
 *
 * Preserves credentials and queue across updates:
 *   - Windows Credential Manager entry is outside the install dir → untouched
 *   - %APPDATA%\PresentailScannerAgent\queue.db is outside the install dir → untouched
 *   - The NSIS upgrade installer never deletes these locations
 *
 * Publishing a new release (Presentail engineering):
 *   1. Build signed installer: CSC_LINK=... CSC_KEY_PASSWORD=... pnpm run dist:win
 *   2. Upload release/<installer>.exe and release/latest.yml to the feed URL host
 *   3. Agents will pick up the update at their next check-in (startup or every 4 h)
 */
function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    logger.info("Auto-update: skipped in development mode");
    return;
  }

  // Dynamic import so the type-only dependency doesn't affect the dev build
  import("electron-updater")
    .then(({ autoUpdater }) => {
      autoUpdater.logger = null; // use our own logger below
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.setFeedURL({
        provider: "generic",
        url: UPDATE_FEED_URL,
      });

      autoUpdater.on("checking-for-update", () => {
        logger.info("Auto-update check", { feedUrl: UPDATE_FEED_URL });
      });

      autoUpdater.on("update-available", (info: { version: string }) => {
        logger.info("Auto-update: update available", { version: info.version });

        const notification = new Notification({
          title: "Presentail Scanner Agent",
          body: `Update available (v${info.version}) — click to download`,
          silent: false,
        });

        notification.on("click", () => {
          logger.info("Auto-update: user triggered download", { version: info.version });
          autoUpdater.downloadUpdate().catch((err: Error) => {
            logger.warn("Auto-update: download failed", { error: String(err) });
          });
        });

        notification.show();
      });

      autoUpdater.on("update-not-available", () => {
        logger.info("Auto-update: already on latest version");
      });

      autoUpdater.on("update-downloaded", (info: { version: string }) => {
        logger.info("Auto-update: download complete", { version: info.version });

        new Notification({
          title: "Presentail Scanner Agent",
          body: `Update ready (v${info.version}) — will install when you quit`,
        }).show();
      });

      autoUpdater.on("error", (err: Error) => {
        // Log as warn — update failures are non-fatal
        logger.warn("Auto-update: error during check/download", { error: String(err) });
      });

      // Check on startup (short delay to let the app settle)
      const initialDelay = setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => undefined);
      }, 10_000);
      initialDelay.unref();

      // Check every 4 hours
      const interval = setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => undefined);
      }, UPDATE_CHECK_INTERVAL_MS);
      interval.unref();
    })
    .catch((err: Error) => {
      logger.warn("Auto-update: failed to load electron-updater", { error: String(err) });
    });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.on("ready", async () => {
  startupLog("ready-handler-entered");
  if (PACKAGED_RUNTIME_CHECK) {
    try {
      const keytarModule = await import("keytar");
      if (typeof keytarModule.getPassword !== "function") {
        throw new Error("keytar native module did not expose getPassword");
      }
      const { getCount } = await import("./lib/queue.js");
      getCount();
      logger.info("Packaged runtime verification passed");
      app.exit(0);
    } catch (err) {
      console.error("Packaged runtime verification failed:", String(err));
      logger.error("Packaged runtime verification failed", {
        error: String(err),
      });
      app.exit(1);
    }
    return;
  }

  logger.info("Agent starting", { version: AGENT_VERSION, platform: process.platform });

  // Set CSP for renderer
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ],
      },
    });
  });

  // Initialise auto-updater before loading credentials so it's ready from the start
  setupAutoUpdater();

  // Load saved credentials
  let token: string | null = null;
  let serverUrl: string | null = null;
  let stationName = "Unknown Station";
  let entityName = "";

  try {
    token = await loadCredential();
    startupLog("credential-check-complete", { credentialExists: Boolean(token) });
    const keytarModule = await import("keytar");
    serverUrl = await keytarModule.getPassword("PresentailScannerAgent", "server-url");
    stationName =
      (await keytarModule.getPassword("PresentailScannerAgent", "station-name")) ??
      stationName;
    entityName =
      (await keytarModule.getPassword("PresentailScannerAgent", "entity-name")) ??
      entityName;
  } catch (err) {
    logger.warn("Could not load saved credentials", { error: String(err) });
  }

  if (token && serverUrl) {
    logger.info("Credential found — starting agent services");
    agentState = {
      serverUrl,
      token,
      stationName,
      entityName,
      isCredentialRevoked: false,
    };
    startAgentServices(agentState);
  } else {
    startupLog("unpaired-first-run");
    logger.info("No credential — opening setup window");
    openSetupWindow();
    createTray({
      stationName: "Not paired",
      entityName: "",
      onRePair: handleRePair,
      onOpenSetup: openSetupWindow,
      onQuit: () => app.quit(),
    });
    trayInitialized = true;
    startupLog("tray-initialized", { state: "unpaired" });
    writeFirstRunSmokeResult();
    updateTrayState("unpaired");
  }
});

// Prevent quit when all windows are closed (we're a tray app)
app.on("window-all-closed", () => {
  // Intentionally suppress default quit so the tray app keeps running
});

app.on("second-instance", () => {
  // If a second instance tries to open, just focus the setup window if open
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
  }
});

app.on("before-quit", () => {
  logger.info("Agent shutting down");
  stopWatcher();
  stopRetryScheduler();
  stopHeartbeat();
  closeQueue();
  destroyTray();
});

// Catch unhandled exceptions and log them (never crash silently)
process.on("uncaughtException", (err) => {
  startupLog("fatal-uncaught-exception", { error: String(err), stack: err.stack });
  logger.error("Uncaught exception", { error: String(err), stack: err.stack });
});

process.on("unhandledRejection", (reason) => {
  startupLog("fatal-unhandled-rejection", { error: String(reason) });
  logger.error("Unhandled rejection", { reason: String(reason) });
});
