import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDirectExecution } from "../lib/mcp-core/entrypoint.mjs";

test("CLI entrypoint recognizes native paths with spaces and rejects another module", () => {
  const dir = mkdtempSync(join(tmpdir(), "metis entrypoint "));
  try {
    const entry = join(dir, "gateway entry.mjs");
    const other = join(dir, "other.mjs");
    writeFileSync(entry, ""); writeFileSync(other, "");
    const url = pathToFileURL(entry).href;
    assert.equal(isDirectExecution(url, entry), true);
    assert.equal(isDirectExecution(url, other), false);
    assert.equal(isDirectExecution(url, ""), false);
    assert.equal(isDirectExecution(url, join(dir, "missing.mjs")), false);
    if (process.platform !== "win32") {
      const alias = join(dir, "alias.mjs"); symlinkSync(entry, alias);
      assert.equal(isDirectExecution(url, alias), true);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
