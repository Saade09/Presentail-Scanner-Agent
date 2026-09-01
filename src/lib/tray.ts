import * as path from "path";
import { Tray, Menu, app, shell } from "electron";
import { getCount } from "./queue.js";
import { logDir } from "./logger.js";
import { logger } from "./logger.js";
import type { TrayState } from "./retryScheduler.js";

// Icon filenames per state (loaded from assets/)
const ICON_FILES: Record<TrayState, string> = {
  connected: "icon-connected.png",
  uploading: "icon-uploading.png",
  offline:   "icon-offline.png",
  error:     "icon-error.png",
  unpaired:  "icon-error.png",
};

interface TrayOptions {
  stationName: string;
  entityName: string;
  onRePair: () => void;
  onOpenSetup: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let currentState: TrayState = "unpaired";
let lastUploadAt: string | null = null;
let trayOpts: TrayOptions | null = null;

function getIconPath(state: TrayState): string {
  return path.join(
    app.getAppPath(),
    "assets",
    ICON_FILES[state] ?? ICON_FILES.error
  );
}

/**
 * Create and show the system tray icon.
 */
export function createTray(options: TrayOptions): void {
  trayOpts = options;

  const iconPath = getIconPath("unpaired");
  tray = new Tray(iconPath);
  tray.setToolTip("Presentail Scanner Agent — starting…");

  refreshTray();

  logger.info("Tray: created");
}

/**
 * Update the tray state icon, tooltip, and context menu.
 */
export function updateTrayState(state: TrayState): void {
  if (!tray) return;
  currentState = state;
  refreshTray();
}

/**
 * Record the last successful upload timestamp.
 */
export function recordUpload(): void {
  lastUploadAt = new Date().toLocaleTimeString();
  refreshTray();
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

function refreshTray(): void {
  if (!tray || !trayOpts) return;

  const { stationName, entityName, onRePair, onOpenSetup, onQuit } = trayOpts;
  const queuedCount = getCount();

  // Update icon
  try {
    tray.setImage(getIconPath(currentState));
  } catch {
    // Ignore icon errors in dev (icons may not exist)
  }

  // Build tooltip
  const stateLabel: Record<TrayState, string> = {
    connected: "Connected",
    uploading: "Uploading…",
    offline:   "Offline / Queued",
    error:     "Error — re-pair required",
    unpaired:  "Not paired",
  };

  const tooltipLines = [
    `Presentail Scanner Agent`,
    `Station: ${stationName || "unknown"}`,
    `Entity: ${entityName || "—"}`,
    `Status: ${stateLabel[currentState]}`,
    queuedCount > 0 ? `Queued: ${queuedCount}` : "",
    lastUploadAt ? `Last upload: ${lastUploadAt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  tray.setToolTip(tooltipLines);

  // Build context menu
  const menuItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Presentail Scanner Agent",
      enabled: false,
    },
    { type: "separator" },
    {
      label: `Station: ${stationName || "—"}`,
      enabled: false,
    },
    {
      label: `Entity: ${entityName || "—"}`,
      enabled: false,
    },
    {
      label: `Status: ${stateLabel[currentState]}`,
      enabled: false,
    },
    {
      label: `Queued: ${queuedCount}`,
      enabled: false,
    },
    ...(lastUploadAt
      ? [
          {
            label: `Last upload: ${lastUploadAt}`,
            enabled: false,
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    { type: "separator" },
    {
      label: "Open pairing / settings…",
      click: () => {
        logger.info("Tray: user opened pairing/settings");
        onOpenSetup();
      },
    },
    {
      label: "Re-pair station…",
      click: () => {
        logger.info("Tray: user requested re-pair");
        onRePair();
      },
    },
    {
      label: "Open Logs Folder",
      click: () => {
        shell.openPath(logDir).catch(() => undefined);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        logger.info("Tray: user requested quit");
        onQuit();
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}
