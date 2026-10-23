import type { DatabaseSync } from "node:sqlite";
import type { Chat, ChatMessage } from "@/lib/store";
// Plain text only: tool results and nested agents stay in the canonical history.
// Trigrams retain literal substring searches (including punctuation and Unicode).
export const CHAT_SEARCH_SCHEMA = `
 CREATE TABLE IF NOT EXISTS chat_search_state (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  ready_revision INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS chat_search_messages (
  id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, message_id TEXT NOT NULL, role TEXT NOT NULL,
  body TEXT NOT NULL, normalized TEXT NOT NULL, UNIQUE(chat_id,position)
 );
 CREATE VIRTUAL TABLE IF NOT EXISTS chat_search_fts USING fts5(
  normalized, content='chat_search_messages', content_rowid='id',
  tokenize='trigram case_sensitive 1', detail=none, columnsize=0
 );
 CREATE TRIGGER IF NOT EXISTS chat_search_ai AFTER INSERT ON chat_search_messages BEGIN
  INSERT INTO chat_search_fts(rowid,normalized) VALUES(new.id,new.normalized);
 END;
 CREATE TRIGGER IF NOT EXISTS chat_search_ad AFTER DELETE ON chat_search_messages BEGIN
  INSERT INTO chat_search_fts(chat_search_fts,rowid,normalized) VALUES('delete',old.id,old.normalized);
 END;
 CREATE TRIGGER IF NOT EXISTS chat_search_au AFTER UPDATE OF normalized ON chat_search_messages
 WHEN old.normalized!=new.normalized BEGIN
  INSERT INTO chat_search_fts(chat_search_fts,rowid,normalized) VALUES('delete',old.id,old.normalized);
  INSERT INTO chat_search_fts(rowid,normalized) VALUES(new.id,new.normalized);
 END;
`;
type Change = {
    message?: ChatMessage;
    position?: number;
    metadataOnly?: boolean;
};
export function syncChatSearch(db: DatabaseSync, chat: Chat, revision: number, change?: Change) {
    const before = db.prepare("SELECT ready_revision FROM chat_search_state WHERE chat_id=?").get(chat.id) as {
        ready_revision: number;
    } | undefined;
    if (before?.ready_revision === revision)
        return;
    const incremental = !!change && before?.ready_revision === revision - 1;
    const insert = db.prepare(`INSERT INTO chat_search_messages(chat_id,position,message_id,role,body,normalized)
 VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,position) DO UPDATE SET
 message_id=excluded.message_id,role=excluded.role,body=excluded.body,normalized=excluded.normalized`);
    const write = (message: ChatMessage, position: number) => {
        const body = message.content || "";
        insert.run(chat.id, position, message.id, message.role, body, body.toLowerCase());
    };
    if (!incremental) {
        db.prepare("DELETE FROM chat_search_messages WHERE chat_id=?").run(chat.id);
        chat.messages.forEach(write);
    }
    else if (change?.message && change.position !== undefined)
        write(change.message, change.position);
    db.prepare("INSERT INTO chat_search_state VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET ready_revision=excluded.ready_revision").run(chat.id, revision);
}
export function searchSnippet(text: string, query: string) {
    const index = text.toLowerCase().indexOf(query);
    // Use the original string for display; normalization may expand a Unicode letter.
    const start = Math.max(0, index - 70), end = Math.min(text.length, Math.max(0, index) + query.length + 110);
    return (start ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}
// Project membership takes precedence over creator ownership, including revocation.
export const SEARCH_CHAT_ACCESS = `
 c.incognito=0 AND COALESCE(c.automation_run_id,'')='' AND (
  ? IS NULL OR CASE WHEN p.id IS NOT NULL THEN
   p.owner_id=? OR EXISTS(SELECT 1 FROM project_members a WHERE a.project_id=p.id AND a.user_id=?)
  ELSE c.owner_id=? END
 )`;
