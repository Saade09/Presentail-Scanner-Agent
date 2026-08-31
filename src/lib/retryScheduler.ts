import { dequeueDue, markDone, scheduleRetry, getCount } from "./queue.js";
import { uploadFile } from "./uploader.js";
import { moveFile, timestampedName } from "./fileOps.js";
import { logger } from "./logger.js";
import { notifySuccess, notifyQueued, notifyPermanentFailure, notifyCredentialRevoked } from "./notifications.js";
import * as path from "path";
import * as fs from "fs";

const RETRY_CHECK_INTERVAL_MS = 10_000; // check queue every 10 seconds

export type TrayStateCallback = (state: TrayState) => void;
export type TrayState = "connected" | "uploading" | "offline" | "error" | "unpaired";

interface SchedulerOptions {
  serverUrl: string;
  token: string;
  agentVersion: string;
  uploadedDir: string;
  failedDir: string;
  onStateChange: TrayStateCallback;
  onCredentialRevoked: () => void;
}

let retryTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let opts: SchedulerOptions | null = null;

/**
 * Start the retry scheduler. Checks the queue on interval.
 */
export function startRetryScheduler(options: SchedulerOptions): void {
  opts = options;
  if (retryTimer) return;

  logger.info("RetryScheduler: starting");

  // Process immediately on start (pick up items from last session)
  void processDueEntries();

  retryTimer = setInterval(() => {
    void processDueEntries();
  }, RETRY_CHECK_INTERVAL_MS);
}

/**
 * Stop the retry scheduler.
 */
export function stopRetryScheduler(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  logger.info("RetryScheduler: stopped");
}

/**
 * Trigger an immediate upload attempt for one file (bypassing queue delay).
 * Used when a new file is detected by the watcher.
 */
export async function attemptImmediateUpload(
  filePath: string,
  sha256: string,
  capturedAt: string
): Promise<void> {
  if (!opts) return;
  await doUpload({ id: -1, filePath, sha256, capturedAt, attemptCount: 0 });
}

async function processDueEntries(): Promise<void> {
  if (isRunning || !opts) return;
  isRunning = true;

  try {
    const due = dequeueDue();
    if (due.length === 0) {
      opts.onStateChange("connected");
      return;
    }

    logger.info("RetryScheduler: processing due entries", { count: due.length });

    for (const entry of due) {
      await doUpload({
        id: entry.id,
        filePath: entry.file_path,
        sha256: entry.sha256,
        capturedAt: entry.captured_at,
        attemptCount: entry.attempt_count,
      });
    }
  } finally {
    isRunning = false;
  }
}

interface UploadTask {
  id: number;
  filePath: string;
  sha256: string;
  capturedAt: string;
  attemptCount: number;
}

async function doUpload(task: UploadTask): Promise<void> {
  if (!opts) return;
  const { serverUrl, token, agentVersion, uploadedDir, failedDir, onStateChange, onCredentialRevoked } = opts;

  // Skip if file no longer exists
  if (!fs.existsSync(task.filePath)) {
    logger.warn("RetryScheduler: file missing, removing from queue", { filePath: task.filePath });
    if (task.id > 0) markDone(task.id);
    return;
  }

  onStateChange("uploading");

  const result = await uploadFile(serverUrl, token, task.filePath, agentVersion);

  switch (result.kind) {
    case "success": {
      if (task.id > 0) markDone(task.id);
      const destName = timestampedName(path.basename(task.filePath));
      const destPath = path.join(uploadedDir, destName);
      moveFile(task.filePath, destPath);
      notifySuccess(path.basename(task.filePath), false);
      logger.info("Upload complete", { filePath: task.filePath, importId: result.importId });
      onStateChange(getCount() > 0 ? "offline" : "connected");
      break;
    }

    case "duplicate": {
      if (task.id > 0) markDone(task.id);
      const destName = timestampedName(path.basename(task.filePath));
      const destPath = path.join(uploadedDir, destName);
      moveFile(task.filePath, destPath);
      notifySuccess(path.basename(task.filePath), true);
      logger.info("Upload duplicate (already imported)", { filePath: task.filePath });
      onStateChange(getCount() > 0 ? "offline" : "connected");
      break;
    }

    case "recoverable": {
      if (task.id > 0) {
        scheduleRetry(task.id, task.attemptCount);
      }
      notifyQueued(path.basename(task.filePath));
      logger.warn("Upload recoverable failure — queued for retry", {
        filePath: task.filePath,
        reason: result.reason,
        attempt: task.attemptCount + 1,
      });
      onStateChange("offline");
      break;
    }

    case "permanent": {
      if (task.id > 0) markDone(task.id);

      // Special case: 401 = credential revoked
      if (result.statusCode === 401) {
        logger.error("Upload: credential revoked (401)", { filePath: task.filePath });
        onCredentialRevoked();
        notifyCredentialRevoked();
        onStateChange("error");
        break;
      }

      const destName = timestampedName(path.basename(task.filePath));
      const destPath = path.join(failedDir, destName);
      moveFile(task.filePath, destPath);
      writeSidecarError(destPath, result.reason ?? "Permanent failure", result.statusCode);
      notifyPermanentFailure(path.basename(task.filePath), result.reason ?? "Permanent failure");
      logger.error("Upload permanent failure — moved to Failed", {
        filePath: task.filePath,
        reason: result.reason,
        statusCode: result.statusCode,
      });
      onStateChange(getCount() > 0 ? "offline" : "connected");
      break;
    }
  }
}

function writeSidecarError(
  destPath: string,
  reason: string,
  statusCode?: number
): void {
  const sidecar = {
    reason,
    statusCode,
    timestamp: new Date().toISOString(),
    serverResponse: "[not logged]",
  };
  const sidecarPath = destPath + ".error.json";
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf8");
  } catch (err) {
    logger.warn("Could not write error sidecar", { sidecarPath, error: String(err) });
  }
}
