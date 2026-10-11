"use client";
import { BookOpen, FilePenLine, Terminal, Wrench } from "lucide-react";
import { AnimatedNumber } from "./animated-number";
import { RunStatus } from "./run-status";
import { activityRowClass } from "./thinking-block";

export function toolPreparationLabel(kind?: string) {
  return kind === "read" ? "Preparing file read" : kind === "shell" ? "Preparing command"
    : kind === "edit" ? "Preparing file edit" : "Preparing tool call";
}

/** Arguments are still being written; execution has not started yet. */
export function ToolInputStatus({ name, kind, characters }: { name: string; kind?: string; characters?: number }) {
  const Icon = kind === "read" ? BookOpen : kind === "shell" ? Terminal : kind === "edit" ? FilePenLine : Wrench;
  return <div className={activityRowClass + " min-w-0"} data-tool-phase="preparing" title={name}>
    <RunStatus status="running" decorative iconOnly className="shrink-0 text-xs"/>
    <Icon aria-hidden="true" className="size-3 shrink-0 opacity-70"/>
    <span className="min-w-0 truncate">{toolPreparationLabel(kind)}</span>
    {characters !== undefined && Number.isFinite(characters) && characters >= 0 ? <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
      <AnimatedNumber value={characters}/> chars
    </span> : null}
  </div>;
}
