export type ChatActivity = { activityRevision?: number; readRevision?: number; unread?: boolean };
export type ChatAttention = ChatActivity & { badge?: "blue" | "red"; pendingQuestion?: unknown; pendingApproval?: unknown; runStatus?: string; archived?: boolean };
export type ActivityIndicator = "question" | "error" | "running" | "unread" | null;

export function chatActivityIndicator(chat: ChatAttention, unread = chat.unread ?? chat.badge === "blue"): ActivityIndicator {
  if (chat.pendingQuestion || chat.pendingApproval || ["waiting_input", "waiting_for_user"].includes(chat.runStatus || "")) return "question";
  if (chat.badge === "red" || (unread && ["error", "failed"].includes(chat.runStatus || ""))) return "error";
  return unread ? "unread" : null;
}
export function projectActivityIndicator(chats: readonly (ChatAttention & { id?: string })[], visibleChatId?: string | null): ActivityIndicator {
  const activeChats = chats.filter(chat => !chat.archived);
  const indicators = activeChats.map(chat => chatActivityIndicator(chat, visibleChatId && chat.id === visibleChatId ? false : undefined));
  return indicators.includes("question") ? "question" : indicators.includes("error") ? "error"
    : activeChats.some(chat => chat.runStatus === "running") ? "running"
    : indicators.includes("unread") ? "unread" : null;
}

/** Visible transcript changes count as progress; usage, leases and UI metadata do not. */
export function messageActivity(message: { id: string; role: string; content?: string; thinking?: string; parts?: unknown[]; tools?: unknown[]; attachments?: unknown[] }) {
  const { id, role, content, thinking, parts, tools, attachments } = message;
  if (!content && !thinking && !parts?.length && !tools?.length && !attachments?.length) return null;
  return { id, role, content: content || "", thinking, parts, tools, attachments };
}
