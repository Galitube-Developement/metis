import type { ChatMessage, ToolPart } from "@/lib/store";
import { estimateContextTokens } from "@/lib/context-window";
import { enrichToolDisplay } from "@/lib/tool-call-display";

// Large raw outputs are available on demand; cards that need structured output stay intact.
const INLINE_RESULT_LIMIT = 8_192;
const RESULT_PREVIEW_LENGTH = 1_024;
const pageCache = new WeakMap<ChatMessage[], { chatId: string; messages: ChatMessage[] }>();
const structuredKinds = new Set(["plan", "canvas", "note", "memory", "automation", "todo", "subagent"]);

export function compactChatPageMessages(messages: ChatMessage[], chatId: string): ChatMessage[] {
  const cached = pageCache.get(messages);
  if (cached?.chatId === chatId) return cached.messages;
  const compactMessages = messages.map(message => {
    const compact = <T extends ToolPart>(tool: T): T => {
      if (!tool.id || typeof tool.result !== "string" || tool.result.length <= INLINE_RESULT_LIMIT) return tool;
      const display = enrichToolDisplay(tool);
      if (structuredKinds.has(display.kind) || display.todos?.length) return tool;
      return {
        ...tool,
        name: display.name,
        kind: display.kind,
        result: tool.result.slice(0, RESULT_PREVIEW_LENGTH),
        resultUrl: `/api/chats/${encodeURIComponent(chatId)}/tool-result?messageId=${encodeURIComponent(message.id)}&toolId=${encodeURIComponent(tool.id)}`,
      };
    };
    return {
      ...message,
      contextTokenEstimate: estimateContextTokens({ role: message.role, content: message.content, tools: message.tools || [] }),
      ...(message.tools ? { tools: message.tools.map(compact) } : {}),
      ...(message.parts ? { parts: message.parts.map(part => part.type === "tool" ? compact(part) : part) } : {}),
    };
  });
  pageCache.set(messages, { chatId, messages: compactMessages });
  return compactMessages;
}
