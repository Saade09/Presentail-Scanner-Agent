#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(agentDir, "release");
const pkg = JSON.parse(readFileSync(join(agentDir, "package.json"), "utf8"));
const expectedName = `Presentail-Scanner-Agent-${pkg.version}-x64.exe`;
const installerPath = join(releaseDir, expectedName);
const manifestPath = join(releaseDir, "latest.yml");
const asarPath = join(releaseDir, "win-unpacked", "resources", "app.asar");

const provenanceFiles = {
  "dist/main.js": [
    "scanner:get-settings",
    "inboxSettings_js_1.normalizeInboxDir)(payload.inboxDir ?? inboxSettings_js_1.DEFAULT_INBOX_DIR)",
    "startAgentServices(agentState, true, inboxDir)",
    "watcher_js_1.startWatcher)({",
    "inboxDir: inbox",
    "verifyDeviceSession: async (correlationId)",
  ],
  "dist/lib/inboxSettings.js": [
    "Scan inbox path is required.",
    "SETTINGS_SCHEMA_VERSION = 1",
    "Could not save the scan inbox setting",
  ],
  "dist/lib/watcher.js": [
    "restartDelayMs = WATCHER_RESTART_DELAY_MS",
    "watcherFactory(inboxDir",
    "Watcher: restarting after recoverable error",
    ".presentail-queue",
    "stable payload claimed for durable upload",
    "recoverStagedFiles(inboxDir, restartDelayMs)",
  ],
  "dist/lib/retryScheduler.js": [
    "inboxDir,",
    "uploadedDir,",
    "failedDir,",
    "Upload complete",
    "Upload authentication rejected — confirming active device session",
    "activeUploadHashes",
  ],
  "dist/lib/tray.js": ["Scan inbox:", "Version:"],
  "renderer/setup/setup.js": [
    "window.scanner.getSettings()",
    "inboxDir",
    "Enter an absolute Windows scan folder",
  ],
};

function requirePath(path, description) {
  if (!existsSync(path)) throw new Error(`${description} is missing: ${path}`);
}

function findNativeBinaries(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...findNativeBinaries(path));
    if (entry.isFile() && entry.name.endsWith(".node")) found.push(path);
  }
  return found;
}

function assertPeX64(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`Native binary is not a Windows PE file: ${path}`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`Native binary has an invalid PE header: ${path}`);
  }
  if (bytes.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error(`Native binary is not x64: ${path}`);
  }
}

function isPeX64(path) {
  try {
    assertPeX64(path);
    return true;
  } catch {
    return false;
  }
}

function readAsarHeader(archivePath) {
  const archive = readFileSync(archivePath);
  if (archive.length < 16)
    throw new Error(`ASAR archive is too small: ${archivePath}`);

  const headerSize = archive.readUInt32LE(4);
  const headerStart = 8;
  const headerEnd = headerStart + headerSize;
  if (headerSize < 8 || headerEnd > archive.length) {
    throw new Error(`ASAR archive has an invalid header size: ${archivePath}`);
  }

  const jsonLength = archive.readUInt32LE(headerStart + 4);
  const jsonStart = headerStart + 8;
  const jsonEnd = jsonStart + jsonLength;
  if (jsonEnd > headerEnd) {
    throw new Error(`ASAR archive has an invalid JSON header: ${archivePath}`);
  }

  return {
    archive,
    header: JSON.parse(archive.toString("utf8", jsonStart, jsonEnd)),
    contentOffset: headerEnd,
  };
}

function readAsarFile(asar, filename) {
  const parts = filename.split("/");
  let node = asar.header;
  for (const part of parts) {
    node = node?.files?.[part];
    if (!node) throw new Error(`Packaged application is missing ${filename}`);
  }
  if (node.unpacked) {
    return readFileSync(join(`${asarPath}.unpacked`, ...parts));
  }
  const offset = asar.contentOffset + Number.parseInt(node.offset, 10);
  return asar.archive.subarray(offset, offset + node.size);
}

function verifyCurrentSourceWasPackaged() {
  const asar = readAsarHeader(asarPath);
  const bundleHash = createHash("sha256");

  for (const [filename, markers] of Object.entries(provenanceFiles)) {
    const packaged = readAsarFile(asar, filename);
    const current = readFileSync(join(agentDir, filename));
    if (!packaged.equals(current)) {
      throw new Error(
        `Packaged ${filename} does not match the current Scanner Agent build output`,
      );
    }
    const text = packaged.toString("utf8");
    for (const marker of markers) {
      if (!text.includes(marker)) {
        throw new Error(
          `Packaged ${filename} is missing custom-inbox marker: ${marker}`,
        );
      }
    }
    bundleHash.update(filename);
    bundleHash.update("\0");
    bundleHash.update(packaged);
  }

  return bundleHash.digest("hex");
}

requirePath(installerPath, "Versioned x64 NSIS installer");
requirePath(manifestPath, "electron-updater manifest");
if (statSync(installerPath).size < 1_000_000) {
  throw new Error(
    `Installer is unexpectedly small: ${statSync(installerPath).size} bytes`,
  );
}

const unpacked = join(releaseDir, "win-unpacked", "resources");
requirePath(asarPath, "Packaged Electron application");
requirePath(
  join(unpacked, "app.asar.unpacked", "node_modules", "keytar"),
  "Packaged keytar native dependency",
);
requirePath(
  join(unpacked, "app.asar.unpacked", "node_modules", "better-sqlite3"),
  "Packaged better-sqlite3 native dependency",
);
for (const packageName of ["keytar", "better-sqlite3"]) {
  const packageDir = join(
    unpacked,
    "app.asar.unpacked",
    "node_modules",
    packageName,
  );
  const nativeBinaries = findNativeBinaries(packageDir);
  const windowsNativeBinaries = nativeBinaries.filter(isPeX64);
  if (windowsNativeBinaries.length === 0) {
    throw new Error(
      `${packageName} contains no packaged Windows x64 .node binary`,
    );
  }
}

const sourceBundleSha256 = verifyCurrentSourceWasPackaged();

const sha256 = createHash("sha256")
  .update(readFileSync(installerPath))
  .digest("hex");
writeFileSync(
  join(releaseDir, "SHA256SUMS.txt"),
  `${sha256}  ${expectedName}\n`,
);
writeFileSync(
  join(releaseDir, "RELEASE-METADATA.json"),
  `${JSON.stringify(
    {
      version: pkg.version,
      arch: "x64",
      installer: expectedName,
      sha256,
      sourceBundleSha256,
      sourceCommit: process.env.GITHUB_SHA || null,
      capabilities: [
        "configurable-inbox",
        "custom-inbox-watcher",
        "sibling-uploaded-failed",
        "post-scan-auth-confirmation",
        "watcher-auto-recovery",
        "duplicate-safe-queue-retry",
        "durable-inbox-staging",
        "connected-while-queue-drains",
      ],
      updateManifest: "latest.yml",
      downloadUrl:
        `https://github.com/Saade09/Presentail-Scanner-Agent/releases/download/` +
        `scanner-agent-v${pkg.version}/${expectedName}`,
    },
    null,
    2,
  )}\n`,
);

const unexpectedInstallers = readdirSync(releaseDir).filter(
  (name) => name.endsWith(".exe") && name !== expectedName,
);
if (unexpectedInstallers.length) {
  throw new Error(
    `Unexpected installer filename(s): ${unexpectedInstallers.join(", ")}`,
  );
}

console.log(`Verified ${expectedName}`);
console.log(`SHA-256 ${sha256}`);
