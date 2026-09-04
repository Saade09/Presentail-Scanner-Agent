const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const queueRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "scanner-recovery-queue-"),
);
process.env.APPDATA = queueRoot;

const uploader = require("../dist/lib/uploader.js");
const fileOps = require("../dist/lib/fileOps.js");
const queue = require("../dist/lib/queue.js");
const {
  attemptImmediateUpload,
  startRetryScheduler,
  stopRetryScheduler,
  triggerRetryProcessing,
} = require("../dist/lib/retryScheduler.js");

function schedulerOptions(root, overrides = {}) {
  return {
    serverUrl: "https://os.example.test",
    token: "not-a-real-token",
    agentVersion: "1.0.4",
    inboxDir: root,
    uploadedDir: path.join(root, "Uploaded"),
    failedDir: path.join(root, "Failed"),
    onStateChange: () => undefined,
    onCredentialRevoked: () => undefined,
    onStationDisabled: () => undefined,
    onConfigurationRequired: () => undefined,
    verifyDeviceSession: async () => "valid",
    ...overrides,
  };
}

test.afterEach(async () => {
  await stopRetryScheduler();
});

test.after(() => {
  queue.closeQueue();
  fs.rmSync(queueRoot, { recursive: true, force: true });
});

test("upload 401 with a valid heartbeat stays queued and later recovers without re-pairing", async () => {
  const originalUploadFile = uploader.uploadFile;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-auth-recovery-"));
  fs.mkdirSync(path.join(root, "Uploaded"));
  fs.mkdirSync(path.join(root, "Failed"));
  const scanPath = path.join(root, "invoice.pdf");
  fs.writeFileSync(scanPath, "%PDF recovery");
  const sha = "a".repeat(64);
  const queueId = queue.enqueue(scanPath, sha, new Date().toISOString());
  const states = [];
  let revoked = 0;
  let attempts = 0;

  uploader.uploadFile = async () => {
    attempts += 1;
    return attempts === 1
      ? {
          kind: "permanent",
          statusCode: 401,
          correlationId: "scan-correlation",
        }
      : {
          kind: "success",
          statusCode: 202,
          importId: 101,
          correlationId: "retry-correlation",
        };
  };

  try {
    startRetryScheduler(
      schedulerOptions(root, {
        onStateChange: (state) => states.push(state),
        onCredentialRevoked: () => {
          revoked += 1;
        },
        verifyDeviceSession: async (correlationId) => {
          assert.equal(correlationId, "scan-correlation");
          return "valid";
        },
      }),
    );

    await attemptImmediateUpload(
      scanPath,
      sha,
      new Date().toISOString(),
      queueId,
    );
    assert.equal(revoked, 0);
    assert.equal(queue.getCount(), 1);
    assert.equal(fs.existsSync(scanPath), true);
    assert.equal(states.at(-1), "offline");

    await new Promise((resolve) => setTimeout(resolve, 5_100));
    triggerRetryProcessing();
    for (let attempt = 0; attempt < 20 && queue.getCount() > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(queue.getCount(), 0);
    assert.equal(fs.existsSync(scanPath), false);
    assert.equal(fs.readdirSync(path.join(root, "Uploaded")).length, 1);
    assert.equal(states.at(-1), "connected");
  } finally {
    uploader.uploadFile = originalUploadFile;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("upload 401 only requires re-pair after heartbeat confirms revocation", async () => {
  const originalUploadFile = uploader.uploadFile;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-auth-revoked-"));
  fs.mkdirSync(path.join(root, "Uploaded"));
  fs.mkdirSync(path.join(root, "Failed"));
  const scanPath = path.join(root, "invoice.pdf");
  fs.writeFileSync(scanPath, "%PDF revoked");
  const sha = "b".repeat(64);
  const queueId = queue.enqueue(scanPath, sha, new Date().toISOString());
  let revoked = 0;

  uploader.uploadFile = async () => ({
    kind: "permanent",
    statusCode: 401,
    correlationId: "revoked-correlation",
  });

  try {
    startRetryScheduler(
      schedulerOptions(root, {
        onCredentialRevoked: () => {
          revoked += 1;
        },
        verifyDeviceSession: async () => "credential-revoked",
      }),
    );
    await attemptImmediateUpload(
      scanPath,
      sha,
      new Date().toISOString(),
      queueId,
    );
    assert.equal(revoked, 1);
    assert.equal(queue.getCount(), 1);
    assert.equal(fs.existsSync(scanPath), true);
  } finally {
    uploader.uploadFile = originalUploadFile;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("two consecutive queued scans upload once each", async () => {
  const originalUploadFile = uploader.uploadFile;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-consecutive-"));
  fs.mkdirSync(path.join(root, "Uploaded"));
  fs.mkdirSync(path.join(root, "Failed"));
  const scans = ["first.pdf", "second.png"].map((name, index) => {
    const filePath = path.join(root, name);
    fs.writeFileSync(filePath, index === 0 ? "%PDF first" : "\x89PNG second");
    const sha = String(index + 1).repeat(64);
    return {
      filePath,
      sha,
      queueId: queue.enqueue(filePath, sha, new Date().toISOString()),
    };
  });
  const uploaded = [];
  uploader.uploadFile = async (_serverUrl, _token, filePath) => {
    uploaded.push(path.basename(filePath));
    return { kind: "success", statusCode: 202, importId: uploaded.length };
  };

  try {
    startRetryScheduler(schedulerOptions(root));
    await Promise.all(
      scans.map((scan) =>
        attemptImmediateUpload(
          scan.filePath,
          scan.sha,
          new Date().toISOString(),
          scan.queueId,
        ),
      ),
    );
    assert.deepEqual(uploaded.sort(), ["first.pdf", "second.png"]);
    assert.equal(queue.getCount(), 0);
    assert.equal(fs.readdirSync(path.join(root, "Uploaded")).length, 2);
  } finally {
    uploader.uploadFile = originalUploadFile;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a Failed-folder move error leaves a rejected scan queued in Inbox", async () => {
  const originalUploadFile = uploader.uploadFile;
  const originalMoveFile = fileOps.moveFile;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-failed-move-"));
  fs.mkdirSync(path.join(root, "Uploaded"));
  fs.mkdirSync(path.join(root, "Failed"));
  const scanPath = path.join(root, "invoice.pdf");
  fs.writeFileSync(scanPath, "%PDF rejected");
  const sha = "c".repeat(64);
  const queueId = queue.enqueue(scanPath, sha, new Date().toISOString());
  const states = [];

  uploader.uploadFile = async () => ({
    kind: "permanent",
    statusCode: 400,
    reason: "Unsupported file",
  });
  fileOps.moveFile = () => false;

  try {
    startRetryScheduler(
      schedulerOptions(root, {
        onStateChange: (state) => states.push(state),
      }),
    );
    await attemptImmediateUpload(
      scanPath,
      sha,
      new Date().toISOString(),
      queueId,
    );
    assert.equal(queue.getCount(), 1);
    assert.equal(fs.existsSync(scanPath), true);
    assert.equal(states.at(-1), "inbox-error");
  } finally {
    uploader.uploadFile = originalUploadFile;
    fileOps.moveFile = originalMoveFile;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
