import { STREAM_FADE_MS } from "@/lib/streaming-text";

export type MotionMessage = {
  id: string; role: string; content?: string;
  tools?: Array<{ id: string }>;
  parts?: Array<{ type: string; id?: string }>;
};
type SeenMessage = { content: string; toolIds: Set<string> };
export type LiveMessageMotion = {
  chatId: string | null; wasLoading: boolean;
  seen: Map<string, SeenMessage>;
  messageBirths: Map<string, number>;
  toolBirths: Map<string, number>;
};

function toolIds(message: MotionMessage) {
  return new Set([...(message.tools || []).map((tool) => tool.id),
    ...(message.parts || []).filter((part) => part.type === "tool").map((part) => part.id || "")].filter(Boolean));
}
export function toolMotionKey(messageId: string, toolId: string) { return messageId + ":" + toolId; }

export function initialLiveMessageMotion(chatId: string | null, messages: readonly MotionMessage[], loading = false): LiveMessageMotion {
  return { chatId, wasLoading: loading,
    seen: new Map(messages.slice(-512).map((message) => [message.id, { content: message.content || "", toolIds: toolIds(message) }])),
    messageBirths: new Map(), toolBirths: new Map() };
}

/** Track actual arrivals; loaded history, user sends and tool status changes are inert. */
export function advanceLiveMessageMotion(previous: LiveMessageMotion, chatId: string | null, messages: readonly MotionMessage[], now: number, loading = false): LiveMessageMotion {
  const recent = messages.slice(-512);
  if (previous.chatId !== chatId || loading || previous.wasLoading) {
    const unchanged = previous.chatId === chatId && previous.wasLoading === loading && previous.seen.size === recent.length
      && recent.every((message) => {
        const before = previous.seen.get(message.id);
        const ids = toolIds(message);
        return before?.content === (message.content || "") && before.toolIds.size === ids.size && [...ids].every((id) => before.toolIds.has(id));
      });
    return unchanged ? previous : initialLiveMessageMotion(chatId, messages, loading);
  }
  const lastKnown = recent.findLastIndex((message) => previous.seen.has(message.id));
  const seen = new Map(previous.seen);
  const messageBirths = new Map([...previous.messageBirths].filter(([, born]) => now - born < STREAM_FADE_MS));
  const toolBirths = new Map([...previous.toolBirths].filter(([, born]) => now - born < STREAM_FADE_MS));
  let changed = messageBirths.size !== previous.messageBirths.size || toolBirths.size !== previous.toolBirths.size;
  recent.forEach((message, index) => {
    const before = previous.seen.get(message.id);
    const content = message.content || "";
    const ids = toolIds(message);
    const textChanged = !before || before.content !== content;
    const newTools = [...ids].filter((id) => !before?.toolIds.has(id));
    if (!textChanged && !newTools.length && ids.size === before?.toolIds.size) return;
    changed = true;
    seen.set(message.id, { content, toolIds: ids });
    const appended = before ? content.length > before.content.length && content.startsWith(before.content) : index > lastKnown;
    const arriving = Boolean(before) || index > lastKnown;
    if (message.role === "assistant" && arriving) {
      if (appended && content) messageBirths.set(message.id, now);
      for (const id of newTools) toolBirths.set(toolMotionKey(message.id, id), now);
    }
  });
  if (!changed) return previous;
  const visibleIds = new Set(recent.map((message) => message.id));
  for (const id of seen.keys()) if (!visibleIds.has(id)) seen.delete(id);
  return { chatId, wasLoading: false, seen, messageBirths, toolBirths };
}
