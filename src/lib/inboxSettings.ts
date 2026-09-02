import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

export const DEFAULT_INBOX_DIR = "C:\\PresentailScanner\\Inbox";
const SETTINGS_SCHEMA_VERSION = 1;

interface InboxSettingsFile {
  schemaVersion: 1;
  inboxDir: string;
}

/**
 * Normalize and validate a Windows directory path.
 *
 * The scanner agent is intentionally Windows-only. Using win32 rather than
 * the host path implementation keeps validation correct in tests and when a
 * path is received from the renderer.
 */
export function normalizeInboxDir(input: string): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) {
    throw new Error("Scan inbox path is required.");
  }
  const isDriveAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  const isUncAbsolute = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(value);
  if (!isDriveAbsolute && !isUncAbsolute) {
    throw new Error(
      "Scan inbox path must be an absolute Windows path, such as C:\\PresentailScanner\\Inbox.",
    );
  }

  let normalized = path.win32.normalize(value);
  const root = path.win32.parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith("\\")) {
    normalized = normalized.slice(0, -1);
  }
  const leaf = path.win32.basename(normalized).toLowerCase();
  if (leaf === "uploaded" || leaf === "failed") {
    throw new Error(
      "Scan inbox cannot be named Uploaded or Failed because those folders are reserved for processed scans.",
    );
  }
  if (normalized.length > 240) {
    throw new Error("Scan inbox path is too long for a Windows folder.");
  }
  return normalized;
}

export function loadInboxDir(settingsPath: string): string {
  try {
    if (!fs.existsSync(settingsPath)) return DEFAULT_INBOX_DIR;
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<InboxSettingsFile>;
    if (
      parsed.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
      typeof parsed.inboxDir !== "string"
    ) {
      throw new Error("unsupported settings format");
    }
    return normalizeInboxDir(parsed.inboxDir);
  } catch (err) {
    logger.warn("Inbox settings unavailable; using backward-compatible default", {
      settingsPath,
      error: String(err),
    });
    return DEFAULT_INBOX_DIR;
  }
}

/**
 * Write settings atomically so a process or machine restart cannot leave a
 * truncated path behind. This file contains no pairing credentials.
 */
export function saveInboxDir(settingsPath: string, inboxDir: string): void {
  const normalized = normalizeInboxDir(inboxDir);
  const settings: InboxSettingsFile = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    inboxDir: normalized,
  };
  const directory = path.dirname(settingsPath);
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;

  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, settingsPath);
  } catch (err) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original persistence error.
    }
    throw new Error(`Could not save the scan inbox setting: ${String(err)}`);
  }
}