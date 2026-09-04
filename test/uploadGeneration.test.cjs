const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const uploader = require("../dist/lib/uploader.js");
const {
  attemptImmediateUpload,
  startRetryScheduler,
  stopRetryScheduler,
} = require("../dist/lib/retryScheduler.js");

function deferredResult() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("drains overlapping old uploads and ignores their late 401 callbacks", async () => {
  const originalUploadFile = uploader.uploadFile;
  const uploads = [];
  uploader.uploadFile = () => {
    const upload = deferredResult();
    uploads.push(upload);
    return upload.promise;
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-generation-"));
  const first = path.join(dir, "first.pdf");
  const second = path.join(dir, "second.pdf");
  fs.writeFileSync(first, "%PDF first");
  fs.writeFileSync(second, "%PDF second");
  let revoked = 0;

  try {
    startRetryScheduler({
      serverUrl: "https://os.example.test",
      token: "old-not-a-real-token",
      agentVersion: "1.0.4",
      inboxDir: dir,
      uploadedDir: dir,
      failedDir: dir,
      onStateChange: () => undefined,
      onCredentialRevoked: () => {
        revoked += 1;
      },
      onStationDisabled: () => undefined,
      onConfigurationRequired: () => undefined,
    });

    const firstAttempt = attemptImmediateUpload(first, "a".repeat(64), new Date().toISOString());
    const secondAttempt = attemptImmediateUpload(second, "b".repeat(64), new Date().toISOString());
    assert.equal(uploads.length, 2);

    let stopped = false;
    const stopping = stopRetryScheduler().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);

    uploads[0].resolve({ kind: "permanent", statusCode: 401 });
    await Promise.resolve();
    assert.equal(stopped, false);
    uploads[1].resolve({ kind: "permanent", statusCode: 401 });

    await Promise.all([firstAttempt, secondAttempt, stopping]);
    assert.equal(revoked, 0);
  } finally {
    uploader.uploadFile = originalUploadFile;
    await stopRetryScheduler();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});