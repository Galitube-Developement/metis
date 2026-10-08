import { mock } from "node:test";
import fs from "node:fs";
import os from "node:os";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

/** Virtual host only: no real account, ownership, ACL or production DB changes. */
export function isolationFixture(allowRoot = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-isolation-"));
  Object.assign(process.env, { CHAT_DATA_DIR: dir, CHAT_DB_PATH: path.join(dir, "chat.sqlite"),
    AI_CHAT_ROOT: dir, AI_CHAT_INSTALL_DIR: dir, AI_CHAT_MCP_STATE_DIR: path.join(dir, "mcp-state"),
    AGENT_CWD: "/root/virtual-metis", AI_CHAT_ALLOW_ROOT_AGENTS: String(allowRoot), METIS_DOCKER: "false" });
  delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
  delete process.env.CHAT_PASSWORD;
  delete process.env.METIS_AI_ADMIN_USERNAMES;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  const passwd = ["root:x:0:0:root:/root:/bin/bash", "alice:x:12001:12001::/isolated/alice:/bin/bash",
    "alias:x:12001:12001::/isolated/alias:/bin/bash", "bob:x:12002:12002::/isolated/bob:/bin/bash",
    "service:x:12003:12003::/service:/bin/bash"].join("\n");
  const originalExec = childProcess.execFileSync;
  const state = { sudoAllowed: false, groupIds: "12001", script: "", mode: 0o40700, owner: 12001, groups: "alice", probe: "ISOLATED", alias: "", probes: [] as Array<{ paths: string[]; codeDirectories: string[] }> };
  const originalRead = fs.readFileSync;
  const originalRealpath = fs.realpathSync;
  const originalStat = fs.statSync;
  const mocks = [
    mock.method(os, "userInfo", () => ({ username: "root", uid: 0, gid: 0, homedir: "/root", shell: "/bin/bash" })),
    mock.method(fs, "readFileSync", ((file: fs.PathOrFileDescriptor, ...args: unknown[]) =>
      file === "/etc/passwd" ? passwd : Reflect.apply(originalRead, fs, [file, ...args])) as typeof fs.readFileSync),
    mock.method(fs, "realpathSync", ((file: fs.PathLike, ...args: unknown[]) => String(file).startsWith("/isolated/")
      ? state.alias || String(file) : Reflect.apply(originalRealpath, fs, [file, ...args])) as typeof fs.realpathSync),
    mock.method(fs, "statSync", ((file: fs.PathLike, ...args: unknown[]) => String(file).startsWith("/isolated/")
      ? { uid: state.owner, mode: state.mode, isDirectory: () => true }
      : Reflect.apply(originalStat, fs, [file, ...args])) as typeof fs.statSync),
    mock.method(childProcess, "execFileSync", ((command: string, args: readonly string[]) => {
      if (command === "id") return args[0] === "-G" ? state.groupIds : state.groups;
      if (command === "sudo") {
        if (state.sudoAllowed) return "User alice may run commands";
        throw Object.assign(new Error("No sudo in virtual host"), { code: "ENOENT" });
      }
      if (command === process.execPath) { state.script = args[1]; state.probes.push(JSON.parse(args[2])); return state.probe; }
      throw new Error("Unexpected host command in isolated test");
    }) as typeof childProcess.execFileSync),
  ];
  syncBuiltinESMExports();
  return { dir, state, originalExec, restore() {
    for (const entry of mocks) entry.mock.restore();
    syncBuiltinESMExports(); Object.defineProperty(process, "platform", platform);
  } };
}
