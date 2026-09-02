const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const uploader = require("../dist/lib/uploader.js");
const { ensureScannerDirs } = require("../dist/lib/fileOps.js");
const {
  attemptImmediateUpload,
  startRetryScheduler,
  stopRetryScheduler,
} = require("../dist/lib/retryScheduler.js");

test("successful upload moves a custom-inbox PDF to its sibling Uploaded folder", async () => {
  const originalUploadFile = uploader.uploadFile;
  uploader.uploadFile = async () => ({ kind: "success", importId: 123 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-upload-custom-"));
  const dirs = ensureScannerDirs(path.join(root, "INBOX"));
  const scanPath = path.join(dirs.inbox, "hp-test.pdf");
  fs.writeFileSync(scanPath, "%PDF HP test");

  try {
    startRetryScheduler({
      serverUrl: "https://os.example.test",
      token: "not-a-real-token",
      agentVersion: "1.0.3",
      inboxDir: dirs.inbox,
      uploadedDir: dirs.uploaded,
      failedDir: dirs.failed,
      onStateChange: () => undefined,
      onCredentialRevoked: () => undefined,
      onStationDisabled: () => undefined,
      onConfigurationRequired: () => undefined,
    });

    await attemptImmediateUpload(scanPath, "a".repeat(64), new Date().toISOString());
    assert.equal(fs.existsSync(scanPath), false);
    const uploadedFiles = fs.readdirSync(dirs.uploaded);
    assert.equal(uploadedFiles.length, 1);
    assert.match(uploadedFiles[0], /_hp-test\.pdf$/);
  } finally {
    uploader.uploadFile = originalUploadFile;
    await stopRetryScheduler();
    fs.rmSync(root, { recursive: true, force: true });
  }
});