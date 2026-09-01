import axios from "axios";
import { getCount } from "./queue.js";
import { logger } from "./logger.js";
import type { TrayStateCallback } from "./retryScheduler.js";
import { classifyScannerResponse } from "./connectionStatus.js";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export interface HeartbeatOptions {
  serverUrl: string;
  token: string;
  agentVersion: string;
  onStateChange: TrayStateCallback;
  onCredentialRevoked: () => void;
  onStationDisabled?: () => void;
  onConfigurationRequired?: () => void;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatOpts: HeartbeatOptions | null = null;
let heartbeatGeneration = 0;
const activeHeartbeatRequests = new Set<Promise<HeartbeatResult>>();

export interface HeartbeatResult {
  kind: ReturnType<typeof classifyScannerResponse> | "network-error";
  statusCode: number | null;
  queuedCount: number;
  station?: {
    id: number;
    name: string;
    defaultEntityId: number;
    defaultEntityName: string;
    location: string | null;
  };
  correlationId?: string;
}

/**
 * Start the 2-minute heartbeat loop.
 */
export function startHeartbeat(options: HeartbeatOptions): void {
  heartbeatGeneration += 1;
  heartbeatOpts = options;
  if (heartbeatTimer) return;

  // Send one immediately on start
  beginHeartbeat();

  heartbeatTimer = setInterval(() => {
    beginHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  logger.info("Heartbeat: started");
}

/**
 * Stop the heartbeat loop.
 */
export async function stopHeartbeat(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  heartbeatGeneration += 1;
  heartbeatOpts = null;
  await Promise.all([...activeHeartbeatRequests]);
  logger.info("Heartbeat: stopped");
}

function beginHeartbeat(): void {
  if (!heartbeatOpts) return;
  const options = heartbeatOpts;
  const generation = heartbeatGeneration;
  const request = sendHeartbeat(options, generation, true);
  activeHeartbeatRequests.add(request);
  void request.finally(() => {
    activeHeartbeatRequests.delete(request);
  });
}

/** Trigger an on-demand heartbeat using the active pairing generation. */
export function triggerHeartbeat(): void {
  beginHeartbeat();
}

export async function sendImmediateHeartbeat(
  options: HeartbeatOptions,
  correlationId: string,
): Promise<HeartbeatResult> {
  const generation = heartbeatGeneration;
  const request = sendHeartbeat(options, generation, false, correlationId);
  activeHeartbeatRequests.add(request);
  try {
    return await request;
  } finally {
    activeHeartbeatRequests.delete(request);
  }
}

async function sendHeartbeat(
  options: HeartbeatOptions,
  generation: number,
  applyCallbacks: boolean,
  correlationId?: string,
): Promise<HeartbeatResult> {
  const {
    serverUrl,
    token,
    agentVersion,
    onStateChange,
    onCredentialRevoked,
    onStationDisabled,
    onConfigurationRequired,
  } = options;

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
          ...(correlationId ? { "X-Correlation-ID": correlationId } : {}),
        },
        timeout: 15_000,
        validateStatus: () => true,
      }
    );

    logger.info("Heartbeat: sent", {
      statusCode: response.status,
      queuedCount,
      correlationId: correlationId ?? null,
    });

    const responseKind = classifyScannerResponse(response.status);
    const responseData = response.data as
      | {
          station_id?: number;
          correlation_id?: string;
          station?: {
            id?: number;
            name?: string;
            default_entity_id?: number;
            default_entity_name?: string;
            location?: string | null;
          };
        }
      | undefined;
    const station =
      Number.isInteger(responseData?.station?.id) &&
      typeof responseData?.station?.name === "string" &&
      Number.isInteger(responseData?.station?.default_entity_id) &&
      typeof responseData?.station?.default_entity_name === "string"
        ? {
            id: responseData.station.id as number,
            name: responseData.station.name,
            defaultEntityId: responseData.station.default_entity_id as number,
            defaultEntityName: responseData.station.default_entity_name,
            location: responseData.station.location ?? null,
          }
        : undefined;
    const result = {
      kind: responseKind,
      statusCode: response.status,
      queuedCount,
      station,
      correlationId: responseData?.correlation_id,
    } satisfies HeartbeatResult;

    if (!applyCallbacks || generation !== heartbeatGeneration) return result;

    if (responseKind === "credential-revoked") {
      logger.error("Heartbeat: credential revoked (401)");
      onCredentialRevoked();
      return result;
    }

    if (responseKind === "station-disabled") {
      logger.error("Heartbeat: station disabled (403)");
      if (onStationDisabled) onStationDisabled();
      else onStateChange("disabled");
      return result;
    }

    if (responseKind === "configuration-required") {
      logger.error("Heartbeat: station configuration required (409)");
      if (onConfigurationRequired) onConfigurationRequired();
      else onStateChange("configuration");
      return result;
    }

    if (responseKind === "success") {
      // Update tray state from heartbeat response
      onStateChange(queuedCount > 0 ? "offline" : "connected");
    } else {
      onStateChange("offline");
    }
    return result;
  } catch (err) {
    logger.warn("Heartbeat: network error", { error: String(err) });
    if (applyCallbacks && generation === heartbeatGeneration) {
      onStateChange("offline");
    }
    return { kind: "network-error", statusCode: null, queuedCount };
  }
}
