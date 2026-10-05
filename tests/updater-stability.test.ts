import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstallerUpdatePlan, installerExitCommand, installerExitCode, installerProcessIsRunning, readInstallerUpdateLog, runSpawnedInstaller } from "../lib/installer-update";
import { settleUpdateJobFromInstaller } from "../lib/update-job";


test("concurrent requests create one durable job and the start lock blocks other processes", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "metis-start-lock-"));
  try {
    const dataDir = path.join(temp, "data");
    await mkdir(dataDir);
    const runner = path.join(temp, "runner.mjs");
    await writeFile(runner, `import assert from "node:assert/strict";
import { startInstallerUpdateJob } from ${JSON.stringify(path.join(root, "lib/update-job.ts"))};
import { readFile } from "node:fs/promises";
const input = { root: process.env.AI_CHAT_ROOT, dataDir: process.env.CHAT_DATA_DIR, docker: false, platform: "darwin", channel: "releases", serviceName: "metis-test" };
if (process.argv[2] === "unwritable") {
  await assert.rejects(startInstallerUpdateJob(input), /EISDIR|ENOTDIR|EPERM|EACCES/);
  await assert.rejects(readFile(input.dataDir + "/metis-maintenance.json"), /ENOENT/);
  console.log("DURABLE_JOB_REQUIRED");
} else if (process.argv[2] === "locked") {
  await assert.rejects(startInstallerUpdateJob(input), /update request is starting/);
  console.log("START_LOCK_CONFIRMED");
} else {
  const [a, b] = await Promise.all([startInstallerUpdateJob(input), startInstallerUpdateJob(input)]);
  assert.equal(a.jobId, b.jobId);
  const log = await readFile(input.dataDir + "/metis-installer-update.log", "utf8");
  assert.equal((log.match(/metis-update-job:/g) || []).length, 1);
  console.log("SINGLE_JOB_CONFIRMED");
}
`);
    const run = (mode: string) => spawnSync(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), runner, mode], {
      cwd: root, env: { ...process.env, AI_CHAT_ROOT: temp, CHAT_DATA_DIR: dataDir }, encoding: "utf8", timeout: 10000,
    });
    await mkdir(path.join(dataDir, "metis-update-start.lock"));
    const blocked = run("locked");
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.match(blocked.stdout, /START_LOCK_CONFIRMED/);
    await rm(path.join(dataDir, "metis-update-start.lock"), { recursive: true });
    await mkdir(path.join(dataDir, "metis-update-job.json"));
    const unwritable = run("unwritable");
    assert.equal(unwritable.status, 0, unwritable.stderr);
    assert.match(unwritable.stdout, /DURABLE_JOB_REQUIRED/);
    await rm(path.join(dataDir, "metis-update-job.json"), { recursive: true });
    await writeFile(path.join(dataDir, "metis-installer-update.log"), "");
    const concurrent = run("concurrent");
    assert.equal(concurrent.status, 0, concurrent.stderr);
    assert.match(concurrent.stdout, /SINGLE_JOB_CONFIRMED/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = { root, dataDir: path.join(root, "data"), docker: false, serviceName: "custom-metis", channel: "releases" as const };
const job = { jobId: "stability", status: "preparing" as const, startedAt: "2026-01-01T00:00:00Z", startedByPid: 100, logs: [] };
const marker = "[metis-update-job:stability]";
const settle = (logText: string) => settleUpdateJobFromInstaller(job, { installerRunning: false, currentPid: 200, logText });

async function waitForText(file: string, text: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await readFile(file, "utf8").catch(() => "");
    if (value.includes(text)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Missing ${text} in ${file}`);
}

test("implicit platform uses this host and unsupported hosts fail explicitly", () => {
  assert.equal(buildInstallerUpdatePlan(input).platform, process.platform);
  assert.throws(() => buildInstallerUpdatePlan({ ...input, platform: "freebsd" }), /not supported/);
  const win = buildInstallerUpdatePlan({ ...input, platform: "win32" });
  assert.deepEqual(win.args.slice(-2), ["-ServiceName", "custom-metis"]);
});

test("actual compiler failure and nonzero exit recover as failed after restart", () => {
  assert.equal(settle(`${marker}\nFailed to compile.\n> Build failed because of webpack errors\nELIFECYCLE Command failed with exit code 1.`).status, "failed");
  assert.equal(settle(`${marker}\n[metis-update-exit:42]`).status, "failed");
  assert.equal(settle(`${marker}\n[metis-update-exit:0]`).status, "failed", "exit zero alone is not health verification");
  assert.equal(settle(`${marker}\nError: recovered download attempt\nMetis AI installed successfully.\n[metis-update-exit:0]`).status, "ready");
});

test("live detached installer keeps preparing and terminal status overrides PID reuse", () => {
  const logs = `${marker}\n[metis-update-pid:${process.pid}]\nError: recoverable retry`;
  assert.equal(installerProcessIsRunning(logs), true);
  assert.equal(settle(logs).status, "preparing");
  assert.equal(installerProcessIsRunning(`${logs}\n[metis-update-exit:1]`), false);
  assert.equal(settle(`${logs}\n[metis-update-exit:1]`).status, "failed");
  assert.equal(installerExitCode("[metis-update-exit:42]\r\n"), 42);
});

test("long logs keep current job identity and process evidence without stale failures", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "metis-long-log-"));
  try {
    await writeFile(path.join(temp, "metis-installer-update.log"), `Error: previous job\n${marker}\n[metis-update-pid:${process.pid}]\n${"building...\n".repeat(350)}Metis AI installed successfully.\n[metis-update-exit:0]\n`);
    const lines = await readInstallerUpdateLog(temp, 200, job.jobId);
    assert.equal(lines[0], marker);
    assert.ok(lines.includes(`[metis-update-pid:${process.pid}]`));
    assert.ok(!lines.includes("Error: previous job"));
    assert.equal(settle(lines.join("\n")).status, "ready");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("spawned installer writes stdout, stderr and exact exit code to durable log", { skip: process.platform === "win32" }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "metis-spawn-log-"));
  try {
    const plan = { ...buildInstallerUpdatePlan({ ...input, platform: "darwin" }), logFile: path.join(temp, "log") };
    await assert.rejects(runSpawnedInstaller(plan, ["-c", "echo stdout; echo stderr >&2; exit 23"], () => {}), /status 23/);
    const text = await readFile(plan.logFile, "utf8");
    assert.match(text, /stdout/);
    assert.match(text, /stderr/);
    assert.equal(installerExitCode(text), 23);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("installer survives termination of its app parent and finishes logging", { skip: process.platform === "win32" }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "metis-parent-exit-"));
  let parent: ReturnType<typeof spawn> | undefined;
  try {
    const logFile = path.join(temp, "log");
    const plan = { ...buildInstallerUpdatePlan({ ...input, platform: "darwin" }), logFile };
    const runner = path.join(temp, "runner.mjs");
    await writeFile(runner, `import { runSpawnedInstaller } from ${JSON.stringify(path.join(root, "lib/installer-update.ts"))};\nawait runSpawnedInstaller(${JSON.stringify(plan)}, ["-c", "echo INSTALLER_STARTED; sleep 0.3; echo 'Metis AI installed successfully.'"], () => {});\n`);
    parent = spawn(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), runner], { stdio: "ignore" });
    await waitForText(logFile, "INSTALLER_STARTED");
    const exited = new Promise((resolve) => parent!.once("exit", resolve));
    parent.kill("SIGKILL");
    await exited;
    const logs = await waitForText(logFile, "[metis-update-exit:0]");
    assert.match(logs, /Metis AI installed successfully/);
  } finally {
    if (parent && parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL");
    await rm(temp, { recursive: true, force: true });
  }
});

test("Windows wrapper encodes literal paths and arguments for PowerShell", () => {
  const plan = { ...buildInstallerUpdatePlan({ ...input, platform: "win32" }), logFile: "C:\\User's folder\\update.log" };
  const wrapped = installerExitCommand(plan, ["-File", "C:\\User's folder\\install.ps1"]);
  const script = Buffer.from(wrapped.at(-1)!, "base64").toString("utf16le");
  assert.match(script, /User''s folder/);
  assert.match(script, /\$LASTEXITCODE/);
  assert.ok(wrapped.includes("-EncodedCommand"));
});

test("failed clean slot rebuild restores previous artifacts and tsconfig", { skip: process.platform === "win32" }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "metis-cache-test-"));
  try {
    await mkdir(path.join(temp, "scripts"));
    await mkdir(path.join(temp, ".next-a/cache"), { recursive: true });
    await writeFile(path.join(temp, ".next-a/BUILD_ID"), "old-build");
    await writeFile(path.join(temp, ".next-a/cache/stale"), "old-path");
    await writeFile(path.join(temp, "tsconfig.json"), "original");
    await writeFile(path.join(temp, "next-env.d.ts"), "original-env");
    const script = path.join(temp, "scripts/build-production-slot.sh");
    await writeFile(script, await readFile(path.join(root, "scripts/build-production-slot.sh")));
    const pnpm = path.join(temp, "fake-pnpm");
    await writeFile(pnpm, '#!/bin/sh\n[ ! -e .next-a/cache/stale ] || exit 99\necho changed > tsconfig.json\necho changed > next-env.d.ts\necho incomplete-new-build > .next-a/BUILD_ID\necho CLEAN_CACHE_CONFIRMED\nexit 42\n', { mode: 0o700 });
    const result = spawnSync("/bin/bash", [script, ".next-a"], { cwd: temp, env: { ...process.env, AI_CHAT_ROOT: temp, PNPM_BIN: pnpm, METIS_REUSE_BUILD_CACHE: "0" }, encoding: "utf8" });
    assert.equal(result.status, 42, result.stderr);
    assert.match(result.stdout, /CLEAN_CACHE_CONFIRMED/);
    assert.equal(await readFile(path.join(temp, ".next-a/BUILD_ID"), "utf8"), "old-build");
    assert.equal(await readFile(path.join(temp, "tsconfig.json"), "utf8"), "original");
    assert.equal(await readFile(path.join(temp, "next-env.d.ts"), "utf8"), "original-env");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
