import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { secureWindowsSetupToken } from "@/lib/setup-token-windows";
import { config } from "@/lib/config";
import { getDatabase, transaction } from "@/lib/sqlite";

const CONSUMED_KEY = "setup_token_consumed";
export const setupTokenFile = path.join(config.dataDir, "setup-token");

export function setupTokenConsumed() {
  return Boolean(getDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(CONSUMED_KEY));
}

export function consumeSetupToken() {
  getDatabase().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").run(CONSUMED_KEY);
}

function configuredToken() {
  const value = process.env.AI_CHAT_SETUP_TOKEN;
  if (value === undefined) return null;
  if (value.length < 32 || value.length > 1024 || value.trim() !== value) {
    throw new Error("AI_CHAT_SETUP_TOKEN must contain 32–1024 characters without surrounding whitespace.");
  }
  return value;
}

function fileToken() {
  const fd = openSync(setupTokenFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128 || (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600) ||
        (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Setup token file must be operator-owned with mode 0600.");
    }
    if (process.platform === "win32") secureWindowsSetupToken(setupTokenFile);
    const token = readFileSync(fd, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid setup token file.");
    return token;
  } finally { closeSync(fd); }
}

// Parent: call before opening the HTTP listener. Never log or return the secret.
export function initializeSetupToken() {
  return transaction(() => {
    // Consume on any first-account INSERT, in the same SQLite transaction.
    // This also covers other account-creation paths after startup.
    getDatabase().exec(`CREATE TRIGGER IF NOT EXISTS consume_initial_setup_token
      AFTER INSERT ON users BEGIN
        INSERT OR IGNORE INTO meta (key, value) VALUES ('setup_token_consumed', '1');
      END`);
    const count = Number((getDatabase().prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count);
    if (count > 0) consumeSetupToken();
    if (setupTokenConsumed()) {
      removeSetupTokenFile();
      return { required: false, tokenFile: null };
    }
    if (!configuredToken()) {
      mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
      let fd: number | undefined;
      try {
        fd = openSync(setupTokenFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        if (process.platform === "win32") secureWindowsSetupToken(setupTokenFile, true);
        else fchmodSync(fd, 0o600);
        writeFileSync(fd, randomBytes(32).toString("base64url") + "\n");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally { if (fd !== undefined) closeSync(fd); }
      fileToken();
    }
    return { required: true, tokenFile: configuredToken() ? null : setupTokenFile };
  });
}

export function validSetupToken(provided: unknown) {
  if (typeof provided !== "string" || provided.length > 1024 || setupTokenConsumed()) return false;
  let expected: string;
  try { expected = configuredToken() || fileToken(); } catch { return false; }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

export function removeSetupTokenFile() {
  try { unlinkSync(setupTokenFile); } catch { /* DB consumption remains authoritative; never reopen bootstrap. */ }
}
