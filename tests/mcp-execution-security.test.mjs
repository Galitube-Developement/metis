import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, chmodSync, chownSync, writeFileSync, symlinkSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolExecutionEnv } from "../lib/mcp-core/execution-env.mjs";

test("nonadmin tools inherit operational values without app secrets or shell injection env", () => {
  assert.deepEqual(toolExecutionEnv({
    PATH: "/usr/bin", LANG: "C", AI_CHAT_SECRETS_KEY: "synthetic",
    MCP_BEARER_TOKEN: "synthetic", CHAT_PASSWORD: "synthetic", BASH_ENV: "/synthetic/inject",
    NODE_OPTIONS: "--require=synthetic", METIS_PRIVATE_NETWORK_KEY: "synthetic",
  }, { home: "/synthetic/home", username: "synthetic" }, false), {
    PATH: "/usr/bin", LANG: "C", HOME: "/synthetic/home", USER: "synthetic", LOGNAME: "synthetic",
  });
});

test("real nonadmin gateway execution drops UID/groups/secrets and cannot edit a protected symlink", { skip: process.platform !== "linux" || process.getuid?.() !== 0 }, async () => {
  const fields = readFileSync("/etc/passwd", "utf8").split("\n").find((line) => line.startsWith("nobody:"))?.split(":");
  assert.ok(fields, "Linux fixture requires an existing unprivileged UID");
  const directory = mkdtempSync(path.join(os.tmpdir(), "metis-gateway-isolation-"));
  const workspace = path.join(directory, "workspace");
  const privateFile = path.join(directory, "private");
  chmodSync(directory, 0o711);
  mkdirSync(workspace, { mode: 0o700 });
  chownSync(workspace, Number(fields[2]), Number(fields[3]));
  writeFileSync(privateFile, "SYNTHETIC_PRIVATE", { mode: 0o600 });
  symlinkSync(privateFile, path.join(workspace, "link"));
  Object.assign(process.env, { AI_CHAT_ROOT: directory, AI_CHAT_MCP_STATE_DIR: path.join(directory, "mcp-state"),
    AI_CHAT_INTERNAL_ORIGIN: "http://127.0.0.1:1", MCP_BEARER_TOKEN: "synthetic-not-production",
    AI_CHAT_SECRETS_KEY: "synthetic-not-production", MCP_ALLOW_ROOT_AGENTS: "1", MCP_IS_HOST_ADMIN: "1",
    MCP_OS_UID: "0", MCP_OS_GID: "0", MCP_OS_USERNAME: "root", MCP_AGENT_CWD: "/root" });
  const { dispatchGatewayTool } = await import("../lib/mcp-core/gateway-core.mjs");
  const context = { userId: "synthetic", isHostAdmin: false, runtimeMode: "agent",
    uid: Number(fields[2]), gid: Number(fields[3]), osUsername: fields[0], home: workspace, workspaceRoot: workspace };
  const call = (name, args, extra = {}) => dispatchGatewayTool(name, args, { context: { ...context, ...extra }, auditCall: false });
  const text = (result) => result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || "";
  try {
    const command = await call("execute_command", { cwd: workspace, command:
      'id -u; id -G; if [ -n "$MCP_BEARER_TOKEN$AI_CHAT_SECRETS_KEY" ]; then echo SECRET_LEAK; else echo NO_SERVER_SECRETS; fi',
      timeout: 5 });
    assert.ok(!command.isError, text(command));
    const output = JSON.parse(text(command));
    assert.equal(output.exit_code, 0);
    const lines = output.stdout.trim().split("\n");
    assert.equal(Number(lines[0]), Number(fields[2]));
    assert.ok(!lines[1].split(" ").includes("0"), "supplementary root group must be removed");
    assert.match(output.stdout, /NO_SERVER_SECRETS/);
    assert.doesNotMatch(output.stdout, /SECRET_LEAK/);
    const edit = await call("edit_file", { path: path.join(workspace, "link"), oldText: "SYNTHETIC", newText: "CHANGED" });
    assert.equal(edit.isError, true, text(edit));
    assert.equal(readFileSync(privateFile, "utf8"), "SYNTHETIC_PRIVATE");
    for (const name of ["repo_search", "inspect_codebase", "find_symbol"]) {
      assert.equal((await call(name, { root: directory, query: "SYNTHETIC", symbol: "SYNTHETIC" })).isError, true);
    }
    // Legacy signed root claims cannot fall back to privileged environment.
    const stale = await call("execute_command", { cwd: "/root", command: "echo BAD", timeout: 5 },
      { uid: 0, gid: 0, allowRoot: true, workspaceRoot: "/root", home: "/root" });
    assert.equal(stale.isError, true);
    assert.match(text(stale), /OS user mapping/);
    const blockedAdmin = { uid: 0, gid: 0, isHostAdmin: true, allowRoot: false, workspaceRoot: "/root", home: "/root" };
    assert.equal((await call("execute_command", { cwd: "/root", command: "echo BAD", timeout: 5 }, blockedAdmin)).isError, true);
    assert.equal((await call("edit_file", { path: "/root/synthetic-unused", oldText: "a", newText: "b" }, blockedAdmin)).isError, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
