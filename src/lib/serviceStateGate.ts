import type { TrayState } from "./retryScheduler.js";

/**
 * Prevent heartbeat and upload callbacks from reporting Connected after the
 * inbox watcher has failed. A new watcher must explicitly become ready before
 * normal service states can reach the tray again.
 */
export class ServiceStateGate {
  private inboxReady = false;

  constructor(private readonly emit: (state: TrayState) => void) {}

  reset(): void {
    this.inboxReady = false;
  }

  markReady(initialState?: TrayState): void {
    this.inboxReady = true;
    if (initialState) this.emit(initialState);
  }

  markInboxError(): void {
    this.inboxReady = false;
    this.emit("inbox-error");
  }

  publish(state: TrayState): void {
    if (!this.inboxReady && state !== "inbox-error") return;
    this.emit(state);
  }
}