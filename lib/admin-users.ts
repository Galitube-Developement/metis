import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { ensureAllModelAccess } from "@/lib/model-access";
import { getDatabase } from "@/lib/sqlite";
import { config } from "@/lib/config";
import {
  adminUserCount,
  ensureUserAccess,
  getUserAccess,
  inferOsUsernameForWorkspace,
  resolveManagedWorkspaceRoot,
} from "@/lib/user-access";

export type AdminUserRecord = {
  id: string;
  username: string;
  createdAt: string;
  isAdmin: boolean;
  workspaceRoot: string;
  osUsername?: string;
};

type UserRow = {
  id: string;
  username: string;
  createdAt: string;
  isAdmin: number;
};

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex")}`;
}

function toRecord(row: UserRow): AdminUserRecord {
  const access = getUserAccess(row.id);
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
    isAdmin: Number(row.isAdmin) === 1,
    workspaceRoot: access.workspaceRoot,
    ...(access.osUsername ? { osUsername: access.osUsername } : {}),
  };
}

function userRow(id: string) {
  return getDatabase().prepare(
    `SELECT id, username, created_at AS createdAt, is_admin AS isAdmin
     FROM users WHERE id = ?`,
  ).get(id) as UserRow | undefined;
}

export function listAdminUsers(): AdminUserRecord[] {
  const rows = getDatabase().prepare(
    `SELECT id, username, created_at AS createdAt, is_admin AS isAdmin
     FROM users ORDER BY created_at ASC`,
  ).all() as UserRow[];
  return rows.map(toRecord);
}

export function createManagedUser(input: {
  username: string;
  password: string;
  workspaceRoot?: string;
  isAdmin?: boolean;
  osUsername?: string;
}) {
  const clean = input.username.trim();
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(clean) || input.password.length < 8) {
    throw new Error("Invalid username or password too short.");
  }
  const existing = Number(
    (getDatabase().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count,
  );
  const isAdmin = existing === 0 ? 1 : input.isAdmin ? 1 : 0;
  const user = {
    id: randomUUID(),
    username: clean,
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  try {
    getDatabase().prepare(
      "INSERT INTO users (id, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)",
    ).run(user.id, user.username, user.passwordHash, user.createdAt, isAdmin);
  } catch {
    throw new Error("Username is already taken.");
  }
  ensureAllModelAccess(user.id);
  const workspace = resolveManagedWorkspaceRoot(input.workspaceRoot || config.agentCwd);
  const osUsername = input.osUsername?.trim() || (existing === 0 ? inferOsUsernameForWorkspace(workspace) : undefined);
  ensureUserAccess(user.id, workspace, osUsername || undefined);
  const created = userRow(user.id);
  if (!created) throw new Error("Could not create user.");
  return toRecord(created);
}

export function patchManagedUser(
  id: string,
  input: {
    workspaceRoot?: string;
    password?: string;
    isAdmin?: boolean;
    osUsername?: string | null;
    actorUserId?: string;
  },
) {
  const current = userRow(id);
  if (!current) throw new Error("User not found.");
  if (typeof input.isAdmin === "boolean") {
    if (!input.isAdmin && Number(current.isAdmin) === 1 && adminUserCount() <= 1) {
      throw new Error("The last admin cannot be demoted.");
    }
    getDatabase().prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(input.isAdmin ? 1 : 0, id);
  }
  if (typeof input.password === "string") {
    if (input.password.length < 8) throw new Error("Password must contain at least 8 characters.");
    getDatabase().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(input.password), id);
  }
  if (typeof input.workspaceRoot === "string" || input.osUsername !== undefined) {
    const access = getUserAccess(id);
    const workspace = resolveManagedWorkspaceRoot(input.workspaceRoot ?? access.workspaceRoot);
    const osUsername = input.osUsername === undefined
      ? access.osUsername
      : input.osUsername?.trim() || undefined;
    ensureUserAccess(id, workspace, osUsername);
  }
  const next = userRow(id);
  if (!next) throw new Error("User not found.");
  return toRecord(next);
}

export function deleteManagedUser(id: string, actorUserId: string) {
  if (id === actorUserId) throw new Error("You cannot delete your own account.");
  const current = userRow(id);
  if (!current) throw new Error("User not found.");
  if (Number(current.isAdmin) === 1 && adminUserCount() <= 1) {
    throw new Error("The last admin cannot be deleted.");
  }
  getDatabase().prepare("DELETE FROM users WHERE id = ?").run(id);
}
