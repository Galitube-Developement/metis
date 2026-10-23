"use client";

import { CheckCircle2, Circle, CircleDashed, CircleDot, Flag, Minus, X, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS, ISSUE_STATUSES, ISSUE_STATUS_LABELS, type Issue, type IssueStatus } from "@/lib/issue-types";
import { cn } from "@/lib/utils";

export const issueStatusTone: Record<IssueStatus, string> = {
  backlog: "text-muted-foreground bg-muted/60",
  todo: "text-sky-700 bg-sky-500/10 dark:text-sky-300",
  in_progress: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
  done: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
  canceled: "text-muted-foreground bg-muted/60",
};

export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  const Icon = status === "done" ? CheckCircle2 : status === "in_progress" ? CircleDot : status === "backlog" ? CircleDashed : status === "canceled" ? X : Circle;
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", issueStatusTone[status].split(" ").filter(value => !value.startsWith("bg-")).join(" "), className)} />;
}

const controlClass = "inline-flex size-9 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:size-8";
const menuItemClass = "min-h-9 gap-2 text-xs max-sm:min-h-11";

export function IssueStatusMenu({ status, issueKey, disabled, showLabel = false, onChange }: {
  status: IssueStatus; issueKey: string; disabled?: boolean; showLabel?: boolean; onChange: (status: IssueStatus) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" disabled={disabled} aria-label={`Change status for ${issueKey}: ${ISSUE_STATUS_LABELS[status]}`} title={`${ISSUE_STATUS_LABELS[status]} · Change status`}
        className={cn(controlClass, issueStatusTone[status], showLabel && "w-auto gap-1.5 px-2 text-xs sm:w-auto")}>
        <StatusIcon status={status} />{showLabel && <><span>{ISSUE_STATUS_LABELS[status]}</span><ChevronDown className="size-3 opacity-60" /></>}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-48" align="start">
      <DropdownMenuLabel className="text-xs text-muted-foreground">Change status</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={status} onValueChange={value => { if (value !== status) onChange(value as IssueStatus); }}>
        {ISSUE_STATUSES.map(value => <DropdownMenuRadioItem key={value} value={value} className={menuItemClass}><StatusIcon status={value} />{ISSUE_STATUS_LABELS[value]}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

const priorityTone: Record<Issue["priority"], string> = {
  none: "text-muted-foreground/50", low: "text-muted-foreground",
  medium: "text-amber-700 dark:text-amber-300", high: "text-orange-700 dark:text-orange-300", urgent: "text-rose-700 dark:text-rose-300",
};
export function PriorityIcon({ priority }: { priority: Issue["priority"] }) {
  const Icon = priority === "none" ? Minus : Flag;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", priorityTone[priority], priority === "urgent" && "fill-current/15")} />;
}
export function IssuePriorityMenu({ priority, issueKey, disabled, showLabel = false, onChange }: {
  priority: Issue["priority"]; issueKey: string; disabled?: boolean; showLabel?: boolean; onChange: (priority: Issue["priority"]) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" disabled={disabled} aria-label={`Change priority for ${issueKey}: ${ISSUE_PRIORITY_LABELS[priority]}`} title={ISSUE_PRIORITY_LABELS[priority]}
        className={cn(controlClass, priority !== "none" && "bg-muted/40", showLabel && "w-auto gap-1.5 px-2 text-xs sm:w-auto")}>
        <PriorityIcon priority={priority} />{showLabel && <span>{ISSUE_PRIORITY_LABELS[priority]}</span>}
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-48" align="end">
      <DropdownMenuLabel className="text-xs text-muted-foreground">Priority</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={priority} onValueChange={value => { if (value !== priority) onChange(value as Issue["priority"]); }}>
        {ISSUE_PRIORITIES.map(value => <DropdownMenuRadioItem key={value} value={value} className={menuItemClass}><PriorityIcon priority={value} />{ISSUE_PRIORITY_LABELS[value]}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
