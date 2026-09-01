import { logger } from "./logger.js";

const SERVICE_NAME = "PresentailScannerAgent";
const ACCOUNT_NAME = "device-token";
const PAIRING_RECORD_ACCOUNT = "pairing-record-v1";
const PAIRING_STATE_ACCOUNTS = [
  PAIRING_RECORD_ACCOUNT,
  ACCOUNT_NAME,
  "server-url",
  "station-name",
  "entity-name",
] as const;

let keytarModule: typeof import("keytar") | null = null;

export interface PairingRecord {
  schemaVersion: 1;
  serverUrl: string;
  token: string;
  station: {
    id: number;
    name: string;
    defaultEntityId: number;
    defaultEntityName: string;
    location: string | null;
  };
  credential: {
    tokenType: "Bearer";
    issuedAt: string;
    expiresAt: string | null;
  };
  correlationId: string;
}

export interface LegacyPairingRecord {
  serverUrl: string;
  token: string;
  stationName: string;
  entityName: string;
}

function isPairingRecord(value: unknown): value is PairingRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PairingRecord>;
  return (
    record.schemaVersion === 1 &&
    typeof record.serverUrl === "string" &&
    record.serverUrl.length > 0 &&
    typeof record.token === "string" &&
    record.token.length > 0 &&
    typeof record.correlationId === "string" &&
    Boolean(record.station) &&
    Number.isInteger(record.station?.id) &&
    typeof record.station?.name === "string" &&
    Number.isInteger(record.station?.defaultEntityId) &&
    typeof record.station?.defaultEntityName === "string" &&
    record.credential?.tokenType === "Bearer" &&
    typeof record.credential?.issuedAt === "string" &&
    (record.credential?.expiresAt === null ||
      typeof record.credential?.expiresAt === "string")
  );
}

async function getKeytar(): Promise<typeof import("keytar") | null> {
  if (keytarModule !== null) return keytarModule;
  try {
    keytarModule = await import("keytar");
    return keytarModule;
  } catch (err) {
    logger.warn("keytar not available — credential store disabled", {
      error: String(err),
    });
    return null;
  }
}

/**
 * Save the device bearer token to Windows Credential Manager.
 * Refuses to store in plaintext if keytar is unavailable.
 */
export async function saveCredential(token: string): Promise<boolean> {
  const keytar = await getKeytar();
  if (!keytar) {
    logger.error(
      "Cannot save credential: Windows Credential Manager (keytar) is unavailable"
    );
    return false;
  }
  try {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
    logger.info("Credential saved to Windows Credential Manager");
    return true;
  } catch (err) {
    logger.error("Failed to save credential to Windows Credential Manager", {
      error: String(err),
    });
    return false;
  }
}

/**
 * Persist the complete pairing as one Windows Credential Manager secret and
 * immediately read it back. A caller may only activate services after this
 * returns the verified record.
 */
export async function saveAndVerifyPairingRecord(
  record: PairingRecord,
): Promise<PairingRecord | null> {
  const keytar = await getKeytar();
  if (!keytar) {
    logger.error("Cannot save pairing record: keytar unavailable");
    return null;
  }

  try {
    await keytar.setPassword(
      SERVICE_NAME,
      PAIRING_RECORD_ACCOUNT,
      JSON.stringify(record),
    );
    const verified = await loadPairingRecord();
    if (
      !verified ||
      verified.station.id !== record.station.id ||
      verified.token !== record.token ||
      verified.serverUrl !== record.serverUrl
    ) {
      logger.error("Pairing record readback verification failed", {
        expectedStationId: record.station.id,
        actualStationId: verified?.station.id ?? null,
        credentialExists: Boolean(verified?.token),
      });
      await keytar.deletePassword(SERVICE_NAME, PAIRING_RECORD_ACCOUNT);
      return null;
    }
    logger.info("Pairing record saved and verified", {
      stationId: verified.station.id,
      credentialExists: true,
      correlationId: verified.correlationId,
    });
    return verified;
  } catch (err) {
    logger.error("Failed to save or verify pairing record", {
      error: String(err),
      stationId: record.station.id,
    });
    try {
      await keytar.deletePassword(SERVICE_NAME, PAIRING_RECORD_ACCOUNT);
    } catch {
      // Preserve the original storage error.
    }
    return null;
  }
}

