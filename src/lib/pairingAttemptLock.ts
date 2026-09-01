/**
 * Main-process single-flight guard for the complete pairing transaction.
 * Renderer button state is not a security or concurrency boundary.
 */
export class PairingAttemptLock {
  private locked = false;

  acquire(): (() => void) | null {
    if (this.locked) return null;
    this.locked = true;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.locked = false;
    };
  }
}