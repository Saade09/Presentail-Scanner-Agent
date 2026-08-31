import { logger } from "./logger.js";

const SERVICE_NAME = "PresentailScannerAgent";
const ACCOUNT_NAME = "device-token";

let keytarModule: typeof import("keytar") | null = null;

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
