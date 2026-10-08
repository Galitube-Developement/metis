"use client";

import * as React from "react";
import { Check, Circle, CircleAlert, CircleStop, Clock3, LoaderCircle, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

const states = {
  idle: { label: "Ready", Icon: Circle },
  queued: { label: "Queued", Icon: Clock3 },
  running: { label: "Working", Icon: LoaderCircle },
  waiting: { label: "Waiting for you", Icon: Pause },
  completed: { label: "Completed", Icon: Check },
  error: { label: "Needs attention", Icon: CircleAlert },
  cancelled: { label: "Cancelled", Icon: CircleStop },
  archived: { label: "Archived", Icon: CircleStop },
} as const;

export function runStatusKind(status: string): keyof typeof states {
  switch (status.toLowerCase()) {
    case "running": case "in_progress": case "started": case "executing": case "switching": return "running";
    case "queued": case "pending": return "queued";
    case "waiting_input": case "waiting_for_user": case "paused": return "waiting";
    case "completed": case "success": case "done": case "replied": return "completed";
    case "error": case "failed": case "interrupted": return "error";
    case "cancelled": case "canceled": return "cancelled";
    case "archived": return "archived";
    default: return "idle";
  }
}

/** Labels stay still; only the small status icon moves. No timers or live announcements. */
export function RunStatus({ status, label, iconOnly = false, decorative = false, className }: {
  status: string; label?: string; iconOnly?: boolean; decorative?: boolean; className?: string;
}) {
  const kind = runStatusKind(status);
  const { Icon, label: defaultLabel } = states[kind];
  const text = label || (["idle", "ready", "active"].includes(status.toLowerCase()) || kind !== "idle" ? defaultLabel : status);
  return <span data-run-status={kind} className={cn("run-status", className, kind === "error" && "text-destructive")} aria-hidden={decorative || undefined}>
    <Icon key={kind} className="run-status-icon" aria-hidden="true" />
    {!decorative && <span className={iconOnly ? "sr-only" : undefined}>{text}</span>}
  </span>;
}
