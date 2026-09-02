const test = require("node:test");
const assert = require("node:assert/strict");
const { ServiceStateGate } = require("../dist/lib/serviceStateGate.js");

test("watcher error cannot be overwritten by later heartbeat or upload states", () => {
  const states = [];
  const gate = new ServiceStateGate((state) => states.push(state));

  gate.markReady("connected");
  gate.markInboxError();
  gate.publish("connected");
  gate.publish("uploading");

  assert.deepEqual(states, ["connected", "inbox-error"]);
});

test("a replacement watcher must become ready before service states resume", () => {
  const states = [];
  const gate = new ServiceStateGate((state) => states.push(state));

  gate.markInboxError();
  gate.reset();
  gate.publish("connected");
  gate.markReady("offline");
  gate.publish("connected");

  assert.deepEqual(states, ["inbox-error", "offline", "connected"]);
});