import * as path from "path";
import * as os from "os";
import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const { combine, timestamp, json, printf } = format;

// Log directory: %APPDATA%\PresentailScannerAgent\logs\
const logDir = path.join(
  process.env.APPDATA || os.homedir(),
  "PresentailScannerAgent",
  "logs"
);

/**
 * Scrub sensitive fields from log metadata before writing.
 * Fields containing: token, authorization, content, text, raw
 */
const SENSITIVE_KEYS = /token|authorization|content|text|raw/i;

function scrubSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubSensitive(v, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(k)) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = scrubSensitive(v, depth + 1);
    }
  }
  return result;
}

const scrubFormat = format((info) => {
  const scrubbed = scrubSensitive(info) as typeof info;
  return scrubbed;
});

const logger = createLogger({
  level: "info",
  format: combine(
    scrubFormat(),
    timestamp(),
    json()
  ),
  transports: [
    new DailyRotateFile({
      dirname: logDir,
      filename: "scanner-agent-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      maxSize: "10m",
      zippedArchive: false,
      auditFile: path.join(logDir, ".log-audit.json"),
    }),
    // Also log to console during development
    ...(process.env.NODE_ENV !== "production"
      ? [
          new transports.Console({
            format: combine(
              timestamp(),
              printf(
                ({ timestamp: ts, level, message, ...meta }) =>
                  `${ts} [${level.toUpperCase()}] ${message}${
                    Object.keys(meta).length > 0
                      ? " " + JSON.stringify(meta)
                      : ""
                  }`
              )
            ),
          }),
        ]
      : []),
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      dirname: logDir,
      filename: "scanner-agent-exceptions-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      maxSize: "10m",
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      dirname: logDir,
      filename: "scanner-agent-rejections-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "14d",
      maxSize: "10m",
    }),
  ],
});

export { logger, logDir };
