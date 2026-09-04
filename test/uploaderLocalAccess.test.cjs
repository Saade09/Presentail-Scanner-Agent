const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { uploadFile } = require("../dist/lib/uploader.js");

test("metadata race after a successful read remains recoverable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-stat-race-"));
  const scanPath = path.join(root, "invoice.pdf");
  fs.writeFileSync(scanPath, "%PDF metadata race");
  const originalStatSync = fs.statSync;
  fs.statSync = (target, ...args) => {
    if (target === scanPath) {
      throw Object.assign(new Error("file metadata temporarily unavailable"), {
        code: "EBUSY",
      });
    }
    return originalStatSync(target, ...args);
  };

  try {
    const result = await uploadFile(
      "https://os.example.test",
      "not-a-real-token",
      scanPath,
      "1.0.4",
    );
    assert.equal(result.kind, "recoverable");
    assert.equal(result.reason, "Local file metadata unavailable");
    assert.equal(fs.existsSync(scanPath), true);
  } finally {
    fs.statSync = originalStatSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
