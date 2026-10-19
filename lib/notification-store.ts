import { canAccessChat } from "@/lib/project-access";
import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";
import { getRemoteClient } from "@/lib/remote-clients";
import { z } from "zod";
import { normalizeNotificationPrefs, remoteNotificationAllowed, type NotificationPrefs } from "@/lib/notification-preferences";
export type { NotificationPrefs } from "@/lib/notification-preferences";

export const notificationInput = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(2000).default(""),
  chatId: z.string().min(1).max(200).optional(),
}).strict();
export const notificationPrefsInput = z.object({
  toastEnabled: z.boolean().optional(),
  browserEnabled: z.boolean().optional(),
  remoteEnabled: z.boolean().optional(),
  agentFinishedEnabled: z.boolean().optional(),
  remoteClientIds: z.array(z.string().min(1).max(200)).max(50).optional(),
  remoteClient: z.object({ id: z.string().min(1).max(200), enabled: z.boolean() }).strict().optional(),
}).strict();
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
  try { return normalizeNotificationPrefs(row ? JSON.parse(row.data) : undefined); }
  catch { return normalizeNotificationPrefs(undefined); }
}
export function setNotificationPrefs(ownerId: string, input: unknown) {
  const patch = notificationPrefsInput.parse(input);
  return transaction(() => {
    const db = notificationDatabase(), current = getNotificationPrefs(ownerId);
    const selected = patch.remoteClientIds ?? current.remoteClientIds;
    if (patch.remoteClientIds?.some(id => {
      const client = getRemoteClient(id, ownerId);
      return !client || client.status === "revoked";
    })) throw new Error("Remote client is unavailable for this account");
    if (patch.remoteClient) {
      const client = getRemoteClient(patch.remoteClient.id,ownerId);
      if (!client || client.status === "revoked") throw new Error("Remote client is unavailable for this account");
      if (patch.remoteClientIds) throw new Error("Choose one device update format");
    }
    const row = db.prepare("SELECT data FROM notification_prefs WHERE owner_id=?").get(ownerId) as {data:string}|undefined;
    let legacy = true;
    try { legacy = !row || typeof JSON.parse(row.data).remoteEnabled !== "boolean"; } catch {}
    if (patch.remoteClient?.enabled && !selected.includes(patch.remoteClient.id) && selected.length >= 50) throw new Error("Select up to 50 devices");
    const {remoteClient, ...fields} = patch;
    const prefs = normalizeNotificationPrefs({ ...current, ...fields,
      ...(legacy && patch.remoteClientIds && patch.remoteEnabled === undefined ? {remoteEnabled:selected.length > 0} : {}),
      remoteClientIds: remoteClient ? (remoteClient.enabled ? [...selected,remoteClient.id] : selected.filter(id => id !== remoteClient.id)) : selected,
    });
    db.prepare("INSERT INTO notification_prefs VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data").run(ownerId,JSON.stringify(prefs));
    // Muted alerts must not replay when notifications are re-enabled.
    const pending = db.prepare("SELECT d.notification_id,d.client_id,n.source_key FROM notification_deliveries d JOIN notification_records n ON n.id=d.notification_id WHERE n.owner_id=? AND d.acknowledged_at IS NULL").all(ownerId) as Array<{notification_id:string;client_id:string;source_key:string|null}>;
    for (const item of pending) if (!remoteNotificationAllowed(prefs,isAgentFinishedNotification(ownerId,item.source_key),item.client_id)) {
      db.prepare("DELETE FROM notification_deliveries WHERE notification_id=? AND client_id=?").run(item.notification_id,item.client_id);
    }
    return prefs;
  });
}
export function createNotification(ownerId: string, input: unknown, sourceKey?: string, createdAt = new Date().toISOString()): NotificationRecord {
  const data = notificationInput.parse(input);
  const db = notificationDatabase();
  if (data.chatId && !canAccessChat(data.chatId, ownerId))
    throw new Error("Chat is unavailable for this account");
  return transaction(() => {
    const id = randomUUID();
    const inserted = db.prepare("INSERT OR IGNORE INTO notification_records(id,owner_id,title,body,chat_id,created_at,source_key) VALUES (?,?,?,?,?,?,?)")
      .run(id, ownerId, data.title, data.body, data.chatId ?? null, createdAt, sourceKey ?? null);
    const record = db.prepare("SELECT id,sequence,title,body,chat_id AS chatId,created_at AS createdAt FROM notification_records WHERE owner_id=? AND " + (sourceKey ? "source_key=?" : "id=?"))
      .get(ownerId, sourceKey ?? id) as NotificationRecord | undefined;
    if (!record) throw new Error("Notification source collision");
    const prefs = getNotificationPrefs(ownerId);
    for (const clientId of inserted.changes && remoteNotificationAllowed(prefs,isAgentFinishedNotification(ownerId,sourceKey)) ? prefs.remoteClientIds : []) {
      db.prepare("INSERT OR IGNORE INTO notification_deliveries(notification_id,client_id) VALUES (?,?)").run(record.id, clientId);
    }
    return record;
  });
}
export function isAgentFinishedNotification(ownerId: string, sourceKey?: string | null) {
  return Boolean(sourceKey?.startsWith("run:" + ownerId + ":done:"));
}

export function notificationDeliverySummary(ownerId: string, notificationId: string) {
  const prefs = getNotificationPrefs(ownerId), db = notificationDatabase();
  const row = db.prepare("SELECT source_key FROM notification_records WHERE id=? AND owner_id=?").get(notificationId,ownerId) as {source_key:string|null}|undefined;
  if (!row) throw new Error("Notification is unavailable for this account");
  const deliveries = db.prepare("SELECT acknowledged_at FROM notification_deliveries WHERE notification_id=?").all(notificationId) as Array<{acknowledged_at:string|null}>;
  return { status: !remoteNotificationAllowed(prefs,isAgentFinishedNotification(ownerId,row.source_key)) ? "disabled"
    : !prefs.remoteClientIds.length ? "no_devices" : deliveries.some(item=>item.acknowledged_at) ? "delivered" : deliveries.length ? "queued" : "not_queued",
    queuedDevices: deliveries.filter(item=>!item.acknowledged_at).length,
    deliveredDevices: deliveries.filter(item=>item.acknowledged_at).length };
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
