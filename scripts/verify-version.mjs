#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(agentDir, "package.json"), "utf8"));
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";
const expectedTag = `scanner-agent-v${pkg.version}`;
const minimumCustomInboxVersion = [1, 0, 3];

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Scanner Agent package version is invalid: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

if (tag && tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${pkg.version}`);
}
if (compareVersions(parseVersion(pkg.version), minimumCustomInboxVersion) < 0) {
  throw new Error(
    `Scanner Agent ${pkg.version} predates the configurable-inbox release 1.0.3`,
  );
}

const mainSource = readFileSync(join(agentDir, "src", "main.ts"), "utf8");
if (!mainSource.includes("export const AGENT_VERSION = app.getVersion();")) {
  throw new Error("Runtime version must be derived from Electron app.getVersion()");
}
for (const marker of [
  'ipcMain.handle("scanner:get-settings"',
  "normalizeInboxDir(payload.inboxDir ?? DEFAULT_INBOX_DIR)",
  "startAgentServices(agentState, true, inboxDir)",
  "startWatcher({",
  "inboxDir: inbox",
]) {
  if (!mainSource.includes(marker)) {
    throw new Error(`Current Scanner Agent source is missing release marker: ${marker}`);
  }
}

console.log(`Verified Scanner Agent version ${pkg.version}${tag ? ` (${tag})` : ""}`);