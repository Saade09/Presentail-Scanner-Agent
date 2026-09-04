import { app, BrowserWindow, ipcMain, Notification, session } from "electron";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { randomUUID } from "crypto";

import { logger } from "./lib/logger.js";
import {
  loadPairingRecord,
  loadLegacyPairingRecord,
  clearLegacyPairingState,
  saveAndVerifyPairingRecord,
  clearPairingState,
  type PairingRecord,
} from "./lib/credential.js";
import { closeQueue, getCount } from "./lib/queue.js";
import { startWatcher, stopWatcher } from "./lib/watcher.js";
import {
  startRetryScheduler,
  stopRetryScheduler,
} from "./lib/retryScheduler.js";
import {
  sendImmediateHeartbeat,
  startHeartbeat,
  stopHeartbeat,
} from "./lib/heartbeat.js";
import { createTray, updateTrayState, destroyTray } from "./lib/tray.js";
import { enableAutoStart } from "./lib/autostart.js";
import { ensureScannerDirs } from "./lib/fileOps.js";
import {
  DEFAULT_INBOX_DIR,
  loadInboxDir,
  normalizeInboxDir,
  saveInboxDir,
} from "./lib/inboxSettings.js";
import type { TrayState } from "./lib/retryScheduler.js";
import { runPairingReset } from "./lib/pairingReset.js";
import { PairingAttemptLock } from "./lib/pairingAttemptLock.js";
import { ServiceStateGate } from "./lib/serviceStateGate.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const AGENT_VERSION = app.getVersion();
const INBOX_SETTINGS_FILE = "settings.json";
const PACKAGED_RUNTIME_CHECK = process.argv.includes(
  "--verify-packaged-runtime",
);
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

function startupLog(
  phase: string,
  details: Record<string, unknown> = {},
): void {
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
  stationId: number;
  stationName: string;
  entityName: string;
  correlationId: string;
  isCredentialRevoked: boolean;
}

let agentState: AgentState | null = null;
let setupWindow: BrowserWindow | null = null;
let setupRendererLoaded = false;
let trayInitialized = false;
let rePairResetPromise: Promise<boolean> | null = null;
let pairingStatePrepared = false;
const pairingAttemptLock = new PairingAttemptLock();
const serviceStateGate = new ServiceStateGate((state) =>
  updateTrayState(state),
);

function getInboxSettingsPath(): string {
  return path.join(app.getPath("userData"), INBOX_SETTINGS_FILE);
}

function getConfiguredInboxDir(): string {
  return loadInboxDir(getInboxSettingsPath());
}

function createTrayOptions(state: AgentState, inboxDir: string) {
  return {
    stationName: state.stationName,
    entityName: state.entityName,
    agentVersion: AGENT_VERSION,
    inboxDir,
    onRePair: handleRePair,
    onOpenSetup: openSetupWindow,
    onQuit: () => app.quit(),
  };
}

function normalizeServerUrl(input: string): string {
  const parsed = new URL(input);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported server URL protocol");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Server URL must not contain credentials");
  }
  return parsed.origin;
}

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
    height: 650,
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

  const setupPath = path.join(
    app.getAppPath(),
    "renderer",
    "setup",
    "index.html",
  );
  logger.info("Setup window: loading renderer", { setupPath });
  void setupWindow
    .loadFile(setupPath)
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

ipcMain.handle("scanner:get-settings", () => ({
  inboxDir: getConfiguredInboxDir(),
}));

