export interface PairingResetSteps {
  stopWatcher: () => Promise<void> | void;
  stopRetryScheduler: () => Promise<void> | void;
  stopHeartbeat: () => Promise<void> | void;
  clearPairingState: () => Promise<boolean>;
}

/**
 * The credential cleanup is deliberately sequenced after every active service
 * has stopped, so no old request can race with a newly saved credential.
 */
export async function runPairingReset(
  steps: PairingResetSteps,
): Promise<boolean> {
  // First prevent and drain watcher callbacks, including immediate uploads
  // they already started. Only then stop the remaining request loops.
  await steps.stopWatcher();
  await Promise.all([
    steps.stopRetryScheduler(),
    steps.stopHeartbeat(),
  ]);
  return steps.clearPairingState();
}