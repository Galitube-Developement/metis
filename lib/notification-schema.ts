// Initialized with the core database before requests are accepted. Read-only
// notification feeds and remote delivery checks must never acquire a writer lock.
export const NOTIFICATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS notification_records (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body TEXT NOT NULL, chat_id TEXT,
 created_at TEXT NOT NULL, source_key TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS notifications_owner_cursor ON notification_records(owner_id, sequence);
CREATE TABLE IF NOT EXISTS notification_prefs (
 owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_observer (key TEXT PRIMARY KEY, cursor INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notification_deliveries (
 notification_id TEXT NOT NULL REFERENCES notification_records(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL, acknowledged_at TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(notification_id, client_id));
`;