ipcMain.handle(
  "scanner:pair",
  async (
    _event,
    payload: { serverUrl: string; pairingCode: string; inboxDir?: string },
  ) => {
    const { serverUrl, pairingCode } = payload;
    const releasePairingAttempt = pairingAttemptLock.acquire();
    if (!releasePairingAttempt) {
      return {
        success: false,
        error: "Pairing is already in progress. Please wait for it to finish.",
      };
    }
    let normalizedServerUrl: string;
    try {
      normalizedServerUrl = normalizeServerUrl(serverUrl);
    } catch {
      releasePairingAttempt();
      return {
        success: false,
        category: "api_error",
        error:
          "Enter a valid Presentail OS URL without credentials, query parameters, or fragments.",
      };
    }
    let inboxDir: string;
    try {
      inboxDir = normalizeInboxDir(payload.inboxDir ?? DEFAULT_INBOX_DIR);
      ensureScannerDirs(inboxDir);
      saveInboxDir(getInboxSettingsPath(), inboxDir);
    } catch (err) {
      releasePairingAttempt();
      logger.error("IPC: scan inbox setup failed", {
        inboxDir: payload.inboxDir,
        error: String(err),
      });
      return {
        success: false,
        category: "inbox_error",
        error:
          err instanceof Error
            ? err.message
            : "The scan inbox could not be prepared. Check the path and Windows folder permissions.",
      };
    }
    logger.info("IPC: pairing initiated", {
      endpoint: `${normalizedServerUrl}/api/scanner/pair`,
      inboxDir,
    });

    try {
      // A tray re-pair may still be finishing its asynchronous shutdown.
      // Never save a new credential until that reset has completed.
      if (rePairResetPromise) {
        const resetSucceeded = await rePairResetPromise;
        if (!resetSucceeded) {
          return {
            success: false,
            error:
              "Could not clear the previous pairing from Windows Credential Manager. No new credential was saved.",
          };
        }
      }

      // Always prepare persisted state before accepting a new credential.
      // This also clears partial records (for example, a token whose server
      // metadata is missing) that do not produce a live agentState at startup.
      if (!pairingStatePrepared) {
        const resetSucceeded = await resetAgentForPairing();
        if (!resetSucceeded) {
          return {
            success: false,
            error:
              "Could not clear the previous pairing from Windows Credential Manager. No new credential was saved.",
          };
        }
      }
      pairingStatePrepared = false;

      const requestCorrelationId = randomUUID();
      const endpoint = `${normalizedServerUrl}/api/scanner/pair`;
      const axiosModule = await import("axios");
      const axios = axiosModule.default;
      logger.info("Pairing request dispatch", {
        timestamp: new Date().toISOString(),
        correlationId: requestCorrelationId,
        method: "POST",
        endpoint,
      });
      const response = await axios.post(
        endpoint,
        {
          code: pairingCode.trim().toUpperCase(),
          device_info: {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            agent_version: AGENT_VERSION,
          },
        },
        {
          headers: { "X-Correlation-ID": requestCorrelationId },
          timeout: 15_000,
          validateStatus: () => true,
        },
      );

      const responseBody = response.data as Record<string, unknown>;
      const resultCategory =
        typeof responseBody?.result === "string"
          ? responseBody.result
          : response.status === 200
            ? "accepted"
            : "api_error";
      logger.info("Pairing request completed", {
        timestamp: new Date().toISOString(),
        correlationId: requestCorrelationId,
        method: "POST",
        endpoint,
        statusCode: response.status,
        result: resultCategory,
      });

      if (response.status !== 200) {
        const message = responseBody?.error as string | undefined;
        return {
          success: false,
          category: resultCategory,
          correlationId: requestCorrelationId,
          error: message ?? `Server returned ${response.status}`,
        };
      }

      const data = response.data as {
        result: "accepted";
        correlation_id: string;
        credential: {
          token: string;
          token_type: "Bearer";
          issued_at: string;
          expires_at: string | null;
        };
        station: {
          id: number;
          name: string;
          default_entity_id: number;
          default_entity_name: string;
          location: string | null;
        };
      };

      if (
        data.result !== "accepted" ||
        !data.credential?.token ||
        !Number.isInteger(data.station?.id) ||
        !Number.isInteger(data.station?.default_entity_id)
      ) {
        return {
          success: false,
          category: "api_error",
          correlationId: requestCorrelationId,
          error: "Presentail OS returned an incomplete pairing response.",
        };
      }

      const record: PairingRecord = {
        schemaVersion: 1,
        serverUrl: normalizedServerUrl,
        token: data.credential.token,
        station: {
          id: data.station.id,
          name: data.station.name,
          defaultEntityId: data.station.default_entity_id,
          defaultEntityName: data.station.default_entity_name,
          location: data.station.location,
        },
        credential: {
          tokenType: data.credential.token_type,
          issuedAt: data.credential.issued_at,
          expiresAt: data.credential.expires_at,
        },
        correlationId: data.correlation_id || requestCorrelationId,
      };
      const verifiedRecord = await saveAndVerifyPairingRecord(record);
      if (!verifiedRecord || verifiedRecord.station.id !== data.station.id) {
        return {
          success: false,
          category: "secure_storage_failure",
          correlationId: record.correlationId,
          error:
            "Windows Credential Manager could not save and verify the complete pairing record.",
        };
      }

      logger.info("Pairing credential storage verified", {
        stationId: verifiedRecord.station.id,
        credentialExists: true,
        correlationId: verifiedRecord.correlationId,
      });

      const heartbeatResult = await sendImmediateHeartbeat(
        {
          serverUrl: verifiedRecord.serverUrl,
          token: verifiedRecord.token,
          agentVersion: AGENT_VERSION,
          onStateChange: () => undefined,
          onCredentialRevoked: () => undefined,
          onStationDisabled: () => undefined,
          onConfigurationRequired: () => undefined,
        },
        verifiedRecord.correlationId,
      );
      logger.info("Post-pair heartbeat completed", {
        stationId: verifiedRecord.station.id,
        correlationId: verifiedRecord.correlationId,
        statusCode: heartbeatResult.statusCode,
        result: heartbeatResult.kind,
        queuedCount: heartbeatResult.queuedCount,
      });
      if (heartbeatResult.kind !== "success") {
        const category =
          heartbeatResult.kind === "credential-revoked"
            ? "post_pair_authentication_failure"
            : heartbeatResult.kind === "station-disabled"
              ? "station_disabled"
              : heartbeatResult.kind === "configuration-required"
                ? "inactive_entity"
                : "network_api_failure";
        if (category !== "network_api_failure") {
          await clearPairingState();
        }
        return {
          success: false,
          category,
          correlationId: verifiedRecord.correlationId,
          error:
            category === "post_pair_authentication_failure"
              ? "The new credential was saved but rejected by Presentail OS during verification. Generate a fresh code and try again."
              : category === "station_disabled"
                ? "The station was disabled before its first heartbeat. Enable it and generate a fresh code."
                : category === "inactive_entity"
                  ? "The station has no active default entity. Fix it in Presentail OS and generate a fresh code."
                  : "The pairing record was saved, but Presentail OS could not verify the first heartbeat. Check the network and restart the agent to retry without using another code.",
        };
      }

      logger.info("IPC: pairing successful after authenticated heartbeat", {
        stationId: data.station.id,
        correlationId: verifiedRecord.correlationId,
      });

      await enableAutoStart();

      // Start agent with the new credential
      agentState = {
        serverUrl: verifiedRecord.serverUrl,
        token: verifiedRecord.token,
        stationId: verifiedRecord.station.id,
        stationName: verifiedRecord.station.name,
        entityName: verifiedRecord.station.defaultEntityName,
        correlationId: verifiedRecord.correlationId,
        isCredentialRevoked: false,
      };

      startAgentServices(agentState, true, inboxDir);
      setupWindow?.close();

      return {
        success: true,
        category: "accepted",
        correlationId: verifiedRecord.correlationId,
        inboxDir,
      };
    } catch (err) {
      logger.error("IPC: pairing error", { error: String(err) });
      const axiosModule = await import("axios");
      if (axiosModule.default.isAxiosError(err)) {
        return {
          success: false,
          category: "network_api_failure",
          error:
            "Presentail OS could not be reached. Check the OS URL and network connection, then try again.",
        };
      }
      return {
        success: false,
        category: "api_error",
        error: "Pairing could not be completed. Check the setup and try again.",
      };
    } finally {
      releasePairingAttempt();
    }
  },
);

