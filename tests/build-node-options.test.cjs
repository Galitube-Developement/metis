/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the standalone CommonJS build helper with the same native runtime. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildHeapMb, buildNodeOptions } = require("../scripts/build-node-options.cjs");
const GiB = 1024 ** 3;

test("build heap grows to 8 GiB with room for other processes", () => {
  assert.equal(buildHeapMb(16 * GiB), 8192);
  assert.equal(buildHeapMb(8 * GiB), 6144);
  assert.equal(buildHeapMb(4 * GiB), 3072);
});

test("build heap respects smaller container limits and unavailable detection", () => {
  assert.equal(buildHeapMb(32 * GiB, 4 * GiB), 3072);
  assert.equal(buildHeapMb(8 * GiB, 16 * GiB), 6144);
  assert.equal(buildHeapMb(undefined, 2 * GiB), 1536);
  assert.equal(buildHeapMb(undefined), 4096);
});

test("build defaults append to other Node options and retain explicit heap limits", () => {
  assert.equal(buildNodeOptions("--trace-warnings", 16 * GiB), "--trace-warnings --max-old-space-size=8192");
  for (const options of [
    "--max-old-space-size=4096", "--trace-warnings --max_old_space_size 6144",
    '"--max-old-space-size=8192" --trace-warnings',
    "--max-old-space-size-percentage=75",
  ]) assert.equal(buildNodeOptions(options, 16 * GiB), options);
});

test("heap options reach the build subprocess and exit 134 retains the previous build", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-build-memory-"));
  try {
    mkdirSync(path.join(root, "scripts"));
    mkdirSync(path.join(root, ".next-a"));
    writeFileSync(path.join(root, "tsconfig.json"), "{}");
    writeFileSync(path.join(root, ".next-a/BUILD_ID"), "previous");
    for (const name of ["build-production-slot.sh", "build-node-options.cjs"]) {
      copyFileSync(path.join(__dirname, "../scripts", name), path.join(root, "scripts", name));
    }
    const pnpm = path.join(root, "fake-pnpm");
    writeFileSync(pnpm, '#!/bin/sh\nprintf "%s" "$NODE_OPTIONS" > build-options.txt\nexit 134\n', { mode: 0o700 });
    const result = spawnSync("/bin/bash", [path.join(root, "scripts/build-production-slot.sh"), ".next-a"], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, AI_CHAT_ROOT: root, PNPM_BIN: pnpm, NODE_OPTIONS: "--trace-warnings" },
    });
    assert.equal(result.status, 134, result.stderr);
    assert.match(readFileSync(path.join(root, "build-options.txt"), "utf8"), /^--trace-warnings --max-old-space-size=\d+$/);
    assert.equal(readFileSync(path.join(root, ".next-a/BUILD_ID"), "utf8"), "previous");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
