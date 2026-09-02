import * as path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { FileStabilityGuard } from "./stability.js";
import { computeSha256 } from "./uploader.js";
import { enqueue } from "./queue.js";
import { attemptImmediateUpload } from "./retryScheduler.js";
import { logger } from "./logger.js";
import * as fs from "fs";

const WATCHED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

export interface WatcherOptions {
  inboxDir: string;
  onError?: (error: Error) => void;
  onReady?: () => void;
}

let watcher: FSWatcher | null = null;
let guard: FileStabilityGuard | null = null;
const activeStableTasks = new Set<Promise<void>>();

/**
 * Start watching the Inbox directory.
 * Files detected via add/change are tracked by the stability guard;
 * once stable, they are hashed, enqueued, and an immediate upload is attempted.
 */
export function startWatcher(options: WatcherOptions): void {
  const { inboxDir, onError, onReady } = options;

  logger.info("Watcher: starting", { inboxDir });

  guard = new FileStabilityGuard();

  guard.on("stable", (filePath: string) => {
    const task = handleStableFile(filePath);
    activeStableTasks.add(task);
    void task.finally(() => activeStableTasks.delete(task));
  });

  guard.on("gone", (filePath: string) => {
    logger.warn("Watcher: file disappeared before stability confirmed", { filePath });
  });

  watcher = chokidar.watch(inboxDir, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: false,        // we do our own stability polling
    usePolling: false,
    depth: 0,                        // Inbox only, no subdirectories
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

  watcher.on("add", (filePath) => {
    logger.info("Watcher: file detected (add)", { filePath });
    guard?.watch(filePath);
  });

  watcher.on("change", (filePath) => {
    logger.info("Watcher: file changed", { filePath });
    guard?.watch(filePath);
  });

  watcher.on("error", (err) => {
    logger.error("Watcher: chokidar error", { error: String(err) });
    onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  watcher.on("ready", () => {
    logger.info("Watcher: ready — monitoring inbox", { inboxDir });
    onReady?.();
  });
}

async function handleStableFile(filePath: string): Promise<void> {
  logger.info("Watcher: file stable, enqueuing", { filePath });

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    logger.error("Watcher: cannot read stable file", {
      filePath,
      error: String(err),
    });
    return;
  }

  const sha256     = computeSha256(buffer);
  const mtime      = fs.statSync(filePath).mtime;
  const capturedAt = mtime.toISOString();

  // Persist to queue first so file survives a crash before upload completes
  enqueue(filePath, sha256, capturedAt);

  // Then attempt an immediate upload (retryScheduler will pick it up on failure)
  await attemptImmediateUpload(filePath, sha256, capturedAt);
}

/**
 * Stop the file watcher and stability guard.
 */
export async function stopWatcher(): Promise<void> {
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
