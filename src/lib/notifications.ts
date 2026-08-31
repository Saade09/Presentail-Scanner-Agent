import { Notification } from "electron";
import { logger } from "./logger.js";

const APP_NAME = "Presentail Scanner";

function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) {
      logger.warn("Notifications not supported on this platform");
      return;
    }
    const n = new Notification({ title, body, silent: false });
    n.show();
  } catch (err) {
    logger.warn("Notification failed", { title, error: String(err) });
  }
}

/** File uploaded successfully (202). */
export function notifySuccess(filename: string, isDuplicate: boolean): void {
  if (isDuplicate) {
    notify(
      `${APP_NAME} — Already imported`,
      `"${filename}" was already imported into Presentail OS.`
    );
  } else {
    notify(
      `${APP_NAME} — Uploaded`,
      `"${filename}" uploaded successfully.`
    );
  }
}

/** File queued due to recoverable failure. */
export function notifyQueued(filename: string): void {
  notify(
    `${APP_NAME} — Queued`,
    `"${filename}" could not be uploaded right now and has been queued for retry.`
  );
}

/** File permanently failed (non-retryable error). */
export function notifyPermanentFailure(filename: string, reason: string): void {
  notify(
    `${APP_NAME} — Could not upload`,
    `"${filename}" failed: ${reason}. Moved to Failed folder.`
  );
}

/** 401 Unauthorized — credential revoked. */
export function notifyCredentialRevoked(): void {
  notify(
    `${APP_NAME} — Re-pair required`,
    "This device's credential was revoked. Open the tray icon to re-pair."
  );
}
