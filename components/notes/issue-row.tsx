"use client";

import { CalendarDays, FileText, MoreHorizontal, SquareCheck } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IssuePriorityMenu, IssueStatusMenu } from "./issue-controls";
import { cn } from "@/lib/utils";
import type { Issue, IssueWriteInput } from "@/lib/issue-types";

export function IssueRow({ issue, board = false, busy, selecting, selected, assigneeName, onSelect, onOpen, onDetails, onUpdate }: {
  issue: Issue; board?: boolean; busy: boolean; selecting: boolean; selected: boolean; assigneeName: string;
  onSelect: () => void; onOpen: () => void; onDetails: () => void; onUpdate: (patch: IssueWriteInput) => void;
}) {
  const overdue = issue.dueDate && issue.dueDate < new Date().toISOString().slice(0, 10) && issue.status !== "done" && issue.status !== "canceled";
  return <div data-issue-id={issue.id} draggable={board && !busy && !selecting}
    onDragStart={event => event.dataTransfer.setData("text/metis-issue", issue.id)}
    className={cn("group min-w-0 items-start gap-1.5", board ? "grid grid-cols-[auto_1fr_auto] rounded-xl border border-border/70 bg-background p-2.5 shadow-xs" : "flex", board ? "" : "border-b border-border/50 px-3 py-1.5 hover:bg-muted/30 sm:px-5", selected && "bg-primary/5 ring-1 ring-inset ring-primary/20")}>
    {selecting && <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md focus-within:ring-2 focus-within:ring-ring sm:size-8">
      <input type="checkbox" className="size-3.5 accent-primary" aria-label={"Select " + issue.key} checked={selected} disabled={busy} onChange={onSelect} />
    </label>}
    <IssueStatusMenu status={issue.status} issueKey={issue.key} disabled={busy} onChange={status => onUpdate({ status })} />
    <button type="button" onClick={onOpen} className={cn("min-w-0 flex-1 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", board ? "col-span-full row-start-2 space-y-1.5" : "sm:flex sm:items-center sm:gap-3")}>
      <span className={cn("block font-mono text-[10px] leading-4 text-muted-foreground/80", !board && "sm:w-14 sm:shrink-0")}>{issue.key}</span>
      <span className={cn("block min-w-0 break-words text-[13px] leading-5 [overflow-wrap:anywhere]", !board && "sm:flex-1", (issue.status === "canceled" || issue.status === "done") && "text-muted-foreground", issue.status === "canceled" && "line-through")}>{issue.title}</span>
      {(issue.labels.length > 0 || issue.dueDate || issue.assigneeId) && <span className={cn("mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground", !board && "sm:mt-0 sm:shrink-0")}>
        {issue.labels.slice(0, board ? 3 : 1).map(label => <span key={label} className="max-w-28 truncate rounded bg-muted/70 px-1.5 py-0.5">{label}</span>)}
        {issue.dueDate && <span title={"Due " + issue.dueDate + (overdue ? " · Overdue" : "")} className={cn("inline-flex items-center gap-1", overdue && "text-rose-700 dark:text-rose-300")}><CalendarDays aria-hidden="true" className="size-3" />{issue.dueDate.slice(5)}</span>}
        {issue.assigneeId && <span title={assigneeName} aria-label={"Assigned to " + assigneeName} className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-medium uppercase">{assigneeName.slice(0, 1)}</span>}
      </span>}
    </button>
    <div className={cn("flex shrink-0 items-center gap-0.5",board&&"col-start-3 row-start-1")}>
      <IssuePriorityMenu priority={issue.priority} issueKey={issue.key} disabled={busy} onChange={priority => onUpdate({ priority })} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><button type="button" aria-label={"More actions for " + issue.key} title="More actions" disabled={busy} className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:size-8"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem className="min-h-9 text-xs max-sm:min-h-11" onSelect={onDetails}><FileText />Issue details</DropdownMenuItem>
          <DropdownMenuItem className="min-h-9 text-xs max-sm:min-h-11" onSelect={onSelect}><SquareCheck />{selected ? "Deselect issue" : "Select issue"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>;
}
