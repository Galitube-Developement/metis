import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const pwsh = process.env.METIS_TEST_PWSH || (process.platform === "win32" ? "powershell.exe" : "");
for (const name of ["windows.ps1", "uninstall.ps1"]) {
  test(name + " cleanup matches directory boundaries and short-path aliases", { skip: !pwsh }, () => {
    const source = readFileSync(new URL("../install/" + name, import.meta.url), "utf8");
    const start = source.indexOf("function Test-InstallProcess(");
    assert.ok(start >= 0);
    const fn = source.slice(start, source.indexOf("\n}\n", start) + 3);
    const temp = mkdtempSync(path.join(os.tmpdir(), "metis-cleanup-scope-"));
    try {
      const script = path.join(temp, "check.ps1");
      writeFileSync(script, fn + `
$roots = @('C:\\Users\\Noah\\metis-ai-e2e', 'C:\\Users\\NOAH~1\\metis-ai-e2e')
$own = [pscustomobject]@{Name='node.exe'; CommandLine='node C:\\Users\\NOAH~1\\metis-ai-e2e\\worker.ts'}
$sibling = [pscustomobject]@{Name='node.exe'; CommandLine='node C:\\Users\\Noah\\metis-ai-e2e-2\\worker.ts'}
$live = [pscustomobject]@{Name='node.exe'; CommandLine='node C:\\Users\\Noah\\metis-ai\\remote-client\\client.mjs'}
$esbuild = [pscustomobject]@{Name='esbuild.exe'; ExecutablePath='C:\\Users\\Noah\\metis-ai-e2e\\node_modules\\esbuild.exe'}
if (-not (Test-InstallProcess $own $roots)) { throw "Short-path child missed" }
if (Test-InstallProcess $sibling $roots) { throw "Sibling installation matched" }
if (Test-InstallProcess $live $roots) { throw "Production client matched" }
if (-not (Test-InstallProcess $esbuild $roots)) { throw "Owned helper missed" }
Write-Output "ISOLATED_PROCESS_MATCH_OK"
`);
      const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", script], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /ISOLATED_PROCESS_MATCH_OK/);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
}
