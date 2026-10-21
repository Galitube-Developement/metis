"use client";

import { RunStatus } from "@/components/run-status";
import { loadToolPayload } from "@/lib/tool-result-client";
import { MessageHistoryControl } from "@/components/message-history-control";

import { ArrowLeft, CircleStop, Clock3, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ToolPart, ChatMessage } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { ToolCallGroup } from "@/components/tool-call-chip";
import { ThinkingBlock } from "@/components/thinking-block";
import { stripTranscriptDump, transcriptFromToolPart } from "@/lib/agent-transcript";

type Props = {
  tool: ToolPart;
  onBack: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  sidebarWidth?: number;
};

const EXIT_MS = 200;

function promptText(tool: ToolPart): string {
  const raw = tool.subagent?.prompt || tool.input || "";
  return stripTranscriptDump(typeof raw === "string" ? raw : "");
}

export function SubagentChatView({ tool, onBack, onCancel, cancelling = false, sidebarWidth = 0 }: Props) {
  const [liveTool, setLiveTool] = useState<ToolPart | null>(null);
  const [historyLimit,setHistoryLimit]=useState(24);
  const [childHistory,setChildHistory]=useState<ChatMessage[]>([]);
  const [childBefore,setChildBefore]=useState<number|null>(null);
  const childCursorInitialized=useRef(false);
  const [detailError,setDetailError]=useState(false);
  useEffect(()=>{
    if(toolRef.current.subagent?.chatId || !(toolRef.current.inputUrl || toolRef.current.resultUrl))return;
    const controller=new AbortController();setReady(false);setDetailError(false);
    void loadToolPayload((toolRef.current.inputUrl || toolRef.current.resultUrl)!,controller.signal).then(payload=>{
      if(!controller.signal.aborted){setLiveTool({...toolRef.current,...payload});setReady(true);}
    }).catch(()=>{if(!controller.signal.aborted){setDetailError(true);setReady(true);}});
    return()=>controller.abort();
  },[tool.id,tool.inputUrl,tool.resultUrl,tool.subagent?.chatId]);
  const [leaving, setLeaving] = useState(false);
  const [ready, setReady] = useState(!tool.subagent?.chatId);
  const onBackRef = useRef(onBack);
  const toolRef = useRef(tool);
  onBackRef.current = onBack;
  toolRef.current = tool;

  const requestClose = () => {
    if (leaving) return;
    setLeaving(true);
  };

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onBackRef.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    const childChatId = tool.subagent?.chatId;
    if (!childChatId) {
      if(!(toolRef.current.inputUrl || toolRef.current.resultUrl)){setLiveTool(null);setReady(true);}
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let etag="";
    const controller=new AbortController();
    setChildHistory([]);setChildBefore(null);childCursorInitialized.current=false;
    setReady(false);
    const poll = async () => {
      try {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          timer = window.setTimeout(() => void poll(), 1600);
          return;
        }
        const response = await fetch(`/api/chats/${encodeURIComponent(childChatId)}?messageLimit=10`, { cache: "no-store", signal:controller.signal, headers:etag?{"If-None-Match":etag}:undefined });
        if(cancelled)return;
        if(response.status===304){timer=window.setTimeout(()=>void poll(),1600);return;}
        if(!response.ok)throw new Error("Child history unavailable");
        etag=response.headers.get("etag") || "";
        const data = await response.json() as {
          chat?: { runStatus?: string; messages?: ChatMessage[] };
          hasEarlierMessages?:boolean; nextMessageBefore?:number;
        };
        const chat = data.chat;
        if (!chat || cancelled) return;
        setReady(true);
        setChildHistory(previous=>[...new Map([...previous,...(chat.messages || [])].map(message=>[message.id,message])).values()].sort((a,b)=>(a.historyPosition ?? 0)-(b.historyPosition ?? 0)));
        if(!childCursorInitialized.current){childCursorInitialized.current=true;setChildBefore(data.hasEarlierMessages?data.nextMessageBefore ?? null:null);}
        const active = ["running", "paused", "waiting_for_user", "waiting_input"].includes(chat.runStatus || "");
        const childMessages = (chat.messages || []).flatMap((message, index) => {
          const role = message.role || "assistant";
          const text = message.content || "";
          if (!text || (index === 0 && role === "user")) return [];
          return [{ role, text, ...(message.createdAt ? { timestamp: message.createdAt } : {}) }];
        });
        const childTools = (chat.messages || []).flatMap((message) => message.tools || []);
        const currentTool = toolRef.current;
        setLiveTool({
          ...currentTool,
          status: active ? "running" : chat.runStatus || currentTool.status,
          subagent: {
            ...currentTool.subagent,
            ...(childMessages.length ? { messages: childMessages } : {}),
            ...(childTools.length ? { tools: childTools } : {}),
          },
        });
        if (active) timer = window.setTimeout(() => void poll(), 800);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 1600);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [tool.subagent?.chatId]);

  const baseTool=liveTool || tool;
  const displayedTool = childHistory.length ? {...baseTool,subagent:{...baseTool.subagent,messages:childHistory.filter(message=>message.content).map(message=>({role:message.role,text:message.content,timestamp:message.createdAt})),tools:childHistory.flatMap(message=>message.tools || [])}} : baseTool;
  const title = displayedTool.subagent?.title || displayedTool.subagent?.prompt || "Subagent chat";
  const transcript = transcriptFromToolPart(displayedTool as Parameters<typeof transcriptFromToolPart>[0]);
  const prompt = promptText(displayedTool);
  const status = displayedTool.status === "running" ? "Running" : displayedTool.status;

  const viewBlocks: Array<
    | { type: "thinking"; text: string }
    | { type: "message"; role: string; text: string }
    | { type: "tools"; tools: NonNullable<ToolPart["subagent"]>["tools"] }
  > = [];
  for (const part of transcript.parts.slice(-historyLimit)) {
    if (part.type === "thinking") {
      viewBlocks.push({ type: "thinking", text: part.text });
      continue;
    }
    if (part.type === "message") {
      viewBlocks.push({ type: "message", role: part.role, text: stripTranscriptDump(part.text) });
      continue;
    }
    const last = viewBlocks.at(-1);
    if (last?.type === "tools") last.tools = [...(last.tools || []), part.tool];
    else viewBlocks.push({ type: "tools", tools: [part.tool] });
  }

  return (
    <section
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex min-h-0 w-full flex-col bg-background duration-200 md:w-[calc(100%-var(--subagent-sidebar-width))]",
        leaving
          ? "pointer-events-none animate-out fade-out slide-out-to-right-2 fill-mode-forwards"
          : "animate-in fade-in slide-in-from-right-2",
      )}
      style={{ "--subagent-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      aria-label="Subagent chat"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/55 bg-background px-3 md:px-4">
        <Button type="button" variant="ghost" size="icon" className="size-8 max-md:min-h-11 max-md:min-w-11" onClick={requestClose} aria-label="Back to chat" title="Back to chat">
          <ArrowLeft className="size-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={title}>{title}</p>
        <RunStatus status={displayedTool.status} label={status} className="shrink-0 text-xs text-muted-foreground" />
        {displayedTool.status === "running" && onCancel ? (
          <Button type="button" variant="destructive" size="sm" onClick={onCancel} disabled={cancelling}>
            <CircleStop className="mr-1.5 size-3.5" />
            {cancelling ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </header>

      <div className="messages-composer-mask min-h-0 flex-1 overflow-y-auto" style={{ ["--composer-mask-size" as string]: "9rem" }}>
        {!ready ? (
          <div className="flex h-full min-h-[420px] items-center justify-center" role="status" aria-label="Loading chat">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
              <span>Loading chat…</span>
            </div>
          </div>
        ) : null}
        {ready ? <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-6 sm:px-6" style={{ paddingBottom: 144 }}>
          {prompt ? (
            <div className="flex flex-col items-end gap-1">
              <div className="max-w-[85%] space-y-2 rounded-xl bg-secondary/70 px-4 py-2.5 text-[15px] leading-relaxed">
                <p className="whitespace-pre-wrap break-words">{prompt}</p>
              </div>
            </div>
          ) : null}
          <MessageHistoryControl<{chat:{messages:ChatMessage[]};hasEarlierMessages?:boolean;nextMessageBefore?:number}> url={childBefore!==null && tool.subagent?.chatId ? `/api/chats/${encodeURIComponent(tool.subagent.chatId)}?messageLimit=10&messageBefore=${childBefore}` : undefined} label="Load older subagent messages" onLoad={page=>{setChildHistory(previous=>[...page.chat.messages,...previous].filter((message,index,all)=>all.findIndex(item=>item.id===message.id)===index));setChildBefore(page.hasEarlierMessages?page.nextMessageBefore ?? null:null);setHistoryLimit(value=>value+24);}}/>
          {detailError ? <p role="alert" className="text-sm text-destructive">Could not load subagent history. Close and reopen to retry.</p> : null}
          {transcript.parts.length>historyLimit ? <button type="button" className="text-xs text-muted-foreground underline" onClick={()=>setHistoryLimit(value=>value+24)}>Load earlier subagent activity</button> : null}
          {viewBlocks.map((block, index) => {
            if (block.type === "thinking") {
              return (
                <ThinkingBlock
                  key={`thinking-${index}`}
                  text={block.text}
                  done={displayedTool.status !== "running" || index < viewBlocks.length - 1}
                />
              );
            }
            if (block.type === "tools") {
              return (
                <ToolCallGroup
                  key={`tools-${block.tools?.[0]?.id ?? index}`}
                  tools={block.tools || []}
                  autoExpand={false}
                />
              );
            }
            if (!block.text) return null;
            return (
              <div
                key={`message-${index}`}
                className={cn(
                  "w-full",
                  block.role === "user"
                    ? "flex flex-col items-end gap-1"
                    : "text-[15px] leading-relaxed text-foreground/95",
                )}
              >
                {String(block.role ?? "").toLowerCase().includes("assistant") ? (
                  <div className="block w-full">
                    <Markdown content={block.text} />
                  </div>
                ) : (
                  <div className="max-w-[85%] space-y-2 rounded-xl bg-secondary/70 px-4 py-2.5 text-[15px] leading-relaxed">
                    <p className="whitespace-pre-wrap break-words">{block.text}</p>
                  </div>
                )}
              </div>
            );
          })}
          {!viewBlocks.length ? (
            <p className="text-sm text-muted-foreground">{tool.detail || "Waiting for the subagent to respond…"}</p>
          ) : null}
        </div> : null}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div className="pointer-events-none pb-4 pt-3">
          <div className="pointer-events-auto relative mx-auto w-full max-w-2xl px-4 sm:px-6">
            <div className="relative flex w-full items-center gap-2 rounded-xl border border-border/65 bg-card p-2 text-sm text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.16)]">
              <div className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2">
                <Clock3 className="size-4 shrink-0" />
                <span className="truncate">This subagent chat is read-only.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
