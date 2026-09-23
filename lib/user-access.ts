import path from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { getDatabase } from "@/lib/sqlite";
import { config } from "@/lib/config";
import {
  assertExecutionUid,
 hostPlatform,
  isHostAdminUsername,
  isInsideWorkspace,
  isRootWorkspace,
  listAssignablePosixUsers,
 parseMacOsUserLine,
 parseWindowsUserLine,
  parsePasswdLine,
  type HostOsUser,
 type PosixIdentity,
} from "@/lib/user-isolation";

export type UserAccess = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
  home?: string;
};

export type UserExecutionIdentity = {
  username: string;
  uid?: number;
  gid?: number;
  home?: string;
  workspaceRoot: string;
};

type AccessRow = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
};

type UserRow = {
  id: string;
  username: string;
  isAdmin?: number;
};

export function lookupPosixUser(username: string): PosixIdentity | undefined {
  try {
    const line = readFileSync("/etc/passwd", "utf8").split("\n").find((entry) =>
      entry.split(":")[0]?.toLowerCase() === username.toLowerCase());
    return line ? parsePasswdLine(line) : undefined;
  } catch {
    return undefined;
  }
}

export function currentHostOsUser(): HostOsUser | undefined {
  try {
    const current = os.userInfo();
    return {
      username: current.username,
      uid: current.uid,
      gid: current.gid,
      home: current.homedir,
    };
  } catch {
    return undefined;
  }
}

function hostOsUserMatches(user: HostOsUser, username: string) {
  return user.username.toLowerCase() === username.trim().toLowerCase();
}

