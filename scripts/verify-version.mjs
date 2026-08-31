#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(agentDir, "package.json"), "utf8"));
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";
const expectedTag = `scanner-agent-v${pkg.version}`;

if (tag && tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${pkg.version}`);
}

const mainSource = readFileSync(join(agentDir, "src", "main.ts"), "utf8");
if (!mainSource.includes("export const AGENT_VERSION = app.getVersion();")) {
  throw new Error("Runtime version must be derived from Electron app.getVersion()");
}

console.log(`Verified Scanner Agent version ${pkg.version}${tag ? ` (${tag})` : ""}`);