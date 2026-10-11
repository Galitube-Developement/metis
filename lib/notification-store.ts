import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import { getRemoteClient } from "@/lib/remote-clients";
import { z } from "zod";

export const notificationInput = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(2000).default(""),
  chatId: z.string().min(1).max(200).optional(),
}).strict();
export const notificationPrefsInput = z.object({
  toastEnabled: z.boolean().optional(),
  browserEnabled: z.boolean().optional(),
  remoteClientIds: z.array(z.string().min(1).max(200)).max(50).optional(),
}).strict();
export type NotificationPrefs = { toastEnabled: boolean; browserEnabled: boolean; remoteClientIds: string[] };
export type NotificationRecord = { id: string; sequence: number; title: string; body: string; chatId: string | null; createdAt: string };
const initialized = new WeakSet<object>();
export function notificationDatabase() {
  const db = getDatabase();
  if (!initialized.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_records (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, body TEXT NOT NULL, chat_id TEXT,
        created_at TEXT NOT NULL, source_key TEXT UNIQUE);
      CREATE INDEX IF NOT EXISTS notifications_owner_cursor ON notification_records(owner_id, sequence);
      CREATE TABLE IF NOT EXISTS notification_prefs (
        owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_observer (
        key TEXT PRIMARY KEY, cursor INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        notification_id TEXT NOT NULL REFERENCES notification_records(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL, acknowledged_at TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(notification_id, client_id));
    `);
    // First installation starts at the current tail: never push historical user data.
    db.prepare("INSERT OR IGNORE INTO notification_observer(key,cursor) SELECT 'runs',COALESCE(MAX(id),0) FROM run_events").run();
    initialized.add(db);
  }
  return db;
}
export function getNotificationPrefs(ownerId: string): NotificationPrefs {
  const row = notificationDatabase().prepare("SELECT data FROM notification_prefs WHERE owner_id=?").get(ownerId) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : { toastEnabled: true, browserEnabled: false, remoteClientIds: [] };
}
export function setNotificationPrefs(ownerId: string, input: unknown) {
  const patch = notificationPrefsInput.parse(input);
  if (patch.remoteClientIds?.some(id => {
    const client = getRemoteClient(id, ownerId);
    return !client || client.status === "revoked";
  })) throw new Error("Remote client is unavailable for this account");
  const prefs = { ...getNotificationPrefs(ownerId), ...patch };
  prefs.remoteClientIds = [...new Set(prefs.remoteClientIds)];
  notificationDatabase().prepare("INSERT INTO notification_prefs VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data")
    .run(ownerId, JSON.stringify(prefs));
  return prefs;
}
export function createNotification(ownerId: string, input: unknown, sourceKey?: string, createdAt = new Date().toISOString()): NotificationRecord {
  const data = notificationInput.parse(input);
  const db = notificationDatabase();
  if (data.chatId && !db.prepare("SELECT 1 FROM chats WHERE id=? AND owner_id=?").get(data.chatId, ownerId))
    throw new Error("Chat is unavailable for this account");
  return transaction(() => {
    const id = randomUUID();
    db.prepare("INSERT OR IGNORE INTO notification_records(id,owner_id,title,body,chat_id,created_at,source_key) VALUES (?,?,?,?,?,?,?)")
      .run(id, ownerId, data.title, data.body, data.chatId ?? null, createdAt, sourceKey ?? null);
    const record = db.prepare("SELECT id,sequence,title,body,chat_id AS chatId,created_at AS createdAt FROM notification_records WHERE owner_id=? AND " + (sourceKey ? "source_key=?" : "id=?"))
      .get(ownerId, sourceKey ?? id) as NotificationRecord | undefined;
    if (!record) throw new Error("Notification source collision");
    for (const clientId of getNotificationPrefs(ownerId).remoteClientIds) {
      db.prepare("INSERT OR IGNORE INTO notification_deliveries(notification_id,client_id) VALUES (?,?)").run(record.id, clientId);
    }
    return record;
  });
}
export function getNotificationFeed(ownerId: string, after?: number) {
  const db = notificationDatabase();
  const cursor = Number((db.prepare("SELECT COALESCE(MAX(sequence),0) AS cursor FROM notification_records WHERE owner_id=?").get(ownerId) as {cursor:number}).cursor);
  const notifications = after === undefined ? [] : db.prepare(
    "SELECT id,sequence,title,body,chat_id AS chatId,created_at AS createdAt FROM notification_records WHERE owner_id=? AND sequence>? ORDER BY sequence LIMIT 100"
  ).all(ownerId, after) as NotificationRecord[];
  const nextCursor = notifications.length ? notifications[notifications.length - 1].sequence : Math.max(after ?? 0, cursor);
  return { notifications, cursor: nextCursor, hasMore: notifications.length === 100, prefs: getNotificationPrefs(ownerId) };
}
