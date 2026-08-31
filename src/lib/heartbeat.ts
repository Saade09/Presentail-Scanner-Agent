import axios from "axios";
import { getCount } from "./queue.js";
import { logger } from "./logger.js";
import type { TrayStateCallback } from "./retryScheduler.js";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

interface HeartbeatOptions {
  serverUrl: string;
  token: string;
  agentVersion: string;
  onStateChange: TrayStateCallback;
  onCredentialRevoked: () => void;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatOpts: HeartbeatOptions | null = null;

/**
 * Start the 2-minute heartbeat loop.
 */
export function startHeartbeat(options: HeartbeatOptions): void {
  heartbeatOpts = options;
  if (heartbeatTimer) return;

  // Send one immediately on start
  void sendHeartbeat();

  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  logger.info("Heartbeat: started");
}

/**
 * Stop the heartbeat loop.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  logger.info("Heartbeat: stopped");
}

async function sendHeartbeat(): Promise<void> {
  if (!heartbeatOpts) return;
  const { serverUrl, token, agentVersion, onStateChange, onCredentialRevoked } = heartbeatOpts;

  const queuedCount = getCount();

  try {
    const response = await axios.patch(
      `${serverUrl.replace(/\/$/, "")}/api/scanner/heartbeat`,
      { agent_version: agentVersion, queued_count: queuedCount },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Agent-Version": agentVersion,
        },
        timeout: 15_000,
        validateStatus: () => true,
      }
    );

    logger.info("Heartbeat: sent", {
      statusCode: response.status,
      queuedCount,
    });

    if (response.status === 401) {
      logger.error("Heartbeat: credential revoked (401)");
      onCredentialRevoked();
      return;
    }

    if (response.status >= 200 && response.status < 300) {
      // Update tray state from heartbeat response
      onStateChange(queuedCount > 0 ? "offline" : "connected");
    } else {
      onStateChange("offline");
    }
  } catch (err) {
    logger.warn("Heartbeat: network error", { error: String(err) });
    onStateChange("offline");
  }
}