export async function loadPairingRecord(): Promise<PairingRecord | null> {
  const keytar = await getKeytar();
  if (!keytar) return null;
  try {
    const serialized = await keytar.getPassword(
      SERVICE_NAME,
      PAIRING_RECORD_ACCOUNT,
    );
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!isPairingRecord(parsed)) {
      logger.error("Stored pairing record is incomplete or invalid");
      return null;
    }
    logger.info("Pairing record loaded", {
      stationId: parsed.station.id,
      credentialExists: true,
      correlationId: parsed.correlationId,
    });
    return parsed;
  } catch (err) {
    logger.error("Failed to load pairing record", { error: String(err) });
    return null;
  }
}

/**
 * Read the split 1.0.1 accounts without deleting them. They remain intact
 * until a complete v1 record has been saved and verified.
 */
export async function loadLegacyPairingRecord(): Promise<LegacyPairingRecord | null> {
  const keytar = await getKeytar();
  if (!keytar) return null;
  try {
    const [token, serverUrl, stationName, entityName] = await Promise.all([
      keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME),
      keytar.getPassword(SERVICE_NAME, "server-url"),
      keytar.getPassword(SERVICE_NAME, "station-name"),
      keytar.getPassword(SERVICE_NAME, "entity-name"),
    ]);
    if (!token || !serverUrl) return null;
    logger.info("Legacy pairing record loaded for verified migration", {
      credentialExists: true,
    });
    return {
      token,
      serverUrl,
      stationName: stationName || "Unknown Station",
      entityName: entityName || "",
    };
  } catch (err) {
    logger.error("Failed to load legacy pairing record", { error: String(err) });
    return null;
  }
}

export async function clearLegacyPairingState(): Promise<boolean> {
  const keytar = await getKeytar();
  if (!keytar) return false;
  try {
    for (const account of PAIRING_STATE_ACCOUNTS) {
      if (account === PAIRING_RECORD_ACCOUNT) continue;
      await keytar.deletePassword(SERVICE_NAME, account);
    }
    logger.info("Legacy split pairing accounts cleared after migration");
    return true;
  } catch (err) {
    logger.warn("Could not clear legacy pairing accounts after migration", {
      error: String(err),
    });
    return false;
  }
}

/**
 * Load the device bearer token from Windows Credential Manager.
 * Returns null if not found or on error.
 */
export async function loadCredential(): Promise<string | null> {
  const keytar = await getKeytar();
  if (!keytar) {
    logger.warn(
      "Cannot load credential: Windows Credential Manager (keytar) is unavailable"
    );
    return null;
  }
  try {
    const token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    return token;
  } catch (err) {
    logger.error("Failed to load credential from Windows Credential Manager", {
      error: String(err),
    });
    return null;
  }
}

/**
 * Clear the stored device token from Windows Credential Manager.
 */
export async function clearCredential(): Promise<void> {
  const keytar = await getKeytar();
  if (!keytar) {
    logger.warn("Cannot clear credential: keytar unavailable");
    return;
  }
  try {
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    logger.info("Credential cleared from Windows Credential Manager");
  } catch (err) {
    logger.error("Failed to clear credential from Windows Credential Manager", {
      error: String(err),
    });
  }
}

/**
 * Remove the complete local pairing record before a new credential is saved.
 *
 * Returning a result is intentional: re-pairing must not continue if Windows
 * Credential Manager could not remove the old record.
 */
export async function clearPairingState(): Promise<boolean> {
  const keytar = await getKeytar();
  if (!keytar) {
    logger.error("Cannot clear pairing state: keytar unavailable");
    return false;
  }

  try {
    for (const account of PAIRING_STATE_ACCOUNTS) {
      await keytar.deletePassword(SERVICE_NAME, account);
    }
    logger.info("Pairing state cleared from Windows Credential Manager");
    return true;
  } catch (err) {
    logger.error("Failed to clear pairing state from Windows Credential Manager", {
      error: String(err),
    });
    return false;
  }
}