export function lookupHostOsUser(username: string): HostOsUser | undefined {
  const clean = username.trim();
  if (!clean) return undefined;
  const listed = listHostOsUsers().find((user) => hostOsUserMatches(user, clean));
  if (listed) return listed;
  const current = currentHostOsUser();
  if (current && hostOsUserMatches(current, clean)) return current;
  const platform = hostPlatform();
  if (platform === "linux") {
    const posix = lookupPosixUser(clean);
    return posix ? { username: posix.username, uid: posix.uid, gid: posix.gid, home: posix.home } : undefined;
  }
  if (platform === "darwin") {
    const uid = Number(runHostCommand("id", ["-u", clean]).trim());
    if (!Number.isInteger(uid)) return undefined;
    const gid = Number(runHostCommand("id", ["-g", clean]).trim());
    const home = runHostCommand("dscl", [".", "-read", `/Users/${clean}`, "NFSHomeDirectory"]).match(/NFSHomeDirectory:\s+(.+)/)?.[1]?.trim()
      || `/Users/${clean}`;
    return { username: clean, uid, gid: Number.isInteger(gid) ? gid : undefined, home };
  }
  const named = runHostCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-LocalUser -Name ${JSON.stringify(clean)} | ForEach-Object { $_.Name }`,
  ]).trim().split("\n").map((line) => line.trim()).find(Boolean);
  return named ? { username: named, home: "" } : undefined;
}

function runHostCommand(command: string, args: string[]) {
 try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
 catch { return ""; }
}

function listMacOsUsers(): HostOsUser[] {
 const current = os.userInfo().username;
 const listed = runHostCommand("dscl", [".", "-list", "/Users", "UniqueID"]);
 return listed.split("\n").map(parseMacOsUserLine).filter((user): user is HostOsUser => Boolean(user))
 .filter((user) => ((user.uid !== undefined && user.uid >= 501) || user.username === current) && !["daemon", "nobody"].includes(user.username.toLowerCase()))
 .map((user) => ({ ...user, home: runHostCommand("dscl", [".", "-read", `/Users/${user.username}`, "NFSHomeDirectory"]).match(/NFSHomeDirectory:\s+(.+)/)?.[1]?.trim() || `/Users/${user.username}` }))
 .sort((a, b) => a.username.localeCompare(b.username));
}

function listWindowsUsers(): HostOsUser[] {
 const script = "$profiles = @{}; Get-CimInstance Win32_UserProfile | ForEach-Object { if ($_.LocalPath) { $profiles[$_.SID] = $_.LocalPath } }; Get-LocalUser | ForEach-Object { Write-Output ($_.Name + [char]9 + ($profiles[$_.SID] ?? (Join-Path $env:SystemDrive (\"Users\\\" + $_.Name)))) }";
 const listed = runHostCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
 let users = listed.split("\n").map(parseWindowsUserLine).filter((user): user is HostOsUser => Boolean(user));
 if (users.length === 0) {
 const fallback = runHostCommand("wmic.exe", ["useraccount", "get", "name"]);
 users = fallback.split("\n").map((line) => ({ username: line.trim(), home: "" })).filter((user) => Boolean(user.username));
 }
 return users.sort((a, b) => a.username.localeCompare(b.username));
}

export function listHostOsUsers(platform = hostPlatform()): HostOsUser[] {
  let users: HostOsUser[] = [];
  if (platform === "darwin") users = listMacOsUsers();
  else if (platform === "win32") users = listWindowsUsers();
  else {
    try {
      users = listAssignablePosixUsers(readFileSync("/etc/passwd", "utf8"), { includeRoot: config.allowRootAgents });
    } catch {
      users = [];
    }
  }
  const current = currentHostOsUser();
  if (
    current
    && !users.some((user) => hostOsUserMatches(user, current.username))
    && (platform === "win32" || (current.uid !== undefined && current.uid > 0) || config.allowRootAgents)
  ) {
    users = [...users, current].sort((a, b) => a.username.localeCompare(b.username));
  }
  return users;
}
export function getUserAccess(userId?: string): UserAccess {
  if (!userId?.trim()) return { userId: "", workspaceRoot: path.resolve(config.agentCwd) };
  const row = getDatabase().prepare(
    `SELECT user_id AS userId, workspace_root AS workspaceRoot,
            os_username AS osUsername, uid, gid
     FROM user_workspace_access WHERE user_id = ?`,
  ).get(userId.trim()) as AccessRow | undefined;
  if (row?.workspaceRoot) {
    const posix = row.osUsername ? lookupHostOsUser(row.osUsername) : undefined;
    return {
      ...row,
      workspaceRoot: path.resolve(row.workspaceRoot),
      ...(typeof row.uid === "number" ? { uid: row.uid } : posix ? { uid: posix.uid } : {}),
      ...(typeof row.gid === "number" ? { gid: row.gid } : posix ? { gid: posix.gid } : {}),
      ...(posix?.home ? { home: posix.home } : {}),
    };
  }
  return { userId: userId.trim(), workspaceRoot: path.resolve(config.agentCwd) };
}

export function getUserExecutionIdentity(userId?: string): UserExecutionIdentity | undefined {
  const access = getUserAccess(userId);
  if (!access.osUsername && config.allowRootAgents && isRootWorkspace(access.workspaceRoot)) {
    return {
      username: "root",
      uid: 0,
      gid: 0,
      home: "/root",
      workspaceRoot: access.workspaceRoot,
    };
  }
  if (!access.osUsername) return undefined;
  const posix = lookupHostOsUser(access.osUsername);
  const uid = access.uid ?? posix?.uid;
  const gid = access.gid ?? posix?.gid;
  if (uid === 0 && config.allowRootAgents && isRootWorkspace(access.workspaceRoot, posix?.home || access.home)) {
    return {
      username: access.osUsername,
      uid,
      gid: gid ?? 0,
      home: posix?.home || access.home,
      workspaceRoot: access.workspaceRoot,
    };
  }
 if (hostPlatform() === "win32") return { username: access.osUsername, home: posix?.home || access.home, workspaceRoot: access.workspaceRoot };
 if (uid === undefined || gid === undefined || uid <= 0) return undefined;
 return {
    username: access.osUsername,
    uid,
    gid,
    home: posix?.home || access.home,
    workspaceRoot: access.workspaceRoot,
  };
}

export function requireUserExecutionIdentity(userId?: string): UserExecutionIdentity {
  if (config.docker) {
    const access = getUserAccess(userId);
    return {
      username: process.env.USER?.trim() || "metis",
      uid: process.getuid?.() ?? 1000,
      gid: process.getgid?.() ?? 1000,
      home: process.env.HOME || config.dockerWorkspace,
      workspaceRoot: access.workspaceRoot,
    };
  }
  const account = userId
    ? getDatabase().prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username?: string } | undefined
    : undefined;
  if (account?.username) {
    provisionMissingAccountAccess(userId!, account.username);
  }
  const identity = getUserExecutionIdentity(userId);
  if (!identity) {
    throw new Error("This account has no valid OS user mapping. Provision a workspace with scripts/provision-user.ts.");
  }
 if (identity.uid !== undefined) assertExecutionUid(identity.uid, {
    allowRoot: config.allowRootAgents,
    workspaceRoot: identity.workspaceRoot,
    home: identity.home,
  });
  return identity;
}

export function adminUserCount() {
  return Number(
    (getDatabase().prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1").get() as { count: number }).count,
  );
}

export function isHostAdmin(userId?: string | null) {
  if (!userId?.trim()) return false;
  const user = getDatabase().prepare(
    "SELECT id, username, is_admin AS isAdmin FROM users WHERE id = ?",
  ).get(userId.trim()) as UserRow | undefined;
  if (!user?.username) return false;
  if (Number(user.isAdmin) === 1) return true;
  if (isHostAdminUsername(user.username, process.env)) return true;
  const first = getDatabase().prepare(
    "SELECT username FROM users ORDER BY created_at ASC LIMIT 1",
  ).get() as { username?: string } | undefined;
  return isHostAdminUsername(user.username, {}, first?.username);
}

export function inferOsUsernameForWorkspace(workspaceRoot = config.agentCwd): string | undefined {
  const current = currentHostOsUser();
  if (!current?.username) return undefined;
  if (hostPlatform() === "win32") return current.username;
  if (current.uid === 0) {
    if (config.allowRootAgents && isRootWorkspace(workspaceRoot, current.home || "/root")) {
      return current.username;
    }
    return undefined;
  }
  if (current.uid !== undefined && current.uid > 0) return current.username;
  return undefined;
}

export function resolveManagedWorkspaceRoot(workspaceRoot?: string | null) {
  const resolved = path.resolve((workspaceRoot || "").trim() || config.agentCwd);
  if (!path.isAbsolute(resolved) || resolved === path.sep) {
    throw new Error("Workspace path must be an absolute directory.");
  }
  if (config.docker && !isInsideWorkspace(config.dockerWorkspace, resolved)) {
    throw new Error(`Docker workspaces must be inside ${config.dockerWorkspace}.`);
  }
  return resolved;
}

export function ensureUserAccess(
  userId: string,
  workspaceRoot: string,
  osUsername?: string,
) {
  const identity = osUsername ? lookupHostOsUser(osUsername) : undefined;
  if (osUsername && !identity) {
    throw new Error(`OS user ${osUsername} does not exist on this host.`);
  }
  if (identity?.uid !== undefined) {
    assertExecutionUid(identity.uid, {
      allowRoot: config.allowRootAgents,
      workspaceRoot,
      home: identity.home,
    });
  }
  getDatabase().prepare(
    `INSERT INTO user_workspace_access
       (user_id, workspace_root, os_username, uid, gid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       workspace_root = excluded.workspace_root,
       os_username = excluded.os_username,
       uid = excluded.uid,
       gid = excluded.gid,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    path.resolve(workspaceRoot),
    osUsername ?? null,
    identity?.uid ?? null,
    identity?.gid ?? null,
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

export function provisionAccountAccess(userId: string, username: string) {
  const posix = lookupHostOsUser(username);
  if (!posix || (hostPlatform() !== "win32" && (posix.uid === undefined || posix.uid <= 0))) return false;
  const workspace = posix.home && posix.home !== "/" && posix.home !== "/root"
    ? posix.home
    : path.join("/home", username);
  ensureUserAccess(userId, workspace, username);
  return true;
}

/**
 * Repairs access created by older account flows without requiring a shell
 * command. Root is only selected for an explicitly allowed /root workspace;
 * otherwise an identically named non-root OS account is used when available.
 */
export function provisionMissingAccountAccess(userId: string, username: string) {
  const access = getUserAccess(userId);
  const current = access.osUsername ? lookupHostOsUser(access.osUsername) : undefined;
  if (current && (hostPlatform() === "win32" || (current.uid !== undefined && current.uid > 0) || (config.allowRootAgents && isRootWorkspace(access.workspaceRoot, current.home)))) {
    return true;
  }

  if (config.allowRootAgents && isRootWorkspace(access.workspaceRoot)) {
    ensureUserAccess(userId, access.workspaceRoot, "root");
    return true;
  }

  const matching = lookupHostOsUser(username);
  if (matching && (hostPlatform() === "win32" || (matching.uid !== undefined && matching.uid > 0))) {
    ensureUserAccess(userId, access.workspaceRoot, matching.username);
    return true;
  }
  const inferred = inferOsUsernameForWorkspace(access.workspaceRoot);
  if (inferred) {
    ensureUserAccess(userId, access.workspaceRoot, inferred);
    return true;
  }
  return false;
}
