/** Latest voice exchange to include when resuming a provider's text thread. */
export function recentVoiceContext(messages: Array<{ id: string; role: string; content: string }>, beforeMessageId?: string) {
  const currentIndex = beforeMessageId ? messages.findIndex((message) => message.id === beforeMessageId) : -1;
  const before = currentIndex >= 0 ? messages.slice(0, currentIndex) : messages;
  const tail: typeof messages = [];
  for (let index = before.length - 1; index >= 0; index--) {
    const message = before[index];
    if (!message.id.startsWith("voice:")) break;
    if (message.role === "user" || message.role === "assistant") tail.unshift(message);
  }
  if (!tail.length) return "";
  return "Recent voice conversation (quoted context):\n" +
    tail.slice(-20).map((message) => message.role + ": " + message.content.slice(0, 3_000)).join("\n").slice(-24_000);
}

/** Account-authenticated Codex AVAS V3 WebRTC data-channel transcript events. */
export type VoiceTurnEvent =
  | { type: "created" | "done"; id: string; role: "user" | "assistant"; text: string }
  | { type: "delta"; id: string; text: string };
export type VoiceTurnTranscript = { id: string; role: "user" | "assistant"; text: string; complete: boolean };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseVoiceChannelEvent(value: unknown): VoiceTurnEvent | undefined {
  const event = record(value);
  if (event.type === "turn.created" || event.type === "turn.done") {
    const turn = record(event.turn);
    if (typeof turn.id !== "string" || typeof turn.transcript !== "string"
        || (turn.role !== "user" && turn.role !== "assistant")) return;
    return validateVoiceTurnEvent({ type: event.type === "turn.done" ? "done" : "created", id: turn.id, role: turn.role, text: turn.transcript });
  }
  if (event.type === "turn.delta" && typeof event.turn_id === "string" && typeof event.delta === "string") {
    return validateVoiceTurnEvent({ type: "delta", id: event.turn_id, text: event.delta });
  }
}

export function validateVoiceTurnEvent(value: unknown): VoiceTurnEvent {
  const event = record(value);
  if (typeof event.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(event.id)
      || typeof event.text !== "string" || event.text.length > 32_000) throw new Error("Invalid voice transcript event.");
  if (event.type === "delta") return { type: "delta", id: event.id, text: event.text };
  if ((event.type === "created" || event.type === "done") && (event.role === "user" || event.role === "assistant")) {
    return { type: event.type, id: event.id, role: event.role, text: event.text };
  }
  throw new Error("Invalid voice transcript event.");
}

export function applyVoiceTurnEvent(previous: VoiceTurnTranscript | undefined, event: VoiceTurnEvent): VoiceTurnTranscript | undefined {
  if (previous?.complete) return previous;
  if (event.type === "delta") {
    return previous ? { ...previous, text: (previous.text + event.text).slice(0, 32_000) } : undefined;
  }
  if (previous && previous.role !== event.role) throw new Error("Voice transcript role changed.");
  return { id: event.id, role: event.role, text: event.text, complete: event.type === "done" };
}
