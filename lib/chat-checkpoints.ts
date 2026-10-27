import type { DatabaseSync } from "node:sqlite";
import type { Chat, ChatMessage } from "@/lib/store";

/** Durable streaming deltas; canonical JSON is consolidated by the next full save.
 * Apply only to existing message identities, so a revert cannot resurrect a turn. */
export function applyChatCheckpoints(db: DatabaseSync, chat: Chat): Chat {
  if (!Array.isArray(chat.messages) || !chat.messages.length) return chat;
  const rows = db.prepare("SELECT message_id,data,updated_at FROM chat_message_checkpoints WHERE chat_id=? ORDER BY position")
    .all(chat.id) as Array<{ message_id: string; data: string; updated_at: string }>;
  if (!rows.length) return chat;
  const positions = new Map(chat.messages.map((message, index) => [message.id, index]));
  const messages = [...chat.messages];
  let updatedAt = chat.updatedAt;
  for (const row of rows) {
    const position = positions.get(row.message_id);
    if (position === undefined) continue;
    const message = JSON.parse(row.data) as ChatMessage;
    if (message.id !== row.message_id) continue;
    messages[position] = message;
    if (row.updated_at > updatedAt) updatedAt = row.updated_at;
  }
  return { ...chat, messages, updatedAt };
}
