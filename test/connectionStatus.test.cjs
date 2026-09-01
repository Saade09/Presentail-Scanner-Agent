const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyScannerResponse,
} = require("../dist/lib/connectionStatus.js");

test("classifies device responses into actionable recovery states", () => {
  assert.equal(classifyScannerResponse(204), "success");
  assert.equal(classifyScannerResponse(401), "credential-revoked");
  assert.equal(classifyScannerResponse(403), "station-disabled");
  assert.equal(classifyScannerResponse(409), "configuration-required");
  assert.equal(classifyScannerResponse(429), "transient");
  assert.equal(classifyScannerResponse(503), "transient");
  assert.equal(classifyScannerResponse(422), "permanent");
});