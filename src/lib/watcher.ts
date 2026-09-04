import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { FileStabilityGuard } from "./stability.js";
import { computeSha256 } from "./uploader.js";
import { enqueue } from "./queue.js";
import { attemptImmediateUpload } from "./retryScheduler.js";
import { logger } from "./logger.js";
import * as fs from "fs";
import { randomUUID } from "crypto";

const WATCHED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

export interface WatcherOptions {
  inboxDir: string;
  onError?: (error: Error) => void;
  onReady?: () => void;
  restartDelayMs?: number;
  watcherFactory?: typeof chokidar.watch;
}

let watcher: FSWatcher | null = null;
let guard: FileStabilityGuard | null = null;
const activeStableTasks = new Set<Promise<void>>();
const fileAccessRetryTimers = new Set<ReturnType<typeof setTimeout>>();
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let watcherGeneration = 0;
const WATCHER_RESTART_DELAY_MS = 5_000;

/**
 * Start watching the Inbox directory.
 * Files detected via add/change are tracked by the stability guard;
 * once stable, they are hashed, enqueued, and an immediate upload is attempted.
 */
export function startWatcher(options: WatcherOptions): void {
  watcherGeneration += 1;
  const generation = watcherGeneration;
  const {
    inboxDir,
    onError,
    onReady,
    restartDelayMs = WATCHER_RESTART_DELAY_MS,
    watcherFactory = chokidar.watch.bind(chokidar),
  } = options;

  logger.info("Watcher: starting", { inboxDir });

  guard = new FileStabilityGuard();

  guard.on("stable", (filePath: string) => {
    const task = handleStableFile(filePath, inboxDir);
    activeStableTasks.add(task);
    void task
      .catch((error) => {
        logger.error("Watcher: stable-file processing failed recoverably", {
          filePath,
          error: String(error),
        });
        scheduleFileAccessRetry(filePath);
      })
      .finally(() => activeStableTasks.delete(task));
  });

  guard.on("gone", (filePath: string) => {
    logger.warn("Watcher: file disappeared before stability confirmed", {
      filePath,
    });
  });

  recoverStagedFiles(inboxDir, restartDelayMs);

  const openWatcher = () => {
    if (generation !== watcherGeneration) return;
    const openedWatcher = watcherFactory(inboxDir, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: false, // we do our own stability polling
      usePolling: false,
      depth: 0, // Inbox only, no subdirectories
      ignored: (filePath: string) => {
        const base = path.basename(filePath);
        // Ignore hidden files, temp files, and non-target extensions
        if (base.startsWith(".")) return true;
        if (base.endsWith(".tmp") || base.endsWith(".crdownload")) return true;
        const ext = path.extname(base).toLowerCase();
        // Allow directory entries through (chokidar needs them)
        if (ext === "") return false;
        return !WATCHED_EXTENSIONS.has(ext);
      },
    });

    watcher = openedWatcher;
    openedWatcher.on("add", (filePath) => {
      logger.info("Watcher: file detected (add)", { filePath });
      guard?.watch(filePath);
    });

    openedWatcher.on("change", (filePath) => {
      logger.info("Watcher: file changed", { filePath });
      guard?.watch(filePath);
    });

    openedWatcher.on("error", (err) => {
      if (watcher !== openedWatcher) {
        logger.info("Watcher: ignored error from superseded watcher");
        return;
      }
      logger.error("Watcher: chokidar error", { error: String(err) });
      onError?.(err instanceof Error ? err : new Error(String(err)));
      const failedWatcher = openedWatcher;
      watcher = null;
      void failedWatcher?.close().catch(() => undefined);
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        logger.info("Watcher: restarting after recoverable error", {
          inboxDir,
        });
        openWatcher();
      }, restartDelayMs);
    });

    openedWatcher.on("ready", () => {
      if (watcher !== openedWatcher) return;
      logger.info("Watcher: ready — monitoring inbox", { inboxDir });
      onReady?.();
    });
  };
  openWatcher();
}

async function handleStableFile(
  filePath: string,
  inboxDir: string,
): Promise<void> {
  logger.info("Watcher: file stable, enqueuing", { filePath });

  let stagedPath: string;
  try {
    stagedPath = stageFileForUpload(filePath, inboxDir);
  } catch (err) {
    logger.error("Watcher: cannot claim stable file", {
      filePath,
      error: String(err),
    });
    scheduleFileAccessRetry(filePath);
    return;
  }

  await enqueueClaimedFile(stagedPath, WATCHER_RESTART_DELAY_MS);
}

