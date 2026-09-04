import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

/**
 * Generate a timestamp-prefixed filename.
 * e.g. "20240115T143022_invoice.pdf"
 */
export function timestampedName(originalName: string): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "T")
    .split(".")[0];
  return `${ts}_${originalName}`;
}

/**
 * Move a file from src to dest, creating dest parent directories as needed.
 * Falls back to copy+delete if rename fails across drives.
 */
export function moveFile(src: string, dest: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    logger.info("FileOps: moved file", { src, dest });
    return true;
  } catch (renameErr) {
    // Cross-device rename fails on Windows when drives differ — fall back to copy+delete
    try {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      logger.info("FileOps: copy-moved file (cross-device)", { src, dest });
      return true;
    } catch (copyErr) {
      logger.error("FileOps: failed to move file", {
        src,
        dest,
        error: String(copyErr),
      });
      return false;
    }
  }
}

export interface ScannerDirs {
  inbox: string;
  uploaded: string;
  failed: string;
}

/**
 * The inbox, Uploaded, and Failed folders are siblings. This preserves the
 * original C:\PresentailScanner\{Inbox,Uploaded,Failed} layout while allowing
 * HP Scan to use a different inbox such as a Desktop folder.
 */
export function getScannerDirs(inboxDir: string): ScannerDirs {
  const windowsPath =
    /^[A-Za-z]:[\\/]/.test(inboxDir) ||
    /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(inboxDir);
  const pathApi = windowsPath ? path.win32 : path;
  const inbox = inboxDir;
  const parent = pathApi.dirname(inboxDir);
  const dirs = {
    inbox,
    uploaded: pathApi.join(parent, "Uploaded"),
    failed: pathApi.join(parent, "Failed"),
  };
  const comparisonKey = (value: string) =>
    windowsPath
      ? path.win32.normalize(value).toLowerCase()
      : path.resolve(value);
  if (new Set(Object.values(dirs).map(comparisonKey)).size !== 3) {
    throw new Error(
      "Inbox, Uploaded, and Failed must resolve to three different folders.",
    );
  }
  return dirs;
}

export function ensureScannerDirs(inboxDir: string): ScannerDirs {
  const { inbox, uploaded, failed } = getScannerDirs(inboxDir);

  for (const dir of [inbox, uploaded, failed]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return { inbox, uploaded, failed };
}
