import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "install/linux.sh"), "utf8");
function body(name) {
  const start = source.indexOf(name + "() {");
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}
function fixture(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "metis-linux-ports-"));
  mkdirSync(path.join(dir, "bin"));
  const stub = (name, script) => writeFileSync(path.join(dir, "bin", name), "#!/bin/bash\n" + script, { mode: 0o755 });
  const exec = (script, env = {}) => spawnSync("/bin/bash", ["-c", script], {
    encoding: "utf8", env: { ...process.env, PATH: path.join(dir, "bin") + ":" + process.env.PATH, ...env },
  });
  try { run({ dir, stub, exec }); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("Linux rejects foreign listeners and identical ports before installation, allows its own upgrade", () => fixture(({ dir, stub, exec }) => {
  stub("docker", "exit 1\n");
  stub("ss", 'case "$*" in *"sport = :3100"*) echo \'LISTEN 0 511 127.0.0.1:3100 0.0.0.0:* users:(("python",pid=123,fd=3))\';; *"-ltn"*) echo "LISTEN 0 511 127.0.0.1:3100 0.0.0.0:*";; esac\n');
  stub("ps", 'printf "%s\\n" "$OWNER"\n');
  const script = 'die() { echo "$*" >&2; exit 1; }\ninstall_dir="' + dir + '"\n' +
    body("port_in_use") + "\n" + body("assert_available_ports") + "\nassert_available_ports 3100 8787\n";
  const foreign = exec(script, { OWNER: "openwebui" });
  assert.equal(foreign.status, 1);
  assert.match(foreign.stderr, /3100.*PID 123.*openwebui/);
  assert.equal(exec(script, { OWNER: "node " + dir + "/server.mjs" }).status, 0);
  assert.equal(exec(script, { OWNER: "node " + dir + "-other/server.mjs" }).status, 1);
  const equal = exec(script.replace("assert_available_ports 3100 8787", "assert_available_ports 3100 3100"));
  assert.equal(equal.status, 1);
  assert.match(equal.stderr, /must be different/);
}));
test("Linux health checks reject successful responses from foreign applications", () => fixture(({ stub, exec }) => {
  stub("curl", 'printf "%s" "$BODY"\n');
  stub("sleep", "exit 0\n");
  const script = body("wait_for_health") + '\nwait_for_health "$URL" 1\n';
  for (const URL of ["http://localhost:3100/api/status", "http://localhost:8787/health"]) {
    assert.equal(exec(script, { URL, BODY: '{"ok":true,"name":"OpenWebUI"}' }).status, 1);
  }
  assert.equal(exec(script, { URL: "http://localhost:3100/api/status",
    BODY: '{"authenticated":false,"worker":{},"mcp":{}}' }).status, 0);
  assert.equal(exec(script, { URL: "http://localhost:8787/health",
    BODY: '{"ok":true,"name":"Metis AI Universal MCP Gateway","endpoint":"/mcp"}' }).status, 0);
}));
test("Linux checks preserved ports and does not silently accept a foreign MCP health endpoint", () => fixture(({ dir, stub, exec }) => {
  writeFileSync(path.join(dir, "env"), "PORT=13100\nMCP_PORT=18787\n");
  stub("docker", "exit 1\n");
  stub("ss", 'case "$*" in *"sport = :18787"*) echo \'LISTEN 0 511 127.0.0.1:18787 0.0.0.0:* users:(("python",pid=456,fd=3))\';; *"-ltn"*) echo "LISTEN 0 511 127.0.0.1:18787 0.0.0.0:*";; esac\n');
  stub("ps", "echo openwebui\n");
  const script = 'die() { echo "$*" >&2; exit 1; }\ninstall_dir=/opt/metis\nread_env_key() { if [[ "$2" == PORT ]]; then echo 13100; else echo 18787; fi; }\n' +
    body("port_in_use") + "\n" + body("assert_available_ports") + "\n" + body("apply_merged_runtime_ports") +
    '\napply_merged_runtime_ports "' + path.join(dir, 'env') + '"\n';
  const result = exec(script);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /18787.*PID 456/);
}));

test("Linux forces production mode after preserving an older environment", () => fixture(({ dir, exec }) => {
  const envFile = path.join(dir, "env");
  writeFileSync(envFile, 'NODE_ENV="development"\nPORT="13100"\n');
  const script = body("write_env_line") + "\n" + body("upsert_env_key") + '\nupsert_env_key "' + envFile + '" NODE_ENV production\n. "' + envFile + '"\nprintf "%s" "$NODE_ENV"\n';
  const result = exec(script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "production");
}));
