const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
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

test("drains every old heartbeat and ignores late 401 callbacks", async () => {
  const originalPatch = axios.patch;
  const requests = [];
  axios.patch = () => {
    const request = deferredResponse();
    requests.push(request);
    return request.promise;
  };

  let oldRevocations = 0;
  let newConnected = 0;
  const base = {
    serverUrl: "https://os.example.test",
    token: "not-a-real-token",
    agentVersion: "1.0.3",
    onStationDisabled: () => undefined,
    onConfigurationRequired: () => undefined,
  };

  try {
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
    requests[2].resolve({ status: 200 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(newConnected, 1);
    await stopHeartbeat();
  } finally {
    axios.patch = originalPatch;
    await stopHeartbeat();
  }
});