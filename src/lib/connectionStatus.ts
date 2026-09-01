export type ScannerResponseKind =
  | "success"
  | "credential-revoked"
  | "station-disabled"
  | "configuration-required"
  | "transient"
  | "permanent";

/**
 * Classify device-authenticated responses without inspecting or exposing
 * response bodies. The server's status code is the stable recovery contract.
 */
export function classifyScannerResponse(statusCode: number): ScannerResponseKind {
  if (statusCode >= 200 && statusCode < 300) return "success";
  if (statusCode === 401) return "credential-revoked";
  if (statusCode === 403) return "station-disabled";
  if (statusCode === 409) return "configuration-required";
  if (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  ) {
    return "transient";
  }
  return "permanent";
}