import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mac = readFileSync(path.join(root, "install/macos.sh"), "utf8");
const windows = readFileSync(path.join(root, "install/windows.ps1"), "utf8");
const host = readFileSync(path.join(root, "install/windows-host.cs"), "utf8");
const pwsh = process.env.METIS_TEST_PWSH || (process.platform === "win32" ? "powershell.exe" : "");
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function functionBody(source, name) {
  const start = source.indexOf(name + "() {");
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}
function fixture(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "metis host test "));
  try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function stub(dir, name, body) {
  const bin = path.join(dir, "bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, name), "#!/bin/bash\n" + body, { mode: 0o755 });
}
function bash(dir, script, env = {}) {
  return spawnSync("/bin/bash", ["-c", script], {
    encoding: "utf8", env: { ...process.env, PATH: path.join(dir, "bin") + ":" + process.env.PATH, ...env },
  });
}

test("macOS rejects occupied web/MCP ports with owner details and preserves its own listeners", { skip: process.platform === "win32" }, () => fixture((dir) => {
  stub(dir, "lsof", 'case "$*" in *":3100"*) echo 123; exit 0;; *) exit 1;; esac\n');
  stub(dir, "docker", "exit 1\n");
  stub(dir, "ps", 'printf "%s\\n" "$TEST_OWNER"\n');
  const script = "die() { echo \"$*\" >&2; exit 1; }\ninstall_dir=" + shellQuote(dir) + "\n" +
    functionBody(mac, "port_in_use") + "\n" + functionBody(mac, "assert_available_ports") +
    '\nassert_available_ports 3100 8787\n';
  const foreign = bash(dir, script, { TEST_OWNER: "openwebui --port 3100" });
  assert.equal(foreign.status, 1); assert.match(foreign.stderr, /3100.*PID 123.*openwebui/);
  const own = bash(dir, script, { TEST_OWNER: "node " + dir + "/server.mjs" });
  assert.equal(own.status, 0, own.stderr);
  const otherInstall = bash(dir, script, { TEST_OWNER: "node " + dir + "-other/server.mjs" });
  assert.equal(otherInstall.status, 1);
  const equal = bash(dir, script.replace("assert_available_ports 3100 8787", "assert_available_ports 3100 3100"));
  assert.equal(equal.status, 1); assert.match(equal.stderr, /must be different/);
}));

test("macOS health checks reject foreign HTTP 200 payloads", { skip: process.platform === "win32" }, () => fixture((dir) => {
  stub(dir, "curl", 'printf "%s" "$TEST_BODY"\n'); stub(dir, "sleep", "exit 0\n");
  const script = functionBody(mac, "wait_for_health") + '\nwait_for_health "$TEST_URL" 1\n';
  for (const url of ["http://localhost:3100/api/status", "http://localhost:8787/health"]) {
    const result = bash(dir, script, { TEST_URL: url, TEST_BODY: '{"ok":true,"name":"OpenWebUI"}' });
    assert.equal(result.status, 1);
  }
  assert.equal(bash(dir, script, { TEST_URL: "http://localhost:3100/api/status",
    TEST_BODY: '{"authenticated":false,"worker":{"ok":true},"mcp":{"ok":true}}' }).status, 0);
  assert.equal(bash(dir, script, { TEST_URL: "http://localhost:8787/health",
    TEST_BODY: '{"ok":true,"name":"Metis AI Universal MCP Gateway","endpoint":"/mcp"}' }).status, 0);
}));

test("macOS application starts registered background services and opens the configured browser URL", { skip: process.platform === "win32" }, () => fixture((dir) => {
  writeFileSync(path.join(dir, ".env"), 'PORT=43123\nCHAT_DATA_DIR=' + shellQuote(dir) + '\n');
  stub(dir, "launchctl", 'echo "$*" >> "$TEST_CALLS"\nexit 0\n');
  stub(dir, "open", 'echo "open $*" >> "$TEST_CALLS"\n');
  stub(dir, "curl", 'echo \'{"authenticated":false,"worker":{"ok":true},"mcp":{"ok":true}}\'\n');
  const app = mac.split("cat <<'APP'\n")[1].split("\nAPP\n")[0];
  assert.ok(app);
  const calls = path.join(dir, "calls");
  const result = bash(dir, "ROOT=" + shellQuote(dir) + "\nSERVICE=metis-test\n" + app, { TEST_CALLS: calls });
  assert.equal(result.status, 0, result.stderr);
  const log = readFileSync(calls, "utf8");
  for (const name of ["app", "worker", "mcp"]) assert.match(log, new RegExp("kickstart.*metis-test-" + name));
  assert.match(log, /open http:\/\/127\.0\.0\.1:43123/);
}));

test("Windows standalone installer embeds the complete maintained GUI host source", () => {
  const embedded = windows.split("@'\n")[1].split("'@ | Set-Content")[0];
  assert.equal(embedded, host);
  assert.match(host, /CreateNoWindow = true/);
  assert.match(host, /UseShellExecute = false/);
  assert.match(host, /new Mutex/);
  assert.match(host, /HasExited/);
  assert.match(host, /--import tsx/);
  assert.match(windows, /target:winexe/);
  assert.match(windows, /CreateShortcut/);
  assert.match(windows, /UninstallString/);
  assert.doesNotMatch(windows, /run-\$suffix\.cmd/);
});

test("PowerShell installers parse and dry-run without account prompts", { skip: !pwsh }, () => fixture((dir) => {
  const script = path.join(dir, "check.ps1");
  writeFileSync(script, `$ErrorActionPreference = "Stop"
foreach ($file in @("install/windows.ps1", "install/uninstall.ps1", "install.ps1")) {
  $tokens = $null; $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path '${root}' $file), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw ($errors | Out-String) }
}
& '${root}/install/windows.ps1' -NonInteractive -DryRun -InstallDir '${dir}'
`);
  const output = execFileSync(pwsh, ["-NoProfile", "-File", script], { encoding: "utf8" });
  assert.match(output, /Dry run; no files or services/);
  assert.match(output, /native:/);
  assert.equal(existsSync(path.join(dir, ".env")), false);
}));

test("Windows port preflight checks real bind failures, invalid ports, and process ownership", { skip: !pwsh }, () => fixture((dir) => {
  const start = windows.indexOf("function Assert-AvailablePorts");
  const fn = windows.slice(start, windows.indexOf("\n$script:ReplaceDataStash", start));
  const script = path.join(dir, "ports.ps1");
  writeFileSync(script, `$ErrorActionPreference = "Stop"
$InstallDir = '${dir}'
${fn}
function Test-OwnedDockerPort { return $false }
function Get-NetTCPConnection { return @() }
function Get-CimInstance { return $null }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, 0)
$listener.Start()
$busy = $listener.LocalEndpoint.Port.ToString()
try {
  try { Assert-AvailablePorts $busy '8787'; throw 'Unexpected acceptance' }
  catch { if ($_.Exception.Message -notmatch 'cannot be bound') { throw } }
} finally { $listener.Stop() }
try { Assert-AvailablePorts '3100' '3100'; throw 'Unexpected acceptance' }
catch { if ($_.Exception.Message -notmatch 'must be different') { throw } }
try { Assert-AvailablePorts '70000' '8787'; throw 'Unexpected acceptance' }
catch { if ($_.Exception.Message -notmatch 'between 1 and 65535') { throw } }
function Get-NetTCPConnection { return @([pscustomobject]@{ OwningProcess = 42 }) }
$script:owner = [pscustomobject]@{ Name = 'openwebui'; CommandLine = 'openwebui'; ParentProcessId = 0 }
function Get-CimInstance { return $script:owner }
try { Assert-AvailablePorts '3100' '8787'; throw 'Unexpected acceptance' }
catch { if ($_.Exception.Message -notmatch 'occupied by openwebui.*PID 42') { throw } }
$script:owner = [pscustomobject]@{ Name = 'node'; CommandLine = "node $InstallDir/server.mjs"; ParentProcessId = 0 }
Assert-AvailablePorts '3100' '8787'
"WINDOWS_PORT_CHECKS_OK"
`);
  const output = execFileSync(pwsh, ["-NoProfile", "-File", script], { encoding: "utf8" });
  assert.match(output, /WINDOWS_PORT_CHECKS_OK/);
}));

test("C# host compiles and rejects a real occupied TCP port", { skip: !pwsh || process.platform === "win32" }, () => fixture((dir) => {
  // Linux compile harness supplies only the unavailable Windows dialog types.
  // Real Windows GUI, registration and sign-in behavior require a Windows smoke test.
  const script = path.join(dir, "host.ps1");
  const stubSource = '\nnamespace System.Windows.Forms { public enum MessageBoxButtons { OK } public enum MessageBoxIcon { Error } public static class MessageBox { public static void Show(string a, string b, MessageBoxButtons c, MessageBoxIcon d) {} } }';
  const source = host + stubSource;
  writeFileSync(script, `$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
${source}
'@ -IgnoreWarnings -WarningAction SilentlyContinue
$type = [System.Windows.Forms.MessageBox].Assembly.GetType("MetisHost")
$flags = [Reflection.BindingFlags]'NonPublic,Static'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, 0)
$listener.Start()
[Environment]::SetEnvironmentVariable("METIS_TEST_BUSY_PORT", $listener.LocalEndpoint.Port.ToString())
try {
  try { $type.GetMethod("CheckPort", $flags).Invoke($null, @("METIS_TEST_BUSY_PORT", "3100")); throw "Unexpected acceptance" }
  catch { if ($_.Exception.ToString() -notmatch "occupied or unavailable") { throw } }
} finally { $listener.Stop() }
"C_SHARP_HOST_COMPILES"
`);
  const output = execFileSync(pwsh, ["-NoProfile", "-File", script], { encoding: "utf8" });
  assert.match(output, /C_SHARP_HOST_COMPILES/);
}));
