import { getDatabase } from "@/lib/sqlite";
import { messageActivity } from "@/lib/chat-activity";
import type { Chat, ChatMessage } from "@/lib/store";

export function getChatActivity(chatId: string) {
  const row = getDatabase().prepare("SELECT revision, read_revision FROM chat_activity WHERE chat_id = ?").get(chatId) as { revision: number; read_revision: number } | undefined;
  const activityRevision = row?.revision ?? 0, readRevision = row?.read_revision ?? 0;
  return { activityRevision, readRevision, unread: activityRevision > readRevision };
}
export function recordMessageActivity(chatId: string, before: readonly ChatMessage[], after: readonly ChatMessage[]) {
  const project = (messages: readonly ChatMessage[]) => messages.map(messageActivity).filter(Boolean);
  if (JSON.stringify(project(before)) === JSON.stringify(project(after))) return;
  getDatabase().prepare(`INSERT INTO chat_activity(chat_id, revision, read_revision) VALUES (?, 1, 0)
    ON CONFLICT(chat_id) DO UPDATE SET revision = revision + 1`).run(chatId);
}
export function acknowledgeChatActivity(chatId: string, revision: number) {
  getDatabase().prepare(`UPDATE chat_activity SET read_revision = MAX(read_revision, MIN(revision, ?)) WHERE chat_id = ?`).run(revision, chatId);
  return getChatActivity(chatId);
}

export function recordAttentionActivity(chatId: string, before: Chat | null, after: Chat) {
  const freshQuestion = after.pendingQuestion && after.pendingQuestion.questionId !== before?.pendingQuestion?.questionId;
  const freshApproval = after.pendingApproval && after.pendingApproval.id !== before?.pendingApproval?.id;
  const freshError = (after.badge === "red" && before?.badge !== "red") || (["error", "failed"].includes(after.runStatus || "") && after.runStatus !== before?.runStatus);
  if (!freshQuestion && !freshApproval && !freshError) return;
  getDatabase().prepare(`INSERT INTO chat_activity(chat_id, revision, read_revision) VALUES (?, 1, 0)
    ON CONFLICT(chat_id) DO UPDATE SET revision = revision + 1`).run(chatId);
}
