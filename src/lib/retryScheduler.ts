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
  verifyDeviceSession?: (
    correlationId: string,
  ) => Promise<
    | "valid"
    | "credential-revoked"
    | "station-disabled"
    | "configuration-required"
    | "unavailable"
  >;
}

let retryTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let opts: SchedulerOptions | null = null;
let activeProcessing: Promise<void> | null = null;
const activeImmediateUploads = new Set<Promise<void>>();
const activeUploadHashes = new Set<string>();
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

/** Trigger a queue pass now, used after recovery signals and by regression tests. */
export function triggerRetryProcessing(): void {
  beginProcessing();
}

/**
 * Trigger an immediate upload attempt for one file (bypassing queue delay).
 * Used when a new file is detected by the watcher.
 */
export async function attemptImmediateUpload(
  filePath: string,
  sha256: string,
  capturedAt: string,
  queueId = -1,
): Promise<void> {
  if (!opts) return;
  const options = opts;
  const generation = schedulerGeneration;
  const upload = doUpload(
    {
      id: queueId,
      filePath,
      sha256,
      capturedAt,
      attemptCount: 0,
    },
    options,
    generation,
  );
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

    logger.info("RetryScheduler: processing due entries", {
      count: due.length,
    });

    for (const entry of due) {
      if (activeUploadHashes.has(entry.sha256)) continue;
      await doUpload(
        {
          id: entry.id,
          filePath: entry.file_path,
          sha256: entry.sha256,
          capturedAt: entry.captured_at,
          attemptCount: entry.attempt_count,
        },
        options,
        generation,
      );
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
  if (activeUploadHashes.has(task.sha256)) return;
  activeUploadHashes.add(task.sha256);
  try {
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
      verifyDeviceSession,
    } = options;

    logger.debug("RetryScheduler: processing with configured inbox", {
      inboxDir,
      uploadedDir,
      failedDir,
    });

    // Skip if file no longer exists
    if (!fs.existsSync(task.filePath)) {
      logger.warn("RetryScheduler: file missing, removing from queue", {
        filePath: task.filePath,
      });
      if (task.id > 0) markDone(task.id);
      return;
    }

    onStateChange("uploading");

    const result = await uploadFile(
      serverUrl,
      token,
      task.filePath,
      agentVersion,
    );
    if (generation !== schedulerGeneration) {
      logger.info("Upload callback ignored for superseded pairing generation", {
        filePath: task.filePath,
        generation,
      });
      return;
    }

    switch (result.kind) {
      case "success": {
        const destName = timestampedName(path.basename(task.filePath));
        const destPath = path.join(uploadedDir, destName);
        if (!moveFile(task.filePath, destPath)) {
          if (task.id > 0) scheduleRetry(task.id, task.attemptCount);
          logger.warn(
            "Upload accepted but local archive move failed — queued for duplicate-safe retry",
            {
              filePath: task.filePath,
              importId: result.importId,
              correlationId: result.correlationId ?? null,
            },
          );
          onStateChange("inbox-error");
          break;
        }
        if (task.id > 0) markDone(task.id);
        notifySuccess(path.basename(task.filePath), false);
        logger.info("Upload complete", {
          filePath: task.filePath,
          importId: result.importId,
          correlationId: result.correlationId ?? null,
        });
        onStateChange("connected");
        break;
      }

      case "duplicate": {
        const destName = timestampedName(path.basename(task.filePath));
        const destPath = path.join(uploadedDir, destName);
        if (!moveFile(task.filePath, destPath)) {
          if (task.id > 0) scheduleRetry(task.id, task.attemptCount);
          logger.warn(
            "Duplicate confirmed but local archive move failed — queued for retry",
            {
              filePath: task.filePath,
              importId: result.importId,
              correlationId: result.correlationId ?? null,
            },
          );
          onStateChange("inbox-error");
          break;
        }
        if (task.id > 0) markDone(task.id);
        notifySuccess(path.basename(task.filePath), true);
        logger.info("Upload duplicate (already imported)", {
          filePath: task.filePath,
          importId: result.importId,
          correlationId: result.correlationId ?? null,
        });
        onStateChange("connected");
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
          correlationId: result.correlationId ?? null,
        });
        onStateChange("offline");
        break;
      }

      case "permanent": {
        // Authentication and station configuration failures must leave the
        // file queued in Inbox. The operator can recover without losing scans.
        if (result.statusCode === 401) {
          logger.warn(
            "Upload authentication rejected — confirming active device session",
            {
              filePath: task.filePath,
              correlationId: result.correlationId ?? null,
            },
          );
          const confirmation = verifyDeviceSession
            ? await verifyDeviceSession(
                result.correlationId ?? "upload-auth-check",
              )
            : "unavailable";
          if (generation !== schedulerGeneration) return;
          if (confirmation === "credential-revoked") {
            logger.error(
              "Upload authentication confirmed credential revocation",
              {
                filePath: task.filePath,
                correlationId: result.correlationId ?? null,
              },
            );
            onCredentialRevoked();
            notifyCredentialRevoked();
            onStateChange("error");
            break;
          }
          if (task.id > 0) scheduleRetry(task.id, task.attemptCount);
          if (confirmation === "station-disabled") {
            onStationDisabled?.();
            notifyStationDisabled();
            onStateChange("disabled");
          } else if (confirmation === "configuration-required") {
            onConfigurationRequired?.();
            notifyConfigurationRequired();
            onStateChange("configuration");
          } else {
            notifyQueued(path.basename(task.filePath));
            onStateChange("offline");
          }
          logger.warn(
            "Upload 401 preserved in queue after session confirmation",
            {
              filePath: task.filePath,
              confirmation,
              correlationId: result.correlationId ?? null,
            },
          );
          break;
        }
        if (result.statusCode === 403) {
          logger.error("Upload: station disabled (403)", {
            filePath: task.filePath,
          });
          if (onStationDisabled) onStationDisabled();
          else onStateChange("disabled");
          notifyStationDisabled();
          onStateChange("disabled");
          if (task.id > 0) scheduleRetry(task.id, task.attemptCount);
          break;
        }
        if (result.statusCode === 409) {
          logger.error("Upload: station configuration required (409)", {
            filePath: task.filePath,
          });
          if (onConfigurationRequired) onConfigurationRequired();
          else onStateChange("configuration");
          notifyConfigurationRequired();
          onStateChange("configuration");
          if (task.id > 0) scheduleRetry(task.id, task.attemptCount);
          break;
        }

        const destName = timestampedName(path.basename(task.filePath));
        const destPath = path.join(failedDir, destName);
        if (!moveFile(task.filePath, destPath)) {
          if (task.id > 0) scheduleRetry(task.id, task.attemptCount);
          logger.error(
            "Upload rejected but local Failed-folder move failed — scan remains queued",
            {
              filePath: task.filePath,
              reason: result.reason,
              statusCode: result.statusCode,
              correlationId: result.correlationId ?? null,
            },
          );
          onStateChange("inbox-error");
          break;
        }
        if (task.id > 0) markDone(task.id);
        writeSidecarError(
          destPath,
          result.reason ?? "Permanent failure",
          result.statusCode,
        );
        notifyPermanentFailure(
          path.basename(task.filePath),
          result.reason ?? "Permanent failure",
        );
        logger.error("Upload permanent failure — moved to Failed", {
          filePath: task.filePath,
          reason: result.reason,
          statusCode: result.statusCode,
          correlationId: result.correlationId ?? null,
        });
        onStateChange("connected");
        break;
      }
    }
  } finally {
    activeUploadHashes.delete(task.sha256);
  }
}

function writeSidecarError(
  destPath: string,
  reason: string,
  statusCode?: number,
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
    logger.warn("Could not write error sidecar", {
      sidecarPath,
      error: String(err),
    });
  }
}
