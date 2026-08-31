#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(agentDir, "release");
const pkg = JSON.parse(readFileSync(join(agentDir, "package.json"), "utf8"));
const expectedName = `Presentail-Scanner-Agent-${pkg.version}-x64.exe`;
const installerPath = join(releaseDir, expectedName);
const manifestPath = join(releaseDir, "latest.yml");

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

requirePath(installerPath, "Versioned x64 NSIS installer");
requirePath(manifestPath, "electron-updater manifest");
if (statSync(installerPath).size < 1_000_000) {
  throw new Error(`Installer is unexpectedly small: ${statSync(installerPath).size} bytes`);
}

const unpacked = join(releaseDir, "win-unpacked", "resources");
requirePath(join(unpacked, "app.asar"), "Packaged Electron application");
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
  if (nativeBinaries.length === 0) {
    throw new Error(`${packageName} contains no packaged .node binary`);
  }
  nativeBinaries.forEach(assertPeX64);
}

const sha256 = createHash("sha256")
  .update(readFileSync(installerPath))
  .digest("hex");
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${sha256}  ${expectedName}\n`);
writeFileSync(
  join(releaseDir, "RELEASE-METADATA.json"),
  `${JSON.stringify(
    {
      version: pkg.version,
      arch: "x64",
      installer: expectedName,
      sha256,
      updateManifest: "latest.yml",
    },
    null,
    2,
  )}\n`,
);

const unexpectedInstallers = readdirSync(releaseDir).filter(
  (name) => name.endsWith(".exe") && name !== expectedName,
);
if (unexpectedInstallers.length) {
  throw new Error(`Unexpected installer filename(s): ${unexpectedInstallers.join(", ")}`);
}

console.log(`Verified ${expectedName}`);
console.log(`SHA-256 ${sha256}`);