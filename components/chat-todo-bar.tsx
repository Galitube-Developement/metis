"use client";

import { RunStatus } from "@/components/run-status";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import { currentChatTodos, newerChatTodos, type ChatTodoState } from "@/lib/chat-todos";

export function ChatTodoBar({ chatId, messages, reverting = false }: {
  chatId: string;
  messages: Parameters<typeof currentChatTodos>[0];
  reverting?: boolean;
}) {
  const [saved, setSaved] = useState<ChatTodoState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const panelId = useId();
  const local = useMemo(() => currentChatTodos(messages), [messages]);
  useEffect(() => {
    if (reverting) { setSaved(null); return; }
    let disposed = false;
    let inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/todos`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load tasks");
        const data = await response.json() as { currentTodos: ChatTodoState | null };
        if (!disposed) { setSaved(data.currentTodos); setError(false); }
      } catch {
        if (!disposed && !controller.signal.aborted) setError(true);
      } finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true; controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [chatId, reverting, retry]);

  const state = newerChatTodos(local, saved);
  if (reverting) return null;
  if (!state?.items.length) return error ? (
    <div role="status" className="shrink-0 border-b border-border/40 px-4 py-2 text-xs text-muted-foreground">
      Tasks could not be loaded. <button type="button" className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setRetry(value => value + 1)}>Retry</button>
    </div>
  ) : null;
  const items = state.items;
  const completed = items.filter(item => item.status === "completed").length;
  const current = items.find(item => item.status === "in_progress") || items.find(item => !["completed", "cancelled"].includes(item.status || ""));
  return (
    <section aria-label="Current chat tasks" className="shrink-0 border-b border-border/40 bg-background">
      <button type="button" aria-expanded={expanded} aria-controls={panelId}
        onClick={() => setExpanded(value => !value)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3.5 text-left text-xs hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:min-h-9 md:px-4">
        <ListChecks aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 tabular-nums text-muted-foreground">Tasks {completed}/{items.length}</span>
        <span className="min-w-0 flex-1 truncate" aria-live="polite">{current?.content || (completed === items.length ? "All tasks completed" : "Tasks closed")}</span>
        <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded ? <ol id={panelId} className="max-h-[min(30svh,16rem)] space-y-2 overflow-y-auto overscroll-contain px-4 pb-3 text-xs">
        {items.map((item, index) => <li key={item.id || `${state.toolId}-${index}`} className="flex items-start gap-2">
          <RunStatus status={item.status || "pending"} iconOnly decorative className="mt-0.5 shrink-0 text-muted-foreground" />
          <span className={`min-w-0 break-words ${["completed", "cancelled"].includes(item.status || "") ? "text-muted-foreground" : ""}`}>{item.content}<span className="sr-only"> — {item.status || "pending"}</span></span>
        </li>)}
        {error ? <li role="status" className="text-muted-foreground">Tasks may be out of date. <button type="button" className="underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setRetry(value => value + 1)}>Retry</button></li> : null}
      </ol> : null}
    </section>
  );
}
