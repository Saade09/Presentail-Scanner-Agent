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
export function moveFile(src: string, dest: string): void {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    logger.info("FileOps: moved file", { src, dest });
  } catch (renameErr) {
    // Cross-device rename fails on Windows when drives differ — fall back to copy+delete
    try {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
      logger.info("FileOps: copy-moved file (cross-device)", { src, dest });
    } catch (copyErr) {
      logger.error("FileOps: failed to move file", {
        src,
        dest,
        error: String(copyErr),
      });
    }
  }
}

/**
 * Ensure the three standard subdirectories exist under the scanner root.
 */
export function ensureScannerDirs(root: string): {
  inbox: string;
  uploaded: string;
  failed: string;
} {
  const inbox    = path.join(root, "Inbox");
  const uploaded = path.join(root, "Uploaded");
  const failed   = path.join(root, "Failed");

  for (const dir of [inbox, uploaded, failed]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return { inbox, uploaded, failed };
}
