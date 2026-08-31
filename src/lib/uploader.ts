import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import FormData from "form-data";
import axios, { AxiosError } from "axios";
import { logger } from "./logger.js";

export type UploadResultKind =
  | "success"       // 202 — accepted, newly imported
  | "duplicate"     // 200 duplicate:true — already imported
  | "recoverable"   // network/timeout/429/5xx — retry later
  | "permanent";    // 400/413/415/422/401 — move to Failed

export interface UploadResult {
  kind: UploadResultKind;
  statusCode?: number;
  importId?: number;
  reason?: string;
}

const RECOVERABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const PERMANENT_STATUS_CODES   = new Set([400, 401, 413, 415, 422]);

/**
 * Compute SHA-256 hex digest from a file buffer.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Upload a single scan file to Presentail OS.
 *
 * @param serverUrl   - Base URL of the Presentail OS server (no trailing slash)
 * @param token       - Bearer token from pairing
 * @param filePath    - Absolute path to the file to upload
 * @param agentVersion - Version string sent with every request
 */
export async function uploadFile(
  serverUrl: string,
  token: string,
  filePath: string,
  agentVersion: string
): Promise<UploadResult> {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    logger.error("Upload: cannot read file", { filePath, error: String(err) });
    return { kind: "permanent", reason: "Cannot read file: " + String(err) };
  }

  const sha256      = computeSha256(buffer);
  const mtime       = fs.statSync(filePath).mtime;
  const capturedAt  = mtime.toISOString();
  const origFilename = path.basename(filePath);

  logger.info("Upload: starting", {
    filePath,
    sha256: sha256.slice(0, 8),
    size: buffer.length,
  });

  const form = new FormData();
  form.append("file", buffer, {
    filename: origFilename,
    contentType: guessMimeType(origFilename),
  });
  form.append("captured_at", capturedAt);
  form.append("original_filename", origFilename);
  form.append("sha256", sha256);
  form.append("agent_version", agentVersion);

  try {
    const response = await axios.post(
      `${serverUrl.replace(/\/$/, "")}/api/scanner/upload`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
          "X-Agent-Version": agentVersion,
        },
        timeout: 60_000,
        // Do not throw on 4xx/5xx so we can inspect the status code
        validateStatus: () => true,
        maxBodyLength: 50 * 1024 * 1024,
        maxContentLength: 50 * 1024 * 1024,
      }
    );

    const status = response.status;
    // Log status code only — never log response body content
    logger.info("Upload: response received", {
      filePath,
      statusCode: status,
      sha256: sha256.slice(0, 8),
    });

    if (status === 202) {
      const importId = (response.data as Record<string, unknown>)?.import_id as number | undefined;
      return { kind: "success", statusCode: status, importId };
    }

    if (status === 200) {
      const data = response.data as Record<string, unknown>;
      if (data?.duplicate === true) {
        return { kind: "duplicate", statusCode: status, importId: data.import_id as number };
      }
      // Unexpected 200 without duplicate flag — treat as success
      return { kind: "success", statusCode: status };
    }

    if (RECOVERABLE_STATUS_CODES.has(status)) {
      return { kind: "recoverable", statusCode: status, reason: `HTTP ${status}` };
    }

    if (PERMANENT_STATUS_CODES.has(status)) {
      const reason = (response.data as Record<string, unknown>)?.error as string | undefined;
      return {
        kind: "permanent",
        statusCode: status,
        reason: reason ?? `HTTP ${status}`,
      };
    }

    // Unknown status — treat as recoverable to be safe
    return { kind: "recoverable", statusCode: status, reason: `Unexpected HTTP ${status}` };
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (
      axiosErr.code === "ECONNREFUSED" ||
      axiosErr.code === "ENOTFOUND" ||
      axiosErr.code === "ETIMEDOUT" ||
      axiosErr.code === "ECONNRESET" ||
      axiosErr.code === "ERR_NETWORK" ||
      axiosErr.message?.includes("timeout")
    ) {
      logger.warn("Upload: network error — will retry", {
        code: axiosErr.code,
        message: axiosErr.message,
      });
      return { kind: "recoverable", reason: axiosErr.code ?? axiosErr.message };
    }

    logger.error("Upload: unexpected error", { error: String(err) });
    return { kind: "recoverable", reason: String(err) };
  }
}

function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf":  return "application/pdf";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png":  return "image/png";
    default:     return "application/octet-stream";
  }
}
