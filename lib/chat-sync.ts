import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { databasePath, getDatabase } from "@/lib/sqlite";

export type ChatSyncEventKind = "created" | "updated" | "deleted";

export type ChatSyncEvent = {
  id: number;
  ownerId: string;
  chatId: string;
  kind: ChatSyncEventKind;
  chatUpdatedAt: string;
  createdAt: string;
};

type DatabaseWatchState = {
  listeners: Set<() => void>;
  watcher: FSWatcher | null;
  restartTimer: NodeJS.Timeout | null;
};

const globalKey = Symbol.for("metis.chat-sync.database-watch");
const globalState = globalThis as typeof globalThis & {
  [globalKey]?: DatabaseWatchState;
};
const watchState = globalState[globalKey] ?? {
  listeners: new Set<() => void>(),
  watcher: null,
  restartTimer: null,
};
globalState[globalKey] = watchState;

let lastCleanupAt = 0;

function emitDatabaseChange() {
  for (const listener of watchState.listeners) listener();
}

function scheduleWatcherRestart() {
  if (!watchState.listeners.size || watchState.restartTimer) return;
  watchState.restartTimer = setTimeout(() => {
    watchState.restartTimer = null;
    ensureDatabaseWatcher();
  }, 1_000);
  watchState.restartTimer.unref?.();
}

function ensureDatabaseWatcher() {
  if (watchState.watcher || !watchState.listeners.size) return;
  const directory = path.dirname(databasePath);
  const databaseName = path.basename(databasePath);
  try {
    const watcher = watch(directory, { persistent: false }, (_event, filename) => {
      const changed = filename?.toString() || "";
      if (!changed || changed === databaseName || changed.startsWith(`${databaseName}-`)) {
        emitDatabaseChange();
      }
    });
    watcher.on("error", () => {
      if (watchState.watcher === watcher) watchState.watcher = null;
      try { watcher.close(); } catch { /* already closed */ }
      scheduleWatcherRestart();
    });
    watchState.watcher = watcher;
  } catch {
    scheduleWatcherRestart();
  }
}

export function subscribeToDatabaseChanges(listener: () => void) {
  watchState.listeners.add(listener);
  ensureDatabaseWatcher();
  return () => {
    watchState.listeners.delete(listener);
    if (watchState.listeners.size || !watchState.watcher) return;
    try { watchState.watcher.close(); } catch { /* already closed */ }
    watchState.watcher = null;
  };
}

function notifyDatabaseChangeSoon() {
  queueMicrotask(emitDatabaseChange);
}

export function recordChatSyncEvent(input: {
  ownerId?: string;
  chatId: string;
  kind?: ChatSyncEventKind;
  chatUpdatedAt?: string;
}) {
  if (!input.ownerId) return null;
  const createdAt = new Date().toISOString();
  const result = getDatabase().prepare(
    `INSERT INTO chat_sync_events
       (owner_id, chat_id, kind, chat_updated_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.ownerId,
    input.chatId,
    input.kind || "updated",
    input.chatUpdatedAt || createdAt,
    createdAt,
  );
  if (Date.now() - lastCleanupAt >= 30_000) {
    getDatabase().prepare(
      `DELETE FROM chat_sync_events
       WHERE id <= COALESCE((SELECT MAX(id) - 50000 FROM chat_sync_events), 0)`,
    ).run();
    lastCleanupAt = Date.now();
  }
  notifyDatabaseChangeSoon();
  return Number(result.lastInsertRowid);
}

export function latestChatSyncEventId(ownerId: string) {
  const row = getDatabase().prepare(
    "SELECT MAX(id) AS id FROM chat_sync_events WHERE owner_id = ?",
  ).get(ownerId) as { id?: number | null } | undefined;
  return Number(row?.id || 0);
}

export function listChatSyncEvents(ownerId: string, after = 0, limit = 500): ChatSyncEvent[] {
  const safeLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
  const rows = getDatabase().prepare(
    `SELECT id, owner_id AS ownerId, chat_id AS chatId, kind,
            chat_updated_at AS chatUpdatedAt, created_at AS createdAt
     FROM chat_sync_events
     WHERE owner_id = ? AND id > ?
     ORDER BY id ASC
     LIMIT ?`,
  ).all(ownerId, Math.max(0, Math.floor(after)), safeLimit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    ownerId: String(row.ownerId),
    chatId: String(row.chatId),
    kind: String(row.kind) as ChatSyncEventKind,
    chatUpdatedAt: String(row.chatUpdatedAt),
    createdAt: String(row.createdAt),
  }));
}
