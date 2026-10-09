import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { config } from "@/lib/config";
import { ensureAllModelAccess } from "@/lib/model-access";
import { ensureUserAccess, getUserAccess, inferOsUsernameForWorkspace, resolveManagedWorkspaceRoot } from "@/lib/user-access";
import { consumeSetupToken, removeSetupTokenFile, setupTokenConsumed, validSetupToken } from "@/lib/setup-token";
import { getDatabase, transaction } from "@/lib/sqlite";
import { listChatProviderConnections } from "@/lib/provider-connections";

const SETUP_META_KEY = "setup_complete";

export type SetupStatus = {
  needed: boolean;
  hasUsers: boolean;
  setupComplete: boolean;
  hasProvider: boolean;
};

function userCount() {
  return Number((getDatabase().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count);
}

function metaValue(key: string) {
  const row = getDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

export function isSetupComplete() {
  const flagged = metaValue(SETUP_META_KEY);
  if (flagged === "1") return true;
  if (flagged === "0") return false;
  // Existing installs already have users; do not lock the owner behind first-run.
  return userCount() > 0;
}

export function markSetupComplete() {
  getDatabase().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(SETUP_META_KEY, "1");
}

export function markSetupIncomplete() {
  getDatabase().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(SETUP_META_KEY, "0");
}

export function getSetupStatus(ownerId?: string): SetupStatus {
  const hasUsers = userCount() > 0;
  const setupComplete = isSetupComplete();
  const hasProvider = ownerId
    ? listChatProviderConnections(ownerId, false).length > 0
    : false;
  return {
    hasUsers,
    setupComplete,
    hasProvider,
    needed: !setupComplete,
  };
}


// This transaction includes the empty-DB check, account creation and token
// consumption. BEGIN IMMEDIATE serializes bootstrap across processes.
export class SetupBootstrapError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function bootstrapSetupAccount(input: {
  setupToken?: unknown; username: string; password: string; osUsername?: string;
}) {
  const user = transaction(() => {
    if (userCount() > 0 || setupTokenConsumed()) {
      throw new SetupBootstrapError("Setup already has an account or its token has been consumed.", 409);
    }
    if (!validSetupToken(input.setupToken)) {
      throw new SetupBootstrapError("A valid operator setup token is required.", 403);
    }
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || input.password.length < 8) {
      throw new SetupBootstrapError("Invalid username or password too short.", 400);
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = salt + ":" + pbkdf2Sync(input.password, salt, 120_000, 32, "sha256").toString("hex");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const workspace = resolveManagedWorkspaceRoot(config.agentCwd);
    const osUsername = input.osUsername?.trim() || inferOsUsernameForWorkspace(workspace);
    getDatabase().prepare("INSERT INTO users (id, username, password_hash, created_at, is_admin) VALUES (?, ?, ?, ?, 1)")
      .run(id, username, passwordHash, createdAt);
    ensureAllModelAccess(id);
    ensureUserAccess(id, workspace, osUsername || undefined);
    consumeSetupToken();
    markSetupIncomplete();
    const access = getUserAccess(id);
    return { id, username, createdAt, isAdmin: true, workspaceRoot: access.workspaceRoot,
      ...(access.osUsername ? { osUsername: access.osUsername } : {}) };
  });
  removeSetupTokenFile();
  return user;
}
