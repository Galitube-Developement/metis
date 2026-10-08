import type { ChatMessage, ToolPart } from "@/lib/store";
import { estimateContextTokens } from "@/lib/context-window";
import { enrichToolDisplay } from "@/lib/tool-call-display";

const INLINE_PAYLOAD_LIMIT = 2_048;
const PREVIEW_LENGTH = 256;
const pageCache = new WeakMap<ChatMessage[], { chatId: string; messages: ChatMessage[] }>();
const structuredKinds = new Set(["plan", "canvas", "note", "memory", "automation", "todo", "subagent"]);

/** Keep JSON arguments valid so paths/targets and native tool captions still work. */
function previewInput(input: string): string {
  try {
    const preview = JSON.stringify(JSON.parse(input), (_key, value) =>
      typeof value === "string" && value.length > PREVIEW_LENGTH ? value.slice(0, PREVIEW_LENGTH) + "…" : value);
    return preview.length <= INLINE_PAYLOAD_LIMIT ? preview : input.slice(0, PREVIEW_LENGTH);
  } catch { return input.slice(0, PREVIEW_LENGTH); }
}

export function compactChatPageMessages(messages: ChatMessage[], chatId: string): ChatMessage[] {
  const cached = pageCache.get(messages);
  if (cached?.chatId === chatId) return cached.messages;
  const compactMessages = messages.map(message => {
    const compact = <T extends ToolPart>(tool: T): T => {
      const deferResult = typeof tool.result === "string" && tool.result.length > INLINE_PAYLOAD_LIMIT;
      const deferInput = typeof tool.input === "string" && tool.input.length > INLINE_PAYLOAD_LIMIT;
      if (!tool.id || (!deferResult && !deferInput)) return tool;
      // Known native kinds do not need their multi-megabyte output parsed to
      // discover a name. Gateway wrappers still resolve the inner contract.
      const resolvedName = !/^(mcp|call_mcp_tool|callmcptool)$/i.test(tool.name);
      const knownKind = tool.kind && tool.kind !== "mcp" && tool.kind !== "other";
      const display = enrichToolDisplay({ ...tool, result: resolvedName && knownKind ? undefined : tool.result });
      if (structuredKinds.has(display.kind) || tool.todos?.length || display.todos?.length) return tool;
      const url = `/api/chats/${encodeURIComponent(chatId)}/tool-result?messageId=${encodeURIComponent(message.id)}&toolId=${encodeURIComponent(tool.id)}`;
      return {
        ...tool,
        name: display.name,
        kind: display.kind,
        ...(deferResult ? { result: tool.result!.slice(0, PREVIEW_LENGTH), resultUrl: url } : {}),
        ...(deferInput ? { input: previewInput(tool.input!), inputUrl: url } : {}),
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
