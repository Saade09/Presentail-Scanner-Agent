import { dequeueDue, markDone, scheduleRetry, getCount } from "./queue.js";
import { uploadFile } from "./uploader.js";
import { moveFile, timestampedName } from "./fileOps.js";
import { logger } from "./logger.js";
import {
  notifySuccess,
  notifyQueued,
  notifyPermanentFailure,
  notifyCredentialRevoked,
  notifyStationDisabled,
  notifyConfigurationRequired,
} from "./notifications.js";
import * as path from "path";
import * as fs from "fs";

const RETRY_CHECK_INTERVAL_MS = 10_000; // check queue every 10 seconds

export type TrayStateCallback = (state: TrayState) => void;
export type TrayState =
  | "connected"
  | "uploading"
  | "offline"
  | "error"
  | "disabled"
  | "configuration"
  | "inbox-error"
  | "unpaired";

interface SchedulerOptions {
  serverUrl: string;
  token: string;
  agentVersion: string;
  inboxDir: string;
  uploadedDir: string;
  failedDir: string;
  onStateChange: TrayStateCallback;
  onCredentialRevoked: () => void;
  onStationDisabled?: () => void;
  onConfigurationRequired?: () => void;
}

let retryTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let opts: SchedulerOptions | null = null;
let activeProcessing: Promise<void> | null = null;
const activeImmediateUploads = new Set<Promise<void>>();
let schedulerGeneration = 0;

/**
 * Start the retry scheduler. Checks the queue on interval.
 */
export function startRetryScheduler(options: SchedulerOptions): void {
  schedulerGeneration += 1;
  opts = options;
  if (retryTimer) return;

  logger.info("RetryScheduler: starting");

  // Process immediately on start (pick up items from last session)
  beginProcessing();

  retryTimer = setInterval(() => {
    beginProcessing();
  }, RETRY_CHECK_INTERVAL_MS);
}

/**
 * Stop the retry scheduler.
 */
export async function stopRetryScheduler(): Promise<void> {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  schedulerGeneration += 1;
  opts = null;
  const activeRun = activeProcessing;
  await Promise.all([
    ...(activeRun ? [activeRun] : []),
    ...activeImmediateUploads,
  ]);
  logger.info("RetryScheduler: stopped");
}

function beginProcessing(): void {
  if (activeProcessing || !opts) return;
  const run = processDueEntries(opts, schedulerGeneration);
  activeProcessing = run;
  void run.finally(() => {
    if (activeProcessing === run) activeProcessing = null;
  });
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
  const options = opts;
  const generation = schedulerGeneration;
  const upload = doUpload({
    id: -1,
    filePath,
    sha256,
    capturedAt,
    attemptCount: 0,
  }, options, generation);
  activeImmediateUploads.add(upload);
  try {
    await upload;
  } finally {
    activeImmediateUploads.delete(upload);
  }
}

async function processDueEntries(
  options: SchedulerOptions,
  generation: number,
): Promise<void> {
  if (isRunning || generation !== schedulerGeneration) return;
  isRunning = true;

  try {
    const due = dequeueDue();
    if (due.length === 0) {
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
      }, options, generation);
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

async function doUpload(
  task: UploadTask,
  options: SchedulerOptions,
  generation: number,
): Promise<void> {
  if (generation !== schedulerGeneration) return;
  const {
    serverUrl,
    token,
    agentVersion,
    inboxDir,
    uploadedDir,
    failedDir,
    onStateChange,
    onCredentialRevoked,
    onStationDisabled,
    onConfigurationRequired,
  } = options;

  logger.debug("RetryScheduler: processing with configured inbox", {
    inboxDir,
    uploadedDir,
    failedDir,
  });

  // Skip if file no longer exists
  if (!fs.existsSync(task.filePath)) {
    logger.warn("RetryScheduler: file missing, removing from queue", { filePath: task.filePath });
    if (task.id > 0) markDone(task.id);
    return;
  }

  onStateChange("uploading");

  const result = await uploadFile(serverUrl, token, task.filePath, agentVersion);
  if (generation !== schedulerGeneration) {
    logger.info("Upload callback ignored for superseded pairing generation", {
      filePath: task.filePath,
      generation,
    });
    return;
  }

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
      // Authentication and station configuration failures must leave the
      // file queued in Inbox. The operator can recover without losing scans.
      if (result.statusCode === 401) {
        logger.error("Upload: credential revoked (401)", { filePath: task.filePath });
        onCredentialRevoked();
        notifyCredentialRevoked();
        onStateChange("error");
        break;
      }
      if (result.statusCode === 403) {
        logger.error("Upload: station disabled (403)", { filePath: task.filePath });
        if (onStationDisabled) onStationDisabled();
        else onStateChange("disabled");
        notifyStationDisabled();
        onStateChange("disabled");
        break;
      }
      if (result.statusCode === 409) {
        logger.error("Upload: station configuration required (409)", { filePath: task.filePath });
        if (onConfigurationRequired) onConfigurationRequired();
        else onStateChange("configuration");
        notifyConfigurationRequired();
        onStateChange("configuration");
        break;
      }

      if (task.id > 0) markDone(task.id);

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