// ── Agent services ────────────────────────────────────────────────────────────

function onStateChange(state: TrayState): void {
  serviceStateGate.publish(state);
}

function onCredentialRevoked(): void {
  if (agentState) agentState.isCredentialRevoked = true;
  updateTrayState("error");
  // Defer shutdown until the upload/heartbeat callback that confirmed
  // revocation has returned, otherwise stopRetryScheduler can await itself.
  setTimeout(() => void stopAgentServices(), 0);
  logger.error("Credential revoked — agent paused; user must re-pair");
}

function onStationDisabled(): void {
  updateTrayState("disabled");
  logger.error("Station disabled — scans remain queued until it is enabled");
}

function onConfigurationRequired(): void {
  updateTrayState("configuration");
  logger.error(
    "Station configuration required — scans remain queued until an active entity is selected",
  );
}

async function stopAgentServices(): Promise<void> {
  await Promise.all([stopWatcher(), stopRetryScheduler(), stopHeartbeat()]);
}

function startAgentServices(
  state: AgentState,
  initialHeartbeatAuthenticated = false,
  configuredInboxDir = getConfiguredInboxDir(),
): void {
  serviceStateGate.reset();
  let inbox: string;
  let uploaded: string;
  let failed: string;
  try {
    const dirs = ensureScannerDirs(configuredInboxDir);
    inbox = dirs.inbox;
    uploaded = dirs.uploaded;
    failed = dirs.failed;
  } catch (err) {
    logger.error("Agent services could not prepare scan inbox", {
      inboxDir: configuredInboxDir,
      error: String(err),
    });
    startupLog("inbox-initialization-failure", {
      inbox: configuredInboxDir,
      error: String(err),
    });
    createTray({
      stationName: state.stationName,
      entityName: state.entityName,
      agentVersion: AGENT_VERSION,
      inboxDir: configuredInboxDir,
      onRePair: handleRePair,
      onOpenSetup: openSetupWindow,
      onQuit: () => app.quit(),
    });
    trayInitialized = true;
    serviceStateGate.markInboxError();
    return;
  }

  createTray(createTrayOptions(state, inbox));
  trayInitialized = true;
  startupLog("tray-initialized", { state: "paired" });
  writeFirstRunSmokeResult();

  startRetryScheduler({
    serverUrl: state.serverUrl,
    token: state.token,
    agentVersion: AGENT_VERSION,
    inboxDir: inbox,
    uploadedDir: uploaded,
    failedDir: failed,
    onStateChange,
    onCredentialRevoked,
    onStationDisabled,
    onConfigurationRequired,
    verifyDeviceSession: async (correlationId) => {
      const result = await sendImmediateHeartbeat(
        {
          serverUrl: state.serverUrl,
          token: state.token,
          agentVersion: AGENT_VERSION,
          onStateChange: () => undefined,
          onCredentialRevoked: () => undefined,
          onStationDisabled: () => undefined,
          onConfigurationRequired: () => undefined,
        },
        correlationId,
      );
      if (result.kind === "success") return "valid";
      if (result.kind === "credential-revoked") return "credential-revoked";
      if (result.kind === "station-disabled") return "station-disabled";
      if (result.kind === "configuration-required")
        return "configuration-required";
      return "unavailable";
    },
  });

  startHeartbeat({
    serverUrl: state.serverUrl,
    token: state.token,
    agentVersion: AGENT_VERSION,
    onStateChange,
    onCredentialRevoked,
    onStationDisabled,
    onConfigurationRequired,
  });

  startWatcher({
    inboxDir: inbox,
    onReady: () => {
      if (agentState !== state || state.isCredentialRevoked) return;
      serviceStateGate.markReady(
        initialHeartbeatAuthenticated ? "connected" : undefined,
      );
      startupLog("watcher-ready", { inbox });
    },
    onError: (error) => {
      logger.error("Watcher could not monitor configured inbox", {
        inboxDir: inbox,
        error: String(error),
      });
      startupLog("watcher-error", { inbox, error: String(error) });
      serviceStateGate.markInboxError();
    },
  });
  startupLog("watcher-initialized", { inbox });

  // The watcher ready callback publishes the initial connected/offline state.
  logger.info("Agent services started", {
    stationId: state.stationId,
    stationName: state.stationName,
    inboxDir: inbox,
    uploadedDir: uploaded,
    failedDir: failed,
    version: AGENT_VERSION,
    correlationId: state.correlationId,
  });
}

