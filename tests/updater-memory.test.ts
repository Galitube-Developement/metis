import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundInstallerLogLines, readBoundedInstallerLog, readBoundedUpdateJson, UPDATE_LOG_MAX_CHARS } from "../lib/installer-update-log";
import { installerLogIndicatesFailure } from "../lib/installer-update";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "[metis-update-job:memory-test]";

test("160 MiB log and an unterminated line fit in a 80 MiB JavaScript heap", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-log-memory-"));
  try {
    const file = path.join(directory, "large.log"), handle = await open(file, "w");
    try {
      await handle.write("Error: stale previous failure\n" + marker + "\n[metis-update-pid:123]\n");
      await handle.write("\n" + "build output\n".repeat(300) + "Metis AI installed successfully.\n[metis-update-exit:0]\n", 160 * 1024 * 1024);
    } finally { await handle.close(); }
    const runner = path.join(directory, "reader.mjs");
    await writeFile(runner, `import assert from "node:assert/strict";
import { getHeapStatistics } from "node:v8";
import { readBoundedInstallerLog, UPDATE_LOG_MAX_CHARS } from ${JSON.stringify(path.join(root, "lib/installer-update-log.ts"))};
const lines = await readBoundedInstallerLog(${JSON.stringify(file)}, 200, "memory-test");
assert.ok(getHeapStatistics().heap_size_limit <= 80 * 1024 * 1024);
assert.equal(lines[0], ${JSON.stringify(marker)});
assert.ok(lines.includes("[metis-update-pid:123]"));
assert.ok(lines.includes("Metis AI installed successfully."));
assert.ok(lines.includes("[metis-update-exit:0]"));
assert.ok(!lines.some(line => line.includes("stale previous")));
assert.ok(lines.join("\\n").length <= UPDATE_LOG_MAX_CHARS);
console.log("BOUNDED_160_MIB_LOG_80_MIB_HEAP_PASS", JSON.stringify({heapLimit:getHeapStatistics().heap_size_limit, returnedChars:lines.join("\\n").length}));
`);
    const result = spawnSync(process.execPath, ["--max-old-space-size=64", "--max-semi-space-size=4", "--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), runner], { cwd: root, encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BOUNDED_160_MIB_LOG_80_MIB_HEAP_PASS/);
    console.log(result.stdout.trim());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("incremental reads preserve split UTF-8 and partial lines without duplicates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-log-utf8-"));
  const file = path.join(directory, "log");
  try {
    await writeFile(file, marker + "\nbuild");
    assert.equal((await readBoundedInstallerLog(file, 80, "memory-test")).at(-1), "build");
    await appendFile(file, "ing\n");
    const encoded = Buffer.from("Äpfel prüfen\n", "utf8");
    await appendFile(file, encoded.subarray(0, 1));
    await readBoundedInstallerLog(file, 80, "memory-test");
    await appendFile(file, encoded.subarray(1));
    const results = await Promise.all([readBoundedInstallerLog(file, 80, "memory-test"), readBoundedInstallerLog(file, 80, "memory-test")]);
    for (const lines of results) {
      assert.equal(lines.filter(line => line === "building").length, 1);
      assert.equal(lines.at(-1), "Äpfel prüfen");
      assert.ok(!lines.join("").includes("�"));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("new jobs, truncation and file replacement never reuse stale success or failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-log-reset-"));
  const file = path.join(directory, "log");
  try {
    await writeFile(file, marker + "\nFailed to compile.\n[metis-update-exit:1]\n");
    assert.ok((await readBoundedInstallerLog(file, 80, "memory-test")).includes("Failed to compile."));
    await appendFile(file, "[metis-update-job:new]\nworking\n");
    const old = await readBoundedInstallerLog(file, 80, "memory-test");
    assert.ok(!old.includes("working"));
    const latest = await readBoundedInstallerLog(file);
    assert.equal(latest[0], "[metis-update-job:new]");
    assert.ok(!latest.includes("Failed to compile."));
    await writeFile(file, marker + "\nnew\n");
    assert.deepEqual(await readBoundedInstallerLog(file, 80, "memory-test"), [marker, "new"]);
    await rename(file, file + ".old");
    await writeFile(file, marker + "\nreplaced\n");
    assert.deepEqual(await readBoundedInstallerLog(file, 80, "memory-test"), [marker, "replaced"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("bounded snapshots retain job identity, PID, failures and terminal evidence", () => {
  const logs = boundInstallerLogLines([marker, "[metis-update-pid:1]", "FATAL ERROR: heap out of memory",
    ...Array.from({ length: 10000 }, () => "x".repeat(5000)), "Metis AI installed successfully.", "[metis-update-exit:0]"]);
  assert.equal(logs[0], marker);
  assert.ok(logs.includes("[metis-update-pid:1]"));
  assert.ok(logs.includes("FATAL ERROR: heap out of memory"));
  assert.equal(logs.at(-1), "[metis-update-exit:0]");
  assert.ok(logs.join("\n").length <= UPDATE_LOG_MAX_CHARS);
  assert.ok(logs.every(line => line.length < 2100));
  assert.equal(installerLogIndicatesFailure("installer failed Error: build"), true);
  assert.equal(installerLogIndicatesFailure("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"), true);
});

test("oversized legacy state is rejected before decoding; small JSON still loads", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "metis-log-state-"));
  const file = path.join(directory, "state.json");
  try {
    const handle = await open(file, "w");
    try { await handle.truncate(160 * 1024 * 1024); } finally { await handle.close(); }
    await assert.rejects(readBoundedUpdateJson(file, 1024 * 1024), /exceeds/);
    assert.equal((await open(file).then(async h => { try { return (await h.stat()).size; } finally { await h.close(); } })), 160 * 1024 * 1024);
    await writeFile(file, '{"status":"failed"}');
    assert.deepEqual(JSON.parse(await readBoundedUpdateJson(file, 1024 * 1024)), { status: "failed" });
    assert.equal(await readFile(file, "utf8"), '{"status":"failed"}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
