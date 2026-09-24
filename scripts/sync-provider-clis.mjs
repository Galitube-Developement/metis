#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.CHAT_DATA_DIR || path.join(process.cwd(), "data");
const runtimes = path.join(dataDir, "agent-runtimes");
const packages = {
  codex: { name: "@openai/codex", binary: "codex" },
  grok: { name: "@xai-official/grok", binary: "grok" },
  opencode: { name: "opencode-ai", binary: "opencode" },
};
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

function run(command, args, options = {}) {
  if (process.platform === "win32" && command === "npm") {
    command = process.execPath;
    args = [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args];
  }
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 240_000, ...options }).trim();
}

function manifestFor(id) {
  const file = path.join(runtimes, id, "active.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Invalid ${id} CLI manifest: ${file}`);
  }
}

function syncManaged(id) {
  const item = packages[id];
  const previous = manifestFor(id);
  if (id !== "codex" && !previous) return;
  const pinned = previous?.tracking === "pinned";
  const version = pinned ? previous.version : run("npm", ["view", `${item.name}@latest`, "version"]);
  if (!versionPattern.test(version)) throw new Error(`Invalid ${id} CLI version: ${version}`);
  const root = path.join(runtimes, id);
  const destination = path.join(root, version);
  const executable = path.join(destination, "node_modules", ".bin", process.platform === "win32" ? `${item.binary}.cmd` : item.binary);
  const packageFile = path.join(destination, "node_modules", ...item.name.split("/"), "package.json");
  let valid = false;
  try {
    valid = JSON.parse(readFileSync(packageFile, "utf8")).version === version && existsSync(executable);
  } catch {
    // Install a missing or incomplete version.
  }
  if (!valid) {
    mkdirSync(destination, { recursive: true });
    run("npm", ["install", "--prefix", destination, "--no-save", "--no-audit", "--no-fund", `${item.name}@${version}`]);
  }
  const reported = process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", `"${executable}" --version`])
    : run(executable, ["--version"]);
  if (!reported.includes(version)) throw new Error(`${id} CLI version check failed: ${reported}`);
  mkdirSync(root, { recursive: true });
  const file = path.join(root, "active.json");
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version, executable, tracking: pinned ? "pinned" : "latest" }), { mode: 0o600 });
  renameSync(temporary, file);
  console.log(`${id}: ${version}${pinned ? " (pinned)" : ""}`);
}

function updateIfInstalled(binary) {
  try {
    run(process.platform === "win32" ? "where.exe" : "which", [binary]);
  } catch {
    return;
  }
  try {
    run(binary, ["update"], process.platform === "win32" ? { shell: true } : {});
    console.log(`${binary}: updated`);
  } catch (error) {
    console.warn(`${binary}: update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const id of Object.keys(packages)) syncManaged(id);
updateIfInstalled("cursor-agent");
updateIfInstalled("agy");