async function resetAgentForPairing(): Promise<boolean> {
  logger.info("Re-pair requested");

  // Stop all services and wait for any in-flight request to finish before
  // clearing the old credential. Queued files remain in the queue database.
  const cleared = await runPairingReset({
    stopWatcher,
    stopRetryScheduler,
    stopHeartbeat,
    clearPairingState,
  });
  if (!cleared) {
    updateTrayState("error");
    logger.error(
      "Re-pair aborted — previous pairing state could not be cleared",
    );
    return false;
  }

  agentState = null;
  pairingStatePrepared = true;
  updateTrayState("unpaired");
  return true;
}

function handleRePair(): void {
  if (rePairResetPromise) return;

  const reset = resetAgentForPairing().then((succeeded) => {
    if (succeeded) openSetupWindow();
    return succeeded;
  });
  rePairResetPromise = reset;
  void reset.then(
    () => {
      if (rePairResetPromise === reset) rePairResetPromise = null;
    },
    () => {
      if (rePairResetPromise === reset) rePairResetPromise = null;
    },
  );
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
          logger.info("Auto-update: user triggered download", {
            version: info.version,
          });
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
        logger.info("Auto-update: download complete", {
          version: info.version,
        });

        new Notification({
          title: "Presentail Scanner Agent",
          body: `Update ready (v${info.version}) — will install when you quit`,
        }).show();
      });

      autoUpdater.on("error", (err: Error) => {
        // Log as warn — update failures are non-fatal
        logger.warn("Auto-update: error during check/download", {
          error: String(err),
        });
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
      logger.warn("Auto-update: failed to load electron-updater", {
        error: String(err),
      });
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

  logger.info("Agent starting", {
    version: AGENT_VERSION,
    platform: process.platform,
  });

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

  let savedPairing = await loadPairingRecord();
  if (!savedPairing) {
    const legacyPairing = await loadLegacyPairingRecord();
    if (legacyPairing) {
      const migrationCorrelationId = randomUUID();
      const migrationHeartbeat = await sendImmediateHeartbeat(
        {
          serverUrl: normalizeServerUrl(legacyPairing.serverUrl),
          token: legacyPairing.token,
          agentVersion: AGENT_VERSION,
          onStateChange: () => undefined,
          onCredentialRevoked: () => undefined,
          onStationDisabled: () => undefined,
          onConfigurationRequired: () => undefined,
        },
        migrationCorrelationId,
      );
      if (migrationHeartbeat.kind === "success" && migrationHeartbeat.station) {
        savedPairing = await saveAndVerifyPairingRecord({
          schemaVersion: 1,
          serverUrl: normalizeServerUrl(legacyPairing.serverUrl),
          token: legacyPairing.token,
          station: migrationHeartbeat.station,
          credential: {
            tokenType: "Bearer",
            issuedAt: new Date().toISOString(),
            expiresAt: null,
          },
          correlationId:
            migrationHeartbeat.correlationId || migrationCorrelationId,
        });
        if (savedPairing) {
          await clearLegacyPairingState();
          logger.info("Legacy pairing migrated and verified", {
            stationId: savedPairing.station.id,
            correlationId: savedPairing.correlationId,
          });
        }
      }
      if (!savedPairing) {
        logger.warn(
          "Legacy pairing migration deferred; split record preserved",
          {
            heartbeatResult: migrationHeartbeat.kind,
          },
        );
        agentState = {
          serverUrl: normalizeServerUrl(legacyPairing.serverUrl),
          token: legacyPairing.token,
          stationId: migrationHeartbeat.station?.id ?? 0,
          stationName:
            migrationHeartbeat.station?.name ?? legacyPairing.stationName,
          entityName:
            migrationHeartbeat.station?.defaultEntityName ??
            legacyPairing.entityName,
          correlationId: migrationCorrelationId,
          isCredentialRevoked: false,
        };
      }
    }
  }
  startupLog("credential-check-complete", {
    credentialExists: Boolean(savedPairing?.token),
    stationId: savedPairing?.station.id ?? null,
  });

  if (savedPairing) {
    const startupHeartbeat = await sendImmediateHeartbeat(
      {
        serverUrl: savedPairing.serverUrl,
        token: savedPairing.token,
        agentVersion: AGENT_VERSION,
        onStateChange: () => undefined,
        onCredentialRevoked: () => undefined,
        onStationDisabled: () => undefined,
        onConfigurationRequired: () => undefined,
      },
      savedPairing.correlationId,
    );
    logger.info("Startup pairing verification completed", {
      stationId: savedPairing.station.id,
      correlationId: savedPairing.correlationId,
      result: startupHeartbeat.kind,
      statusCode: startupHeartbeat.statusCode,
    });
    if (startupHeartbeat.kind !== "success") {
      if (
        startupHeartbeat.kind === "credential-revoked" ||
        startupHeartbeat.kind === "station-disabled" ||
        startupHeartbeat.kind === "configuration-required"
      ) {
        await clearPairingState();
        agentState = null;
      }
      openSetupWindow();
      createTray({
        stationName: savedPairing.station.name,
        entityName: savedPairing.station.defaultEntityName,
        agentVersion: AGENT_VERSION,
        inboxDir: getConfiguredInboxDir(),
        onRePair: handleRePair,
        onOpenSetup: openSetupWindow,
        onQuit: () => app.quit(),
      });
      trayInitialized = true;
      updateTrayState(
        startupHeartbeat.kind === "credential-revoked"
          ? "error"
          : startupHeartbeat.kind === "station-disabled"
            ? "disabled"
            : startupHeartbeat.kind === "configuration-required"
              ? "configuration"
              : "offline",
      );
      return;
    }
    logger.info(
      "Verified pairing record authenticated — starting agent services",
      {
        stationId: savedPairing.station.id,
        version: AGENT_VERSION,
        correlationId: savedPairing.correlationId,
      },
    );
    agentState = {
      serverUrl: savedPairing.serverUrl,
      token: savedPairing.token,
      stationId: savedPairing.station.id,
      stationName: savedPairing.station.name,
      entityName: savedPairing.station.defaultEntityName,
      correlationId: savedPairing.correlationId,
      isCredentialRevoked: false,
    };
    startAgentServices(agentState, true);
  } else if (agentState) {
    logger.info(
      "Starting with preserved legacy pairing while migration is deferred",
      {
        version: AGENT_VERSION,
      },
    );
    startAgentServices(agentState);
  } else {
    startupLog("unpaired-first-run");
    logger.info("No credential — opening setup window");
    openSetupWindow();
    createTray({
      stationName: "Not paired",
      entityName: "",
      agentVersion: AGENT_VERSION,
      inboxDir: getConfiguredInboxDir(),
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
  void stopAgentServices();
  closeQueue();
  destroyTray();
});

// Catch unhandled exceptions and log them (never crash silently)
process.on("uncaughtException", (err) => {
  startupLog("fatal-uncaught-exception", {
    error: String(err),
    stack: err.stack,
  });
  logger.error("Uncaught exception", { error: String(err), stack: err.stack });
});

process.on("unhandledRejection", (reason) => {
  startupLog("fatal-unhandled-rejection", { error: String(reason) });
  logger.error("Unhandled rejection", { reason: String(reason) });
});
