const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const chokidar = require("chokidar");
const queueRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-upload-queue-"));
process.env.APPDATA = queueRoot;

const uploader = require("../dist/lib/uploader.js");
const { ensureScannerDirs } = require("../dist/lib/fileOps.js");
const { closeQueue } = require("../dist/lib/queue.js");
const {
  attemptImmediateUpload,
  startRetryScheduler,
  stopRetryScheduler,
} = require("../dist/lib/retryScheduler.js");
const { startWatcher, stopWatcher } = require("../dist/lib/watcher.js");

const windowsSafeWatcherFactory =
  process.platform === "win32"
    ? (watchPath, options) =>
        chokidar.watch(watchPath, {
          ...options,
          usePolling: true,
          interval: 50,
        })
    : undefined;

async function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for scanner file movement");
}

test.after(() => {
  closeQueue();
  fs.rmSync(queueRoot, { recursive: true, force: true });
});

test("watcher uploads an extensionless custom-inbox scan to its sibling Uploaded folder", async () => {
  const originalUploadFile = uploader.uploadFile;
  uploader.uploadFile = async () => ({ kind: "success", importId: 123 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-upload-custom-"));
  const dirs = ensureScannerDirs(path.join(root, "INBOX"));
  const scanPath = path.join(dirs.inbox, "hp-test");

  try {
    startRetryScheduler({
      serverUrl: "https://os.example.test",
      token: "not-a-real-token",
      agentVersion: "1.0.4",
      inboxDir: dirs.inbox,
      uploadedDir: dirs.uploaded,
      failedDir: dirs.failed,
      onStateChange: () => undefined,
      onCredentialRevoked: () => undefined,
      onStationDisabled: () => undefined,
      onConfigurationRequired: () => undefined,
    });

    await new Promise((resolve, reject) => {
      startWatcher({
        inboxDir: dirs.inbox,
        onReady: resolve,
        onError: reject,
        watcherFactory: windowsSafeWatcherFactory,
      });
    });
    fs.writeFileSync(scanPath, "%PDF HP test");

    await waitFor(() => fs.readdirSync(dirs.uploaded).length === 1);
    assert.equal(fs.existsSync(scanPath), false);
    const uploadedFiles = fs.readdirSync(dirs.uploaded);
    assert.equal(uploadedFiles.length, 1);
    assert.match(uploadedFiles[0], /_hp-test$/);
  } finally {
    uploader.uploadFile = originalUploadFile;
    await stopWatcher();
    await stopRetryScheduler();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("permanent upload rejection moves a custom-inbox scan to Failed with diagnostics", async () => {
  const originalUploadFile = uploader.uploadFile;
  uploader.uploadFile = async () => ({
    kind: "permanent",
    statusCode: 400,
    reason: "Unsupported file type",
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-upload-failed-"));
  const dirs = ensureScannerDirs(path.join(root, "INBOX"));
  const scanPath = path.join(dirs.inbox, "unsupported-scan");
  fs.writeFileSync(scanPath, "not an invoice");

  try {
    startRetryScheduler({
      serverUrl: "https://os.example.test",
      token: "not-a-real-token",
      agentVersion: "1.0.4",
      inboxDir: dirs.inbox,
      uploadedDir: dirs.uploaded,
      failedDir: dirs.failed,
      onStateChange: () => undefined,
      onCredentialRevoked: () => undefined,
      onStationDisabled: () => undefined,
      onConfigurationRequired: () => undefined,
    });

    await attemptImmediateUpload(scanPath, "b".repeat(64), new Date().toISOString());
    assert.equal(fs.existsSync(scanPath), false);
    const failedFiles = fs.readdirSync(dirs.failed);
    const failedScan = failedFiles.find((name) => /_unsupported-scan$/.test(name));
    assert.ok(failedScan);
    const diagnostic = JSON.parse(
      fs.readFileSync(path.join(dirs.failed, `${failedScan}.error.json`), "utf8"),
    );
    assert.equal(diagnostic.statusCode, 400);
    assert.equal(diagnostic.reason, "Unsupported file type");
  } finally {
    uploader.uploadFile = originalUploadFile;
    await stopRetryScheduler();
    fs.rmSync(root, { recursive: true, force: true });
  }
});