async function enqueueClaimedFile(
  stagedPath: string,
  retryDelayMs: number,
): Promise<void> {
  let buffer: Buffer;
  let mtime: Date;
  try {
    buffer = fs.readFileSync(stagedPath);
    mtime = fs.statSync(stagedPath).mtime;
  } catch (error) {
    logger.error("Watcher: cannot snapshot claimed file", {
      stagedPath,
      error: String(error),
    });
    scheduleClaimedFileRetry(stagedPath, retryDelayMs);
    return;
  }

  const sha256 = computeSha256(buffer);
  const capturedAt = mtime.toISOString();
  // Persist to queue first so file survives a crash before upload completes
  const queueId = enqueue(stagedPath, sha256, capturedAt);

  // Then attempt an immediate upload (retryScheduler will pick it up on failure)
  await attemptImmediateUpload(stagedPath, sha256, capturedAt, queueId);
}

/**
 * Preserve the exact stable payload under Inbox until the server accepts it.
 * Scanner software may reuse the same visible filename for the next scan.
 */
export function stageFileForUpload(
  sourcePath: string,
  inboxDir: string,
): string {
  const stagingDir = path.join(inboxDir, ".presentail-queue", randomUUID());
  const stagedPath = path.join(stagingDir, path.basename(sourcePath));
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.renameSync(sourcePath, stagedPath);
  logger.info("Watcher: stable payload claimed for durable upload", {
    sourcePath,
    stagedPath,
  });
  return stagedPath;
}

function recoverStagedFiles(inboxDir: string, retryDelayMs: number): void {
  const stagingRoot = path.join(inboxDir, ".presentail-queue");
  let directories: fs.Dirent[];
  try {
    directories = fs.readdirSync(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Watcher: staged-file recovery could not read staging root", {
        stagingRoot,
        error: String(error),
      });
      scheduleStagingRecovery(inboxDir, retryDelayMs);
    }
    return;
  }

  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const claimedDir = path.join(stagingRoot, directory.name);
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(claimedDir, { withFileTypes: true });
    } catch (error) {
      logger.warn("Watcher: staged-file recovery could not read claim", {
        claimedDir,
        error: String(error),
      });
      scheduleStagingRecovery(inboxDir, retryDelayMs);
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) continue;
      const stagedPath = path.join(claimedDir, file.name);
      trackClaimedFileTask(stagedPath, retryDelayMs);
    }
  }
}

function scheduleStagingRecovery(inboxDir: string, retryDelayMs: number): void {
  const timer = setTimeout(() => {
    fileAccessRetryTimers.delete(timer);
    logger.info("Watcher: retrying staged-file directory recovery", {
      inboxDir,
    });
    recoverStagedFiles(inboxDir, retryDelayMs);
  }, retryDelayMs);
  fileAccessRetryTimers.add(timer);
}

function trackClaimedFileTask(stagedPath: string, retryDelayMs: number): void {
  const task = enqueueClaimedFile(stagedPath, retryDelayMs);
  activeStableTasks.add(task);
  void task
    .catch((error) => {
      logger.error("Watcher: staged-file recovery failed", {
        stagedPath,
        error: String(error),
      });
      scheduleClaimedFileRetry(stagedPath, retryDelayMs);
    })
    .finally(() => activeStableTasks.delete(task));
}

function scheduleClaimedFileRetry(
  stagedPath: string,
  retryDelayMs: number,
): void {
  const timer = setTimeout(() => {
    fileAccessRetryTimers.delete(timer);
    if (fs.existsSync(stagedPath)) {
      logger.info("Watcher: retrying claimed file access", { stagedPath });
      trackClaimedFileTask(stagedPath, retryDelayMs);
    }
  }, retryDelayMs);
  fileAccessRetryTimers.add(timer);
}

function scheduleFileAccessRetry(filePath: string): void {
  const timer = setTimeout(() => {
    fileAccessRetryTimers.delete(timer);
    if (fs.existsSync(filePath)) {
      logger.info("Watcher: retrying file access", { filePath });
      guard?.watch(filePath);
    }
  }, WATCHER_RESTART_DELAY_MS);
  fileAccessRetryTimers.add(timer);
}

/**
 * Stop the file watcher and stability guard.
 */
export async function stopWatcher(): Promise<void> {
  watcherGeneration += 1;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  for (const timer of fileAccessRetryTimers) clearTimeout(timer);
  fileAccessRetryTimers.clear();
  const activeWatcher = watcher;
  watcher = null;
  guard?.destroy();
  guard = null;
  if (activeWatcher) {
    await activeWatcher.close().catch(() => undefined);
  }
  if (activeStableTasks.size > 0) {
    await Promise.all([...activeStableTasks]);
  }
  logger.info("Watcher: stopped");
}
