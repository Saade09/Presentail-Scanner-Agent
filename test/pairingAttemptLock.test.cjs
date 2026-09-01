const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PairingAttemptLock,
} = require("../dist/lib/pairingAttemptLock.js");

test("allows only one complete pairing transaction at a time", () => {
  const lock = new PairingAttemptLock();
  const releaseFirst = lock.acquire();

  assert.equal(typeof releaseFirst, "function");
  assert.equal(lock.acquire(), null);

  releaseFirst();
  const releaseNext = lock.acquire();
  assert.equal(typeof releaseNext, "function");
  releaseNext();
});