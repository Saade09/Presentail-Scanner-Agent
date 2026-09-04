const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const queueRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "scanner-heartbeat-queue-"),
);
process.env.APPDATA = queueRoot;
const axios = require("axios");
const queue = require("../dist/lib/queue.js");
const {
  startHeartbeat,
  stopHeartbeat,
  triggerHeartbeat,
} = require("../dist/lib/heartbeat.js");

function deferredResponse() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test.after(() => {
  queue.closeQueue();
  fs.rmSync(queueRoot, { recursive: true, force: true });
});

test("drains every old heartbeat and ignores late 401 callbacks", async () => {
  const originalPatch = axios.patch;
  const requests = [];
  axios.patch = (_url, body) => {
    const request = deferredResponse();
    request.body = body;
    requests.push(request);
    return request.promise;
  };

  let oldRevocations = 0;
  let newConnected = 0;
  const base = {
    serverUrl: "https://os.example.test",
    token: "not-a-real-token",
    agentVersion: "1.0.4",
    onStationDisabled: () => undefined,
    onConfigurationRequired: () => undefined,
  };

  try {
    const queuedId = queue.enqueue(
      path.join(queueRoot, "pending-scan.pdf"),
      "d".repeat(64),
      new Date().toISOString(),
    );
    startHeartbeat({
      ...base,
      onStateChange: () => undefined,
      onCredentialRevoked: () => {
        oldRevocations += 1;
      },
    });
    triggerHeartbeat();
    assert.equal(requests.length, 2);

    let stopped = false;
    const stopping = stopHeartbeat().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);

    requests[0].resolve({ status: 401 });
    await Promise.resolve();
    assert.equal(stopped, false);
    requests[1].resolve({ status: 401 });
    await stopping;
    assert.equal(oldRevocations, 0);

    startHeartbeat({
      ...base,
      token: "new-not-a-real-token",
      onStateChange: (state) => {
        if (state === "connected") newConnected += 1;
      },
      onCredentialRevoked: () => {
        throw new Error("new credential should not be revoked");
      },
    });
    assert.equal(requests.length, 3);
    assert.equal(requests[2].body.queued_count, 1);
    requests[2].resolve({ status: 200 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(newConnected, 1);
    assert.equal(queue.getCount(), 1);
    queue.markDone(queuedId);
    await stopHeartbeat();
  } finally {
    axios.patch = originalPatch;
    await stopHeartbeat();
  }
});
