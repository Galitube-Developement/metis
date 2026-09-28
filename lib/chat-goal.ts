import { resolveScopeReferences } from "@/lib/context-scope";
import { getChat } from "@/lib/db-store";
import type { ChatSessionState } from "@/lib/store";

/** Keep goal references attached across turns, using the same scope checks as @ mentions. */
export function formatChatGoal(
  state: ChatSessionState | undefined,
  ownerId: string | undefined,
  chatId: string,
  incognito = false,
): string {
  const goal = state?.goal?.trim();
  if (!goal) return "";
  const referenceChatId = state?.goalOriginChatId && getChat(state.goalOriginChatId, ownerId)
    ? state.goalOriginChatId
    : chatId;
  const references = resolveScopeReferences(
    ownerId,
    referenceChatId,
    (state?.goalReferences || []).map((reference) => ({
      ...reference,
      source: "explicit" as const,
    })),
    incognito,
  );
  const context = references.map((reference) => [
    `- [${reference.kind}] ${reference.label}`,
    reference.detail ? `  Detail: ${reference.detail}` : "",
    reference.path ? `  Path/URL: ${reference.path}` : "",
    reference.content ? `  Context:\n${reference.content}` : "",
  ].filter(Boolean).join("\n")).join("\n\n").slice(0, 32_000);
  return [
    `Current chat goal: ${goal}`,
    context ? `Goal context — selected @ references:\n${context}` : "",
  ].filter(Boolean).join("\n\n");
}
