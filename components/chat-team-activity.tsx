"use client";

import { Activity, Check, ChevronRight, CircleAlert, Clock3, CircleStop } from "lucide-react";
import { TeamAgentAvatar } from "@/components/team-agent-avatar";
import { Markdown } from "@/components/markdown";
import type { HandoffActivity } from "@/lib/chat-program-events";
import type { ProjectAgent } from "@/lib/project-team-types";
import { cn } from "@/lib/utils";

const statuses = {
  queued: { label: "Queued", Icon: Clock3 },
  running: { label: "Working", Icon: Activity },
  completed: { label: "Replied", Icon: Check },
  error: { label: "Failed", Icon: CircleAlert },
  cancelled: { label: "Cancelled", Icon: CircleStop },
};

export function ChatTeamActivity({ activities, agents = [] }: { activities: HandoffActivity[]; agents?: ProjectAgent[] }) {
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
        const { label, Icon } = statuses[activity.status];
        const agent = agents.find(item => item.name === activity.recipient);
        return <details key={activity.id} data-handoff-activity={activity.id} className="group min-w-0">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm hover:bg-muted/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden" aria-label={`${activity.sender} to ${activity.recipient}, ${label}. Show task and result`}>
            {agent ? <TeamAgentAvatar name={agent.name} color={agent.color} decorative animated={activity.status === "running"} className="size-6"/> : <Activity className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>}
            <span className="min-w-0 flex-1">
              <span className="block break-words font-medium">{activity.recipient}</span>
              <span className="block truncate text-xs text-muted-foreground">Assigned by {activity.sender}</span>
            </span>
            <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", activity.status === "error" ? "text-destructive" : "text-muted-foreground")}><Icon className="size-3.5" aria-hidden="true"/>{label}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true"/>
          </summary>
          <div className="space-y-3 pb-3 pl-1 pr-1 text-sm [overflow-wrap:anywhere] sm:pl-8">
            {activity.result ? <div><p className="mb-1 text-xs font-medium text-muted-foreground">Reply</p><Markdown content={activity.result}/></div> : null}
            {activity.error ? <p className="whitespace-pre-wrap text-destructive">{activity.error}</p> : null}
            {activity.status === "completed" && !activity.result ? <p className="text-xs text-muted-foreground">The agent finished without a text reply.</p> : null}
            <div><p className="mb-1 text-xs font-medium text-muted-foreground">Task</p><p className="whitespace-pre-wrap">{activity.task}</p></div>
            {activity.context ? <div><p className="mb-1 text-xs font-medium text-muted-foreground">Context</p><p className="whitespace-pre-wrap">{activity.context}</p></div> : null}
            <details className="text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer rounded py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Technical details</summary>
              <p className="mt-1 break-all">Task ID: <span translate="no">{activity.id}</span></p>
            </details>
          </div>
        </details>;
      })}
    </div>
  </section>;
}

export function ChatTeamReview({ status }: { status: string }) {
  const active = ["queued", "running", "switching", "waiting_input", "waiting_for_user"].includes(status);
  const failed = ["error", "interrupted"].includes(status);
  const title = status === "queued" ? "Waiting to review team results" : active ? "Reviewing team results…" : failed ? "Team review interrupted" : status === "cancelled" ? "Team review cancelled" : "Team review finished";
  const Icon = failed ? CircleAlert : active ? Activity : status === "cancelled" ? CircleStop : Check;
  return <div data-chat-team-review className={cn("flex items-center gap-2 px-1 py-1 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
    <Icon className="size-3.5 shrink-0" aria-hidden="true"/><span aria-live="polite">{title}</span>
  </div>;
}
