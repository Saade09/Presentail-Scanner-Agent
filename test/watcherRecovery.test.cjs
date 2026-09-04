const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const queueRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "scanner-watcher-queue-"),
);
process.env.APPDATA = queueRoot;

const { closeQueue, dequeueDue, markDone } = require("../dist/lib/queue.js");
const {
  stageFileForUpload,
  startWatcher,
  stopWatcher,
} = require("../dist/lib/watcher.js");

class FakeWatcher extends EventEmitter {
  async close() {
    // Keep listeners so the test can prove stale events are ignored.
  }
}

test.afterEach(async () => {
  await stopWatcher();
});

test.after(() => {
  closeQueue();
  fs.rmSync(queueRoot, { recursive: true, force: true });
});

test("watcher restarts after a recoverable filesystem error", async () => {
  const inboxDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "scanner-watcher-restart-"),
  );
  const watchers = [];
  const errors = [];
  let readyCount = 0;

  try {
    startWatcher({
      inboxDir,
      restartDelayMs: 10,
      watcherFactory: () => {
        const watcher = new FakeWatcher();
        watchers.push(watcher);
        setImmediate(() => watcher.emit("ready"));
        return watcher;
      },
      onError: (error) => errors.push(error.message),
      onReady: () => {
        readyCount += 1;
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readyCount, 1);
    watchers[0].emit(
      "error",
      new Error("OneDrive path temporarily unavailable"),
    );

    for (let attempt = 0; attempt < 20 && watchers.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(errors, ["OneDrive path temporarily unavailable"]);
    assert.equal(watchers.length, 2);
    assert.equal(readyCount, 2);

    watchers[0].emit("error", new Error("late stale watcher error"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(watchers.length, 2);
    assert.equal(readyCount, 2);
    assert.deepEqual(errors, ["OneDrive path temporarily unavailable"]);
  } finally {
    fs.rmSync(inboxDir, { recursive: true, force: true });
  }
});

test("staging preserves an in-flight payload when the scanner reuses its filename", () => {
  const inboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-overwrite-"));
  const scanPath = path.join(inboxDir, "scan.pdf");
  const firstPayload = Buffer.from("%PDF first scan");
  const secondPayload = Buffer.from("%PDF second scan");

  try {
    fs.writeFileSync(scanPath, firstPayload);
    const firstStaged = stageFileForUpload(scanPath, inboxDir);
    fs.writeFileSync(scanPath, secondPayload);
    const secondStaged = stageFileForUpload(scanPath, inboxDir);

    assert.deepEqual(fs.readFileSync(firstStaged), firstPayload);
    assert.deepEqual(fs.readFileSync(secondStaged), secondPayload);
    assert.notEqual(firstStaged, secondStaged);
    assert.equal(fs.existsSync(scanPath), false);
  } finally {
    fs.rmSync(inboxDir, { recursive: true, force: true });
  }
});

test("a temporarily inaccessible staged file is queued without an app restart", async () => {
  const inboxDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "scanner-staged-recovery-"),
  );
  const scanPath = path.join(inboxDir, "scan.pdf");
  fs.writeFileSync(scanPath, "%PDF staged recovery");
  const stagedPath = stageFileForUpload(scanPath, inboxDir);
  const originalReadFileSync = fs.readFileSync;
  let blocked = true;
  fs.readFileSync = (target, ...args) => {
    if (target === stagedPath && blocked) {
      blocked = false;
      throw Object.assign(new Error("OneDrive file is temporarily locked"), {
        code: "EBUSY",
      });
    }
    return originalReadFileSync(target, ...args);
  };

  try {
    startWatcher({
      inboxDir,
      restartDelayMs: 10,
      watcherFactory: () => new FakeWatcher(),
    });
    for (
      let attempt = 0;
      attempt < 30 &&
      !dequeueDue().some((entry) => entry.file_path === stagedPath);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const entry = dequeueDue().find(
      (candidate) => candidate.file_path === stagedPath,
    );
    assert.ok(entry);
    markDone(entry.id);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.rmSync(inboxDir, { recursive: true, force: true });
  }
});

test("a temporarily inaccessible staging directory recovers without an app restart", async () => {
  const inboxDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "scanner-staging-directory-recovery-"),
  );
  const scanPath = path.join(inboxDir, "scan.pdf");
  fs.writeFileSync(scanPath, "%PDF directory recovery");
  const stagedPath = stageFileForUpload(scanPath, inboxDir);
  const stagingRoot = path.join(inboxDir, ".presentail-queue");
  const originalReaddirSync = fs.readdirSync;
  let blocked = true;
  fs.readdirSync = (target, ...args) => {
    if (target === stagingRoot && blocked) {
      blocked = false;
      throw Object.assign(
        new Error("OneDrive directory is temporarily locked"),
        {
          code: "EBUSY",
        },
      );
    }
    return originalReaddirSync(target, ...args);
  };

  try {
    startWatcher({
      inboxDir,
      restartDelayMs: 10,
      watcherFactory: () => new FakeWatcher(),
    });
    for (
      let attempt = 0;
      attempt < 30 &&
      !dequeueDue().some((entry) => entry.file_path === stagedPath);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const entry = dequeueDue().find(
      (candidate) => candidate.file_path === stagedPath,
    );
    assert.ok(entry);
    markDone(entry.id);
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(inboxDir, { recursive: true, force: true });
  }
});
