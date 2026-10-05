import assert from "node:assert/strict";
import test, { mock } from "node:test";
import os from "node:os";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { hostUserFromInfo, windowsOsUserListScript } from "../lib/windows-os-users";

const dir = mkdtempSync(path.join(os.tmpdir(), "metis-windows-user-"));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "chat.sqlite");
process.env.AGENT_CWD = dir;
process.env.AI_CHAT_ROOT = dir;
delete process.env.METIS_DOCKER;
delete process.env.METIS_HOST_OS_USERNAME;
delete process.env.AI_CHAT_ALLOW_ROOT_AGENTS;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;

test("Windows user info omits POSIX sentinel IDs while Unix IDs remain intact", () => {
  assert.deepEqual(hostUserFromInfo({ username: "noah", uid: -1, gid: -1, homedir: "D:\\Profiles\\noah" }, "win32"),
    { username: "noah", home: "D:\\Profiles\\noah" });
  assert.deepEqual(hostUserFromInfo({ username: "noah", uid: 501, gid: 20, homedir: "/Users/noah" }, "darwin"),
    { username: "noah", uid: 501, gid: 20, home: "/Users/noah" });
});

test("Windows account creation binds only the first user by default and rolls back invalid setup", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  const userInfo = mock.method(os, "userInfo", () => ({ username: "hostowner", uid: -1, gid: -1,
    homedir: "D:\\Profiles\\hostowner", shell: null }));
  const commands: Array<{ command: string; args: readonly string[]; options: object }> = [];
  const exec = mock.method(childProcess, "execFileSync", (command: string, args: readonly string[], options: object) => {
    commands.push({ command, args, options });
    if (args.includes(windowsOsUserListScript)) return "installer\tD:\\Profiles\\actual-name\nalternate\tE:\\People\\alternate\n";
    return "";
  });
  syncBuiltinESMExports();
  try {
    const { createManagedUser, listAdminUsers } = await import("../lib/admin-users");
    const { getDatabase } = await import("../lib/sqlite");
    const { currentHostOsUser, inferOsUsernameForWorkspace, listHostOsUsers, getUserAccess,
      requireUserExecutionIdentity, ensureUserAccess } = await import("../lib/user-access");
    assert.equal(currentHostOsUser()?.uid, undefined);
    assert.equal(inferOsUsernameForWorkspace(), "hostowner");
    process.env.METIS_HOST_OS_USERNAME = "missing-installer";
    assert.equal(inferOsUsernameForWorkspace(), "hostowner");
    process.env.METIS_HOST_OS_USERNAME = "installer";
    assert.equal(inferOsUsernameForWorkspace(), "installer");
    assert.equal(listHostOsUsers().find((user) => user.username === "installer")?.home, "D:\\Profiles\\actual-name");

    assert.throws(() => createManagedUser({ username: "firstbad", password: "password1", osUsername: "missing" }), /does not exist/);
    assert.equal(listAdminUsers().length, 0, "failed OS mapping must not consume first-account setup");
    assert.equal((getDatabase().prepare("SELECT COUNT(*) AS count FROM user_model_permissions").get() as { count: number }).count, 0);
    const first = createManagedUser({ username: "webadmin", password: "password1" });
    assert.equal(first.isAdmin, true);
    assert.equal(first.osUsername, "installer");
    assert.equal(getUserAccess(first.id).uid, undefined);
    const identity = requireUserExecutionIdentity(first.id);
    assert.equal(identity.username, "installer");
    assert.equal(identity.home, "D:\\Profiles\\actual-name");
    assert.equal(identity.uid, undefined);

    const second = createManagedUser({ username: "another", password: "password1" });
    assert.equal(second.osUsername, undefined);
    assert.throws(() => requireUserExecutionIdentity(second.id), /no valid OS user mapping/);
    const explicit = createManagedUser({ username: "mapped", password: "password1", osUsername: "alternate" });
    assert.equal(requireUserExecutionIdentity(explicit.id).username, "alternate");

    // Old installs can have uid/gid=-1. Repair their numeric metadata without changing the OS account.
    getDatabase().prepare("UPDATE user_workspace_access SET uid=-1, gid=-1 WHERE user_id=?").run(explicit.id);
    assert.equal(requireUserExecutionIdentity(explicit.id).username, "alternate");
    assert.equal(getUserAccess(explicit.id).uid, undefined);
    ensureUserAccess(first.id, dir);
    assert.equal(requireUserExecutionIdentity(first.id).username, "installer", "repair missing first-account mapping");
    ensureUserAccess(explicit.id, dir, "hostowner");
    assert.equal(requireUserExecutionIdentity(explicit.id).username, "hostowner");
    getDatabase().prepare("UPDATE user_workspace_access SET os_username='missing-explicit' WHERE user_id=?").run(explicit.id);
    assert.throws(() => requireUserExecutionIdentity(explicit.id), /no valid OS user mapping/);
    assert.equal(getUserAccess(explicit.id).osUsername, "missing-explicit", "do not replace an explicit mapping");
    assert.ok(commands.length > 0);
    for (const call of commands) assert.equal((call.options as { windowsHide?: boolean }).windowsHide, true);
  } finally {
    delete process.env.METIS_HOST_OS_USERNAME;
    userInfo.mock.restore(); exec.mock.restore(); syncBuiltinESMExports();
    Object.defineProperty(process, "platform", platform);
  }
});

test("Windows discovery script uses SID profile paths and PowerShell 5.1-compatible CIM fallback", {
  skip: !process.env.METIS_TEST_PWSH,
}, () => {
  assert.doesNotMatch(windowsOsUserListScript, /\?\?|wmic|Users\\/);
  const command = `function Get-CimInstance { param($ClassName, $Filter)
    if ($ClassName -eq 'Win32_UserProfile') { [pscustomobject]@{ SID='S-1'; LocalPath='D:\\Actual Profile' } }
    else { [pscustomobject]@{ SID='S-1'; Name='alice' } }
  }
  function Get-LocalUser { throw 'Get-LocalUser unavailable in this PowerShell host' }
  ${windowsOsUserListScript}`;
  const output = childProcess.execFileSync(process.env.METIS_TEST_PWSH!, ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8" });
  assert.equal(output.trim(), "alice\tD:\\Actual Profile");
  const localCommand = command.replace("throw 'Get-LocalUser unavailable in this PowerShell host'",
    "[pscustomobject]@{ Name='alice'; SID=[pscustomobject]@{Value='S-1'}; Enabled=$true }; [pscustomobject]@{ Name='disabled'; SID=[pscustomobject]@{Value='S-2'}; Enabled=$false }");
  const localOutput = childProcess.execFileSync(process.env.METIS_TEST_PWSH!, ["-NoProfile", "-NonInteractive", "-Command", localCommand], { encoding: "utf8" });
  assert.equal(localOutput.trim(), "alice\tD:\\Actual Profile");
});
