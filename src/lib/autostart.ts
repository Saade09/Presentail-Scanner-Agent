import { app } from "electron";
import { logger } from "./logger.js";

const REG_KEY_PATH = "\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REG_VALUE_NAME = "PresentailScannerAgent";

/**
 * Write (or update) the Windows Registry Run entry so the agent
 * starts automatically on user login.
 *
 * Uses winreg for HKCU access — no UAC elevation required.
 * Falls back gracefully on non-Windows platforms.
 */
export async function enableAutoStart(): Promise<void> {
  if (process.platform !== "win32") {
    logger.info("AutoStart: skipped (non-Windows platform)");
    return;
  }

  const execPath = app.getPath("exe");

  try {
    const Winreg = (await import("winreg")).default;
    const key = new Winreg({
      hive: Winreg.HKCU,
      key: REG_KEY_PATH,
    });

    await new Promise<void>((resolve, reject) => {
      key.set(REG_VALUE_NAME, Winreg.REG_SZ, `"${execPath}"`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info("AutoStart: registry entry written", {
      key: REG_KEY_PATH,
      value: REG_VALUE_NAME,
      execPath,
    });
  } catch (err) {
    logger.error("AutoStart: failed to write registry entry", {
      error: String(err),
    });
  }
}

/**
 * Remove the Windows Registry Run entry (for clean uninstall / re-pair clear).
 */
export async function removeAutoStart(): Promise<void> {
  if (process.platform !== "win32") return;

  try {
    const Winreg = (await import("winreg")).default;
    const key = new Winreg({
      hive: Winreg.HKCU,
      key: REG_KEY_PATH,
    });

    await new Promise<void>((resolve) => {
      key.remove(REG_VALUE_NAME, (err) => {
        if (err) {
          // Ignore "not found" errors
          logger.warn("AutoStart: registry remove error (may not exist)", {
            error: String(err),
          });
        }
        resolve();
      });
    });

    logger.info("AutoStart: registry entry removed");
  } catch (err) {
    logger.error("AutoStart: failed to remove registry entry", {
      error: String(err),
    });
  }
}
