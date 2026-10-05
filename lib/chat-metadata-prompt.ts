import type { Chat } from "@/lib/store";

/** Shared metadata policy for Cursor and every alternative provider runtime. */
export function chatMetadataPrompt(
  chat: Pick<Chat, "agentTitleLocked" | "titleSource" | "incognito">,
  incognito = false,
): string {
  if (incognito || chat.incognito) return "";
  const locked = chat.agentTitleLocked === true
    || (chat.agentTitleLocked === undefined && chat.titleSource === "user");
  return locked
    ? "The user locked this chat title. Do not call update_chat_title. Continue maintaining 3-8 concise, non-sensitive search terms with update_chat_keywords using mode=add."
    : "When the chat topic is clear or changes, silently call update_chat_title with a 2-6 word label in the user's language (not the first prompt) and update_chat_keywords with 3-8 concise, non-sensitive search terms using mode=add. For a new chat, do this before finishing the first response once the topic is clear. Do not mention this metadata maintenance in the main response. Use search_chats when you need to locate an earlier chat by title, keyword, or message content.";
}
