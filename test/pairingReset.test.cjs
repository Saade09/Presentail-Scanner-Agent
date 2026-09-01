const test = require("node:test");
const assert = require("node:assert/strict");
const { runPairingReset } = require("../dist/lib/pairingReset.js");

test("waits for every old service before clearing pairing state", async () => {
  const events = [];
  let releaseWatcher;
  const watcherStopped = new Promise((resolve) => {
    releaseWatcher = () => {
      events.push("watcher-stopped");
      resolve();
    };
  });

  const reset = runPairingReset({
    stopWatcher: () => watcherStopped,
    stopRetryScheduler: async () => {
      events.push("scheduler-stopped");
    },
    stopHeartbeat: async () => {
      events.push("heartbeat-stopped");
    },
    clearPairingState: async () => {
      events.push("credential-cleared");
      return true;
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, []);
  releaseWatcher();
  await Promise.resolve();
  assert.equal(events.includes("credential-cleared"), false);
  assert.equal(events.includes("scheduler-stopped"), true);
  assert.equal(events.includes("heartbeat-stopped"), true);
  assert.equal(await reset, true);
  assert.equal(events.at(-1), "credential-cleared");
});

test("a held watcher drain blocks cleanup and new credential eligibility", async () => {
  const events = [];
  let finishImmediateUpload;
  const immediateUpload = new Promise((resolve) => {
    finishImmediateUpload = resolve;
  });

  let prepared = false;
  const reset = runPairingReset({
    stopWatcher: () => immediateUpload,
    stopRetryScheduler: async () => {
      events.push("scheduler-stopped");
    },
    stopHeartbeat: async () => {
      events.push("heartbeat-stopped");
    },
    clearPairingState: async () => {
      events.push("credential-cleared");
      prepared = true;
      return true;
    },
  });

  await Promise.resolve();
  assert.equal(prepared, false);
  assert.deepEqual(events, []);

  finishImmediateUpload();
  assert.equal(await reset, true);
  assert.equal(prepared, true);
  assert.equal(events.at(-1), "credential-cleared");
});

test("does not report a usable reset when credential cleanup fails", async () => {
  const reset = await runPairingReset({
    stopWatcher: async () => undefined,
    stopRetryScheduler: async () => undefined,
    stopHeartbeat: async () => undefined,
    clearPairingState: async () => false,
  });

  assert.equal(reset, false);
});