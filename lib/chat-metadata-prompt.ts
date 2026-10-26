import type { Chat } from "@/lib/store";

/** Shared metadata policy for Cursor and every alternative provider runtime. */
export function chatMetadataPrompt(
  chat: Pick<Chat, "agentTitleLocked" | "titleSource" | "incognito">,
  incognito = false,
): string {
  if (incognito || chat.incognito) return "";
  const locked = chat.agentTitleLocked === true
    || (chat.agentTitleLocked === undefined && chat.titleSource === "user");
  const metadata = locked
    ? "The user locked this chat title. Do not call update_chat_title. Continue maintaining 3-8 concise, non-sensitive search terms with update_chat_keywords using mode=add."
    : "When the chat topic is clear or changes, silently call update_chat_title with a 2-6 word label in the user's language (not the first prompt) and update_chat_keywords with 3-8 concise, non-sensitive search terms using mode=add. For a new chat, do this before finishing the first response once the topic is clear. Do not mention this metadata maintenance in the main response. Use search_chats when you need to locate an earlier chat by title, keyword, or message content.";
  return metadata + " When the user starts work that clearly belongs to an existing project, use list_projects to resolve the destination and move_chat_to_project to organize this chat. Use the returned ID; do not create a project or move unrelated chats. Ask only if the destination remains ambiguous. Moving to a shared project shares this transcript with its members; do that only when the user has identified that shared destination. Project instructions and memory policy refresh on the next turn after a move.";
}
