"use client";

import { useEffect, useState } from "react";
import { Activity, ChevronRight, MoreHorizontal, MessageSquare, FileText } from "lucide-react";
import { RunStatus } from "@/components/run-status";
import { TeamAgentAvatar } from "@/components/team-agent-avatar";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { handoffRecipientAgent, type HandoffActivity } from "@/lib/chat-program-events";
import type { ProjectAgent } from "@/lib/project-team-types";
import { cn } from "@/lib/utils";

const statuses = {
  queued: { label: "Queued" },
  running: { label: "Working" },
  completed: { label: "Replied" },
  error: { label: "Failed" },
  cancelled: { label: "Cancelled" },
};

export function ChatTeamActivity({ activities, agents = [], onOpenChat }: {
  activities: HandoffActivity[]; agents?: ProjectAgent[]; onOpenChat: (chatId: string) => void;
}) {
  const [detail, setDetail] = useState<{ id: string; view: "prompt" | "reply" } | null>(null);
  const preview = activities.find(activity => activity.id === detail?.id);
  const [loaded,setLoaded]=useState<HandoffActivity|null>(null);
  const [loadError,setLoadError]=useState(false);
  useEffect(()=>{
    if(!preview?.detailsUrl)return;
    const controller=new AbortController();setLoaded(null);setLoadError(false);
    void fetch(preview.detailsUrl,{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("Details unavailable");
      const value=await response.json();if(!controller.signal.aborted)setLoaded(value);
    }).catch(()=>{if(!controller.signal.aborted)setLoadError(true);});
    return()=>controller.abort();
  },[preview?.detailsUrl]);
  const selected=loaded?.id===preview?.id?loaded:preview;
  const received = activities.filter(activity => activity.status === "completed").length;
  const working = activities.filter(activity => activity.status === "queued" || activity.status === "running").length;
  const failures = activities.filter(activity => activity.status === "error").length;
  const summary = [
    received ? `${received} ${received === 1 ? "reply" : "replies"} received` : "",
    working ? `${working} in progress` : "",
    failures ? `${failures} ${failures === 1 ? "task" : "tasks"} failed` : "",
  ].filter(Boolean).join(" · ") || "Tasks cancelled";
  return <section aria-label="Team activity" data-chat-team-activity className="min-w-0 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 sm:px-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
      <h3 className="text-sm font-medium">Team activity</h3>
      <p className="text-xs text-muted-foreground" aria-live="polite">{summary}</p>
    </div>
    <div className="divide-y divide-border/40">
      {activities.map(activity => {
        const { label } = statuses[activity.status];
        const agent = handoffRecipientAgent(activity, agents);
        const chatId = activity.recipientChatId || agent?.chatId;
        return <div key={activity.id} data-handoff-activity={activity.id} className="flex min-w-0 items-center gap-1">
          <button type="button" disabled={!chatId} onClick={() => { if (chatId) onOpenChat(chatId); }}
            title={chatId ? `Open ${activity.recipient} chat` : "This agent’s chat is unavailable."}
            className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-2 text-left text-sm hover:bg-muted/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Open ${activity.recipient} chat. Assigned by ${activity.sender}, ${label}.`}>
            {agent ? <TeamAgentAvatar name={agent.name} color={agent.color} decorative animated={activity.status === "running"} className="size-6"/> : <Activity className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>}
            <span className="min-w-0 flex-1">
              <span className="block break-words font-medium">{activity.recipient}</span>
              <span className="block truncate text-xs text-muted-foreground">Assigned by {activity.sender}</span>
            </span>
            <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", activity.status === "error" ? "text-destructive" : "text-muted-foreground")}><RunStatus status={activity.status} label={label}/></span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true"/>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="size-11 shrink-0 sm:size-8" aria-label={`Options for task assigned to ${activity.recipient}`}>
                <MoreHorizontal className="size-4" aria-hidden="true"/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDetail({ id: activity.id, view: "prompt" })}><FileText/>View prompt</DropdownMenuItem>
              {activity.result || activity.error || activity.status === "completed" ? <DropdownMenuItem onSelect={() => setDetail({ id: activity.id, view: "reply" })}><MessageSquare/>View reply</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>;
      })}
    </div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setDetail(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8">{detail?.view === "reply" ? "Reply from" : "Prompt for"} {selected?.recipient}</DialogTitle>
          <DialogDescription>Assigned by {selected?.sender} · {selected ? statuses[selected.status].label : ""}</DialogDescription>
        </DialogHeader>
        {preview?.detailsUrl && !loaded ? <p role="status" className="text-sm text-muted-foreground">{loadError?"Could not load details. Reopen to retry.":"Loading details…"}</p> : null}
        {selected && detail?.view === "prompt" ? <div className="space-y-4 text-sm [overflow-wrap:anywhere]">
          <p className="whitespace-pre-wrap">{selected.prompt || selected.task}</p>
          {!selected.prompt && selected.context ? <div><p className="mb-1 text-xs font-medium text-muted-foreground">Context</p><p className="whitespace-pre-wrap">{selected.context}</p></div> : null}
        </div> : selected ? <div className="text-sm [overflow-wrap:anywhere]">
          {selected.error ? <p className="whitespace-pre-wrap text-destructive">{selected.error}</p> : selected.result ? <Markdown content={selected.result}/> : <p className="text-muted-foreground">The agent finished without a text reply.</p>}
        </div> : null}
      </DialogContent>
    </Dialog>
  </section>;
}

export function ChatTeamReview({ status }: { status: string }) {
  const active = ["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(status);
  const failed = ["error", "interrupted"].includes(status);
  const title = status === "queued" ? "Waiting to review team results" : active ? "Reviewing team results…" : failed ? "Team review interrupted" : status === "cancelled" ? "Team review cancelled" : "Team review finished";
  return <div data-chat-team-review className={cn("flex items-center gap-2 px-1 py-1 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
    <RunStatus status={status} iconOnly decorative/><span aria-live="polite">{title}</span>
  </div>;
}
