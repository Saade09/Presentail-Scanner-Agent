import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import Database from "better-sqlite3";
import { logger } from "./logger.js";

const DB_DIR = path.join(
  process.env.APPDATA || os.homedir(),
  "PresentailScannerAgent"
);
const DB_PATH = path.join(DB_DIR, "queue.db");

export interface PendingUpload {
  id: number;
  file_path: string;
  sha256: string;
  captured_at: string;
  attempt_count: number;
  next_retry_at: number; // Unix timestamp ms
  created_at: number;   // Unix timestamp ms
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_uploads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path     TEXT    NOT NULL,
      sha256        TEXT    NOT NULL,
      captured_at   TEXT    NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_next_retry ON pending_uploads (next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_sha256     ON pending_uploads (sha256);
  `);

  logger.info("Queue database initialised", { path: DB_PATH });
  return db;
}

/**
 * Add a file to the persistent upload queue.
 * Idempotent: if the sha256 is already queued, updates the file path.
 */
export function enqueue(
  filePath: string,
  sha256: string,
  capturedAt: string
): number {
  const database = getDb();
  const now = Date.now();

  const existing = database
    .prepare<[string], { id: number }>(
      "SELECT id FROM pending_uploads WHERE sha256 = ?"
    )
    .get(sha256);

  if (existing) {
    database
      .prepare(
        "UPDATE pending_uploads SET file_path = ?, next_retry_at = 0, attempt_count = 0 WHERE id = ?"
      )
      .run(filePath, existing.id);
    logger.info("Queue: updated existing entry", { sha256: sha256.slice(0, 8) });
    return existing.id;
  }

  const result = database
    .prepare(
      `INSERT INTO pending_uploads (file_path, sha256, captured_at, attempt_count, next_retry_at, created_at)
       VALUES (?, ?, ?, 0, 0, ?)`
    )
    .run(filePath, sha256, capturedAt, now);

  const id = Number(result.lastInsertRowid);
  logger.info("Queue: enqueued file", { id, sha256: sha256.slice(0, 8) });
  return id;
}

/**
 * Return all entries whose next_retry_at is <= now.
 */
export function dequeueDue(): PendingUpload[] {
  return getDb()
    .prepare<[number], PendingUpload>(
      "SELECT * FROM pending_uploads WHERE next_retry_at <= ? ORDER BY created_at ASC"
    )
    .all(Date.now());
}

/**
 * Remove a successfully uploaded entry.
 */
export function markDone(id: number): void {
  getDb().prepare("DELETE FROM pending_uploads WHERE id = ?").run(id);
  logger.info("Queue: entry marked done", { id });
}

/**
 * Schedule a retry with exponential back-off.
 * Initial: 5 s, doubles each attempt, cap at 5 min.
 */
export function scheduleRetry(id: number, attemptCount: number): void {
  const INITIAL_MS = 5_000;
  const MAX_MS = 5 * 60 * 1000;
  const delayMs = Math.min(INITIAL_MS * Math.pow(2, attemptCount), MAX_MS);
  const nextRetryAt = Date.now() + delayMs;

  getDb()
    .prepare(
      "UPDATE pending_uploads SET attempt_count = ?, next_retry_at = ? WHERE id = ?"
    )
    .run(attemptCount + 1, nextRetryAt, id);

  logger.info("Queue: scheduled retry", {
    id,
    attempt: attemptCount + 1,
    delayMs,
  });
}

/**
 * Get total count of pending entries.
 */
export function getCount(): number {
  const row = getDb()
    .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM pending_uploads")
    .get();
  return row?.count ?? 0;
}

/**
 * Close the database connection (for clean shutdown).
 */
export function closeQueue(): void {
  if (db) {
    db.close();
    db = null;
  }
}
