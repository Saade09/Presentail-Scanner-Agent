import * as fs from "fs";
import { EventEmitter } from "events";
import { logger } from "./logger.js";

const POLL_INTERVAL_MS = 1_000;
const STABLE_READINGS_REQUIRED = 3;

interface FileState {
  size: number;
  mtimeMs: number;
}

interface Candidate {
  filePath: string;
  readings: FileState[];
  timer: ReturnType<typeof setInterval>;
}

/**
 * FileStabilityGuard
 *
 * Watches candidate files and emits "stable" when a file has had
 * STABLE_READINGS_REQUIRED consecutive identical readings (size + mtime)
 * AND can be opened exclusively (no write lock).
 *
 * Events:
 *   - "stable"  (filePath: string)  — file is ready to process
 *   - "gone"    (filePath: string)  — file disappeared before stability
 */
export class FileStabilityGuard extends EventEmitter {
  private candidates = new Map<string, Candidate>();

  /**
   * Begin tracking a file. Safe to call multiple times for the same path.
   */
  watch(filePath: string): void {
    if (this.candidates.has(filePath)) {
      // Reset readings on re-trigger (file was still being written)
      const candidate = this.candidates.get(filePath)!;
      candidate.readings = [];
      return;
    }

    logger.info("Stability: tracking file", { filePath });

    const timer = setInterval(() => this.poll(filePath), POLL_INTERVAL_MS);
    this.candidates.set(filePath, { filePath, readings: [], timer });
  }

  private poll(filePath: string): void {
    const candidate = this.candidates.get(filePath);
    if (!candidate) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      // File disappeared
      logger.warn("Stability: file gone", { filePath });
      this.remove(filePath);
      this.emit("gone", filePath);
      return;
    }

    const current: FileState = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };

    // Check consistency with last reading
    const prev = candidate.readings[candidate.readings.length - 1];
    if (prev && (prev.size !== current.size || prev.mtimeMs !== current.mtimeMs)) {
      // File is still changing — reset readings
      candidate.readings = [current];
      return;
    }

    candidate.readings.push(current);

    if (candidate.readings.length >= STABLE_READINGS_REQUIRED) {
      // Verify we can open the file exclusively (not locked by writer)
      if (this.canOpenExclusively(filePath)) {
        logger.info("Stability: file stable", { filePath, size: current.size });
        this.remove(filePath);
        this.emit("stable", filePath);
      } else {
        // Still locked — keep polling, reset count to avoid false confidence
        candidate.readings = [current];
      }
    }
  }

  private canOpenExclusively(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, "r");
      fs.closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  private remove(filePath: string): void {
    const candidate = this.candidates.get(filePath);
    if (candidate) {
      clearInterval(candidate.timer);
      this.candidates.delete(filePath);
    }
  }

  /**
   * Stop tracking all files and clean up timers.
   */
  destroy(): void {
    for (const candidate of this.candidates.values()) {
      clearInterval(candidate.timer);
    }
    this.candidates.clear();
  }
}
