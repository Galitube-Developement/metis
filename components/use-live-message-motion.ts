"use client";
import { useState } from "react";
import { advanceLiveMessageMotion, initialLiveMessageMotion, type MotionMessage } from "@/lib/live-message-motion";

export function useLiveMessageMotion(chatId: string | null, messages: readonly MotionMessage[], loading = false) {
  const [state, setState] = useState(() => initialLiveMessageMotion(chatId, messages, loading));
  const next = advanceLiveMessageMotion(state, chatId, messages, Date.now(), loading);
  if (next !== state) setState(next);
  return { messageBirths: next.messageBirths, toolBirths: next.toolBirths };
}
