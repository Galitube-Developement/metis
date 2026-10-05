import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readCliVersion } from "../scripts/sync-provider-clis.mjs";

test("managed CLI version check runs npm shims in paths containing spaces and ampersands", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "metis CLI "));
  try {
    const dir = path.join(temp, "runtime & files");
    mkdirSync(dir);
    const win = process.platform === "win32";
    const executable = path.join(dir, win ? "codex.cmd" : "codex");
    writeFileSync(executable, win
      ? "@echo off\r\nif \"%~1\"==\"--version\" (echo codex 1.2.3) else (exit /b 7)\r\n"
      : '#!/bin/sh\n[ "$1" = "--version" ] || exit 7\necho "codex 1.2.3"\n', { mode: 0o755 });
    assert.equal(readCliVersion(executable), "codex 1.2.3");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
