import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExecutionUid,
  assertNonRootUid,
  isHostAdminUsername,
  isInsideWorkspace,
  isRootWorkspace,
  parsePasswdLine,
 parseMacOsUserLine,
 parseWindowsUserLine,
 hostPlatform,
  listAssignablePosixUsers,
} from "../lib/user-isolation";

test("workspace containment rejects path escape", () => {
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice"), true);
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice/project"), true);
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice/../alice/project"), true);
  assert.equal(isInsideWorkspace("/home/alice", "/home/bob"), false);
  assert.equal(isInsideWorkspace("/home/alice", "/root"), false);
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice/../bob"), false);
  assert.equal(isInsideWorkspace("/workspace", "/workspace/alice"), true);
  assert.equal(isInsideWorkspace("/workspace", "/home/alice"), false);
  assert.equal(isInsideWorkspace("/", "/"), true);
  assert.equal(isInsideWorkspace("/", "/home/alice"), true);
});

test("passwd parser extracts posix identity", () => {
  const parsed = parsePasswdLine("alice:x:1001:1001:Alice:/home/alice:/bin/bash");
  assert.deepEqual(parsed, {
    username: "alice",
    uid: 1001,
    gid: 1001,
    home: "/home/alice",
  });
  assert.equal(parsePasswdLine("root:x:0:0:root:/root:/bin/bash")?.uid, 0);
});

test("root uids are rejected for agent execution", () => {
  assert.throws(() => assertNonRootUid(0), /non-root/);
  assert.throws(() => assertNonRootUid(undefined), /non-root/);
  assert.doesNotThrow(() => assertNonRootUid(1000));
});

test("root execution requires explicit configuration and a root workspace", () => {
  assert.throws(() => assertExecutionUid(0), /explicitly configured/);
  assert.throws(() => assertExecutionUid(0, { allowRoot: true, workspaceRoot: "/home/alice" }), /explicitly configured/);
  assert.doesNotThrow(() => assertExecutionUid(0, { allowRoot: true, workspaceRoot: "/root/metis-ai" }));
  assert.doesNotThrow(() => assertExecutionUid(0, { allowRoot: true, workspaceRoot: "/" }));
  assert.throws(() => assertExecutionUid(0, { workspaceRoot: "/" }), /explicitly configured/);
  assert.equal(isRootWorkspace("/"), true);
  assert.equal(isRootWorkspace("/root/metis-ai"), true);
  assert.equal(isRootWorkspace("/home/alice"), false);
});

test("host admin usernames come from env or the first account", () => {
  assert.equal(isHostAdminUsername("f1shy312", { CHAT_USERNAME: "f1shy312" }), true);
  assert.equal(isHostAdminUsername("Trynocs", { CHAT_USERNAME: "f1shy312" }), false);
  assert.equal(
    isHostAdminUsername("ops", { METIS_AI_ADMIN_USERNAMES: "ops,other" }, "first"),
    true,
  );
  assert.equal(isHostAdminUsername("first", {}, "first"), true);
});

test("listAssignablePosixUsers keeps login shells and optional root", () => {
  const passwd = [
    "root:x:0:0:root:/root:/bin/bash",
    "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin",
    "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin",
    "alice:x:1001:1001:Alice:/home/alice:/bin/bash",
    "bob:x:1002:1002:Bob:/home/bob:/bin/false",
    "carol:x:1003:1003:Carol:/home/carol:/bin/zsh",
  ].join("\n");
  const regular = listAssignablePosixUsers(passwd);
  assert.deepEqual(regular.map((user) => user.username), ["alice", "carol"]);
  const withRoot = listAssignablePosixUsers(passwd, { includeRoot: true });
  assert.deepEqual(withRoot.map((user) => user.username), ["alice", "carol", "root"]);
});


test("host identity parsers preserve platform-specific identity fields", () => {
 assert.deepEqual(parseMacOsUserLine("alice 501"), { username: "alice", uid: 501, home: "" });
 assert.deepEqual(parseWindowsUserLine("alice\tC:\\Users\\alice"), { username: "alice", home: "C:\\Users\\alice" });
 assert.equal(hostPlatform("win32"), "win32");
 assert.equal(hostPlatform("darwin"), "darwin");
 assert.equal(hostPlatform("linux"), "linux");
});
