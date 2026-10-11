"use client";
import { useState } from "react";

/** Remember live message IDs across completion, without animating loaded history. */
export function useLiveMessageMotion(chatId: string | null, messages: readonly { id: string; role: string; streaming?: boolean }[]) {
  const [seen, setSeen] = useState<{ chatId: string | null; ids: Set<string> }>(() => ({ chatId, ids: new Set() }));
  const live = messages.filter(message => message.role === "assistant" && message.streaming).map(message => message.id);
  if (seen.chatId !== chatId || live.some(id => !seen.ids.has(id))) {
    const ids = new Set(seen.chatId === chatId ? seen.ids : []);
    for (const id of live) ids.add(id);
    while (ids.size > 512) ids.delete(ids.values().next().value!);
    const next = { chatId, ids };
    setSeen(next);
    return next.ids;
  }
  return seen.ids;
}
