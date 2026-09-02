const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_INBOX_DIR,
  loadInboxDir,
  normalizeInboxDir,
  saveInboxDir,
} = require("../dist/lib/inboxSettings.js");
const {
  ensureScannerDirs,
  getScannerDirs,
  moveFile,
} = require("../dist/lib/fileOps.js");

test("existing installations without settings keep the standard inbox", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-settings-default-"));
  try {
    assert.equal(loadInboxDir(path.join(tempDir, "settings.json")), DEFAULT_INBOX_DIR);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("custom Windows inbox persists outside the credential store", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-settings-custom-"));
  const settingsPath = path.join(tempDir, "settings.json");
  const customInbox = "C:\\Users\\Presentail\\Desktop\\INBOX";
  try {
    saveInboxDir(settingsPath, customInbox);
    assert.equal(loadInboxDir(settingsPath), customInbox);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, "utf8")), {
      schemaVersion: 1,
      inboxDir: customInbox,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scan inbox validation requires an absolute Windows directory", () => {
  assert.throws(() => normalizeInboxDir("INBOX"), /absolute Windows path/);
  assert.throws(() => normalizeInboxDir("/tmp/INBOX"), /absolute Windows path/);
  assert.equal(
    normalizeInboxDir("  C:/Users/Presentail/Desktop/INBOX/  "),
    "C:\\Users\\Presentail\\Desktop\\INBOX",
  );
  assert.throws(
    () => normalizeInboxDir("C:\\Scans\\UPLOADED"),
    /cannot be named Uploaded or Failed/,
  );
  assert.throws(
    () => normalizeInboxDir("C:\\Scans\\failed"),
    /cannot be named Uploaded or Failed/,
  );
});

test("custom inbox derives sibling Uploaded and Failed directories", () => {
  assert.deepEqual(getScannerDirs("C:\\Users\\Presentail\\Desktop\\INBOX"), {
    inbox: "C:\\Users\\Presentail\\Desktop\\INBOX",
    uploaded: "C:\\Users\\Presentail\\Desktop\\Uploaded",
    failed: "C:\\Users\\Presentail\\Desktop\\Failed",
  });
});

test("prepared custom directories receive a successfully moved scan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-custom-flow-"));
  const inbox = path.join(root, "INBOX");
  try {
    const dirs = ensureScannerDirs(inbox);
    const scanPath = path.join(dirs.inbox, "test.pdf");
    const uploadedPath = path.join(dirs.uploaded, "test.pdf");
    fs.writeFileSync(scanPath, "%PDF test");
    moveFile(scanPath, uploadedPath);
    assert.equal(fs.existsSync(scanPath), false);
    assert.equal(fs.readFileSync(uploadedPath, "utf8"), "%PDF test");
    assert.equal(fs.existsSync(dirs.failed), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});