import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pwsh = process.env.METIS_TEST_PWSH || (process.platform === "win32" ? "powershell.exe" : "");
for (const exitCode of [0, 7]) {
  test("Windows bootstrap preserves its caller session after installer exit " + exitCode, { skip: !pwsh }, () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "metis-bootstrap-"));
    try {
      const script = path.join(temp, "check.ps1");
      writeFileSync(script, `$ErrorActionPreference = "Stop"
$env:METIS_AI_INSTALL_BASE = "https://fixture.invalid/v1.2.3"
$script:downloads = @()
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, $Uri, $OutFile)
  $script:downloads += $OutFile
  Set-Content -LiteralPath $OutFile -Value "# test installer"
}
function powershell.exe {
  $global:LASTEXITCODE = ${exitCode}
}
$caught = $false
try {
  . '${root.replaceAll("'", "''")}/install.ps1' uninstall --yes
} catch {
  $caught = $true
  Write-Output $_.Exception.Message
}
if ($caught -ne $${exitCode !== 0 ? "true" : "false"}) { throw "Unexpected error result" }
if ($script:downloads.Count -ne 2) { throw "Uninstaller was not downloaded alongside installer" }
foreach ($file in $script:downloads) {
  if (Test-Path -LiteralPath $file) { throw "Temporary installer was not cleaned" }
}
Write-Output "CALLER_SESSION_ALIVE"
`);
      const result = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-File", script], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /CALLER_SESSION_ALIVE/);
      if (exitCode) assert.match(result.stdout, /installer failed \(exit 7\)/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